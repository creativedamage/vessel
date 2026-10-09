import { z } from "zod";
import type { Db } from "@vessel/db";
import { Prisma } from "@vessel/db";
import type { FastifyRequest } from "fastify";
import type { App, Deps } from "../app.ts";
import { inKioskCampusScope, staff, staffOrKiosk, type Actor } from "../auth/actor.ts";
import { audit } from "../lib/audit.ts";
import { verifyPin } from "../lib/crypto.ts";
import { badRequest, forbidden, HttpError } from "../lib/errors.ts";

const uuid = z.string().uuid();

const Target = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PERSON"), personId: uuid }),
  z.object({ type: z.literal("MINISTRY"), ministryId: uuid }),
  z.object({ type: z.literal("ROOM"), roomId: uuid }),
]);

const Pin = z.object({ personId: uuid, pin: z.string().regex(/^\d{4,6}$/) });

const Item = z.object({ assetId: uuid, clientOpId: z.string().min(8).max(64) });

const CheckoutBatch = z.object({
  batchId: uuid,
  target: Target,
  items: z.array(Item).min(1).max(200),
  dueAt: z.coerce.date().optional(),
  note: z.string().max(1000).optional(),
  pin: Pin.optional(),
});

const CheckinBatch = z.object({
  batchId: uuid,
  items: z.array(Item).min(1).max(200),
  condition: z.enum(["ok", "damaged", "missing_parts"]).default("ok"),
  /** Put items somewhere other than their home room. */
  roomId: uuid.optional(),
  note: z.string().max(1000).optional(),
  pin: Pin.optional(),
});

type ItemStatus = "ok" | "duplicate" | "already_out" | "already_in" | "not_found" | "out_of_scope" | "unavailable";

export interface ItemResult {
  assetId: string;
  clientOpId: string;
  status: ItemStatus;
  assetTag?: string;
  displayName?: string;
  checkoutId?: string;
  heldBy?: string;
  returnTo?: string | null;
  message?: string;
}

const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MINUTES = 15;

/** Kiosks that require a PIN must identify the volunteer; staff never need one. */
async function resolveOnBehalfOf(db: Db, actor: Actor, pin?: z.infer<typeof Pin>) {
  if (actor.kind === "staff") return actor.personId;
  if (!pin) {
    if (actor.requirePin) throw new HttpError(401, "pin_required", "Enter your PIN to continue");
    return null;
  }
  const person = await db.person.findFirst({ where: { id: pin.personId, organizationId: actor.organizationId, active: true } });
  if (!person?.pinHash) throw new HttpError(401, "pin_invalid", "That name and PIN don't match");
  if (person.pinLockedUntil && person.pinLockedUntil > new Date()) {
    throw new HttpError(423, "pin_locked", "Too many tries. Ask a staff member, or wait 15 minutes.");
  }
  if (!(await verifyPin(pin.pin, person.pinHash))) {
    const failures = person.pinFailedCount + 1;
    await db.person.update({
      where: { id: person.id },
      data: failures >= MAX_PIN_FAILURES
        ? { pinFailedCount: 0, pinLockedUntil: new Date(Date.now() + PIN_LOCK_MINUTES * 60e3) }
        : { pinFailedCount: failures },
    });
    throw new HttpError(401, "pin_invalid", "That name and PIN don't match");
  }
  if (person.pinFailedCount) await db.person.update({ where: { id: person.id }, data: { pinFailedCount: 0, pinLockedUntil: null } });
  return person.id;
}

export default function checkoutRoutes(app: App, { db }: Deps) {
  async function loadTarget(organizationId: string, target: z.infer<typeof Target>) {
    if (target.type === "PERSON") {
      const p = await db.person.findFirst({ where: { id: target.personId, organizationId, active: true } });
      if (!p) throw badRequest("That person wasn't found");
      return { label: p.displayName, data: { targetType: "PERSON" as const, assigneeId: p.id }, roomId: null as string | null };
    }
    if (target.type === "MINISTRY") {
      const m = await db.ministry.findFirst({ where: { id: target.ministryId, organizationId, archivedAt: null } });
      if (!m) throw badRequest("That ministry wasn't found");
      return { label: m.name, data: { targetType: "MINISTRY" as const, ministryId: m.id }, roomId: null };
    }
    const r = await db.room.findFirst({ where: { id: target.roomId, organizationId, archivedAt: null } });
    if (!r) throw badRequest("That room wasn't found");
    return { label: r.name, data: { targetType: "ROOM" as const, roomId: r.id }, roomId: r.id };
  }

  async function checkoutOne(
    req: FastifyRequest,
    actor: Actor,
    body: z.infer<typeof CheckoutBatch>,
    target: Awaited<ReturnType<typeof loadTarget>>,
    onBehalfOf: string | null,
    item: z.infer<typeof Item>,
  ): Promise<ItemResult> {
    const base = { assetId: item.assetId, clientOpId: item.clientOpId };

    // Idempotency: a retried op returns its original result.
    const prior = await db.checkout.findUnique({ where: { clientOpId: item.clientOpId } });
    if (prior) {
      if (prior.assetId !== item.assetId || prior.organizationId !== actor.organizationId) {
        return { ...base, status: "unavailable", message: "clientOpId was already used for a different asset" };
      }
      return { ...base, status: "duplicate", checkoutId: prior.id };
    }

    const asset = await db.asset.findFirst({
      where: { id: item.assetId, organizationId: actor.organizationId },
      include: { itemType: true, checkouts: { where: { checkedInAt: null }, include: { assignee: true, ministry: true, room: true } } },
    });
    if (!asset || asset.retiredAt) return { ...base, status: "not_found" };
    const display = { assetTag: asset.assetTag, displayName: asset.name ?? asset.itemType.name };
    if (!inKioskCampusScope(actor, asset.homeCampusId)) return { ...base, ...display, status: "out_of_scope", message: "Belongs to another campus" };
    if (asset.status === "CHECKED_OUT") {
      const open = asset.checkouts[0];
      return { ...base, ...display, status: "already_out", heldBy: open?.assignee?.displayName ?? open?.ministry?.name ?? open?.room?.name };
    }
    if (asset.status !== "AVAILABLE") return { ...base, ...display, status: "unavailable", message: `Asset is ${asset.status.toLowerCase().replace("_", " ")}` };

    try {
      return await db.$transaction(async (tx) => {
        // Conditional update = the lock. Loses cleanly if another device got there first.
        const claimed = await tx.asset.updateMany({
          where: { id: asset.id, status: "AVAILABLE" },
          data: { status: "CHECKED_OUT", version: { increment: 1 }, ...(target.roomId && { currentRoomId: target.roomId }) },
        });
        if (claimed.count === 0) throw new HttpError(409, "already_out", "Already checked out");
        const co = await tx.checkout.create({
          data: {
            organizationId: actor.organizationId,
            assetId: asset.id,
            batchId: body.batchId,
            clientOpId: item.clientOpId,
            ...target.data,
            quantity: asset.quantity,
            checkedOutAt: new Date(),
            dueAt: body.dueAt,
            note: body.note,
            checkedOutById: onBehalfOf,
            kioskDeviceId: actor.kind === "kiosk" ? actor.deviceId : null,
          },
        });
        await audit(tx, actor, req, {
          action: "asset.checkout",
          entityType: "Asset",
          entityId: asset.id,
          batchId: body.batchId,
          onBehalfOfPersonId: onBehalfOf,
          before: { status: asset.status },
          after: { status: "CHECKED_OUT", to: target.label, ...target.data, checkoutId: co.id },
        });
        return { ...base, ...display, status: "ok" as const, checkoutId: co.id, heldBy: target.label };
      });
    } catch (e) {
      const raced =
        (e instanceof HttpError && e.code === "already_out") ||
        (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");
      if (raced) {
        const again = await db.checkout.findUnique({ where: { clientOpId: item.clientOpId } });
        if (again) return { ...base, ...display, status: "duplicate", checkoutId: again.id };
        return { ...base, ...display, status: "already_out" };
      }
      throw e;
    }
  }

  app.post(
    "/checkouts/batch",
    {
      preHandler: staffOrKiosk("checkout"),
      schema: { tags: ["checkouts"], body: CheckoutBatch },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (req) => {
      const actor = req.actor!;
      const body = req.body;
      const ids = new Set(body.items.map((i) => i.clientOpId));
      if (ids.size !== body.items.length) throw badRequest("Each item needs its own clientOpId");
      if (actor.kind === "kiosk" && body.target.type === "MINISTRY" && actor.scope.ministryIds.length && !actor.scope.ministryIds.includes(body.target.ministryId)) {
        throw forbidden("This device can't assign to that ministry");
      }
      const onBehalfOf = await resolveOnBehalfOf(db, actor, body.pin);
      const target = await loadTarget(actor.organizationId, body.target);

      const results: ItemResult[] = [];
      for (const item of body.items) results.push(await checkoutOne(req, actor, body, target, onBehalfOf, item));
      return summarize(body.batchId, results, target.label);
    },
  );

  app.post(
    "/checkins/batch",
    {
      preHandler: staffOrKiosk("checkin"),
      schema: { tags: ["checkouts"], body: CheckinBatch },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (req) => {
      const actor = req.actor!;
      const body = req.body;
      const onBehalfOf = await resolveOnBehalfOf(db, actor, body.pin);
      let overrideRoom: { id: string; name: string } | null = null;
      if (body.roomId) {
        overrideRoom = await db.room.findFirst({ where: { id: body.roomId, organizationId: actor.organizationId }, select: { id: true, name: true } });
        if (!overrideRoom) throw badRequest("That room wasn't found");
      }

      const results: ItemResult[] = [];
      for (const item of body.items) {
        const base = { assetId: item.assetId, clientOpId: item.clientOpId };
        const asset = await db.asset.findFirst({
          where: { id: item.assetId, organizationId: actor.organizationId },
          include: { itemType: true, homeRoom: true },
        });
        if (!asset) {
          results.push({ ...base, status: "not_found" });
          continue;
        }
        const display = { assetTag: asset.assetTag, displayName: asset.name ?? asset.itemType.name };
        if (!inKioskCampusScope(actor, asset.homeCampusId)) {
          results.push({ ...base, ...display, status: "out_of_scope", message: "Belongs to another campus" });
          continue;
        }
        const open = await db.checkout.findFirst({ where: { assetId: asset.id, checkedInAt: null } });
        const returnTo = overrideRoom?.name ?? asset.homeRoom?.name ?? null;
        if (!open) {
          results.push({ ...base, ...display, status: "already_in", returnTo });
          continue;
        }
        const newStatus = body.condition === "ok" ? "AVAILABLE" : "IN_SERVICE";
        const done = await db.$transaction(async (tx) => {
          const closed = await tx.checkout.updateMany({
            where: { id: open.id, checkedInAt: null },
            data: { checkedInAt: new Date(), checkedInById: onBehalfOf, checkinCondition: body.condition, note: body.note ?? open.note },
          });
          if (closed.count === 0) return false;
          await tx.asset.update({
            where: { id: asset.id },
            data: { status: newStatus, currentRoomId: overrideRoom?.id ?? asset.homeRoomId, version: { increment: 1 } },
          });
          await audit(tx, actor, req, {
            action: "asset.checkin",
            entityType: "Asset",
            entityId: asset.id,
            batchId: body.batchId,
            onBehalfOfPersonId: onBehalfOf,
            before: { status: asset.status, checkoutId: open.id },
            after: { status: newStatus, condition: body.condition, returnedTo: returnTo },
          });
          return true;
        });
        results.push({ ...base, ...display, status: done ? "ok" : "already_in", checkoutId: open.id, returnTo });
      }
      return summarize(body.batchId, results, null);
    },
  );

  app.get(
    "/checkouts",
    {
      preHandler: staff("VIEWER"),
      schema: {
        tags: ["checkouts"],
        querystring: z.object({
          open: z.enum(["true", "false"]).default("true"),
          overdue: z.enum(["true", "false"]).optional(),
          personId: uuid.optional(),
          ministryId: uuid.optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
      },
    },
    async (req) => {
      const q = req.query;
      const rows = await db.checkout.findMany({
        where: {
          organizationId: req.actor!.organizationId,
          ...(q.open === "true" && { checkedInAt: null }),
          ...(q.overdue === "true" && { checkedInAt: null, dueAt: { lt: new Date() } }),
          ...(q.personId && { assigneeId: q.personId }),
          ...(q.ministryId && { ministryId: q.ministryId }),
        },
        orderBy: { checkedOutAt: "desc" },
        take: q.limit,
        include: {
          asset: { select: { id: true, assetTag: true, name: true, itemType: { select: { name: true } } } },
          assignee: { select: { id: true, displayName: true } },
          ministry: { select: { id: true, name: true, color: true } },
          room: { select: { id: true, name: true } },
          kioskDevice: { select: { id: true, name: true } },
        },
      });
      return { items: rows };
    },
  );
}

function summarize(batchId: string, results: ItemResult[], target: string | null) {
  const counts = results.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
  // already_in on a check-in means the goal state is reached, so it isn't a failure.
  const succeeded = (counts.ok ?? 0) + (counts.duplicate ?? 0) + (counts.already_in ?? 0);
  return { batchId, target, succeeded, failed: results.length - succeeded, counts, results };
}
