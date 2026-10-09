import { z } from "zod";
import type { Prisma } from "@vessel/db";
import type { App, Deps } from "../app.ts";
import { staff, staffActor, staffOrKiosk } from "../auth/actor.ts";
import { audit } from "../lib/audit.ts";
import { hashPin } from "../lib/crypto.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";

const uuid = z.string().uuid();

const PersonBody = z.object({
  kind: z.enum(["STAFF", "VOLUNTEER", "CONTACT"]),
  displayName: z.string().trim().min(1).max(120),
  email: z.string().email().toLowerCase().nullish(),
  phone: z.string().max(40).nullish(),
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "VIEWER"]).nullish(),
  ministryIds: z.array(uuid).optional(),
});

export default function peopleRoutes(app: App, { db }: Deps) {
  /** Quick-search for the assignee picker. Kiosks get names only. */
  app.get(
    "/people",
    {
      preHandler: staffOrKiosk("checkout", "VIEWER"),
      schema: {
        tags: ["people"],
        querystring: z.object({
          q: z.string().trim().max(80).optional(),
          kind: z.enum(["STAFF", "VOLUNTEER", "CONTACT"]).optional(),
          includeInactive: z.enum(["true", "false"]).default("false"),
          limit: z.coerce.number().int().min(1).max(500).default(50),
        }),
      },
    },
    async (req) => {
      const actor = req.actor!;
      const { q, kind, includeInactive, limit } = req.query;
      const where: Prisma.PersonWhereInput = {
        organizationId: actor.organizationId,
        ...(includeInactive === "false" || actor.kind === "kiosk" ? { active: true } : {}),
        ...(kind && { kind }),
        ...(q && {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            ...(actor.kind === "staff" ? [{ email: { contains: q, mode: "insensitive" as const } }] : []),
          ],
        }),
      };
      if (actor.kind === "kiosk") {
        const rows = await db.person.findMany({
          where,
          orderBy: { displayName: "asc" },
          take: limit,
          select: { id: true, displayName: true, kind: true, pinHash: true },
        });
        return { items: rows.map(({ pinHash, ...p }) => ({ ...p, hasPin: !!pinHash })) };
      }
      const rows = await db.person.findMany({
        where,
        orderBy: { displayName: "asc" },
        take: limit,
        select: {
          id: true, displayName: true, kind: true, email: true, phone: true, role: true, active: true,
          externalSource: true, lastSyncedAt: true, pinHash: true,
          ministries: { select: { isLeader: true, ministry: { select: { id: true, name: true, color: true } } } },
          _count: { select: { checkoutsHeld: { where: { checkedInAt: null } } } },
        },
      });
      return {
        items: rows.map(({ pinHash, _count, ...p }) => ({ ...p, hasPin: !!pinHash, openCheckouts: _count.checkoutsHeld })),
      };
    },
  );

  app.post("/people", { preHandler: staff("ADMIN"), schema: { tags: ["people"], body: PersonBody } }, async (req, reply) => {
    const actor = staffActor(req);
    const { ministryIds, ...data } = req.body;
    if (data.kind === "STAFF" && !data.role) throw badRequest("Staff need a role");
    if (data.kind !== "STAFF") data.role = null;
    if (data.role === "OWNER" && actor.role !== "OWNER") throw badRequest("Only an owner can add another owner");
    if (data.email) {
      const dupe = await db.person.findFirst({ where: { organizationId: actor.organizationId, email: data.email } });
      if (dupe) throw conflict("Someone with that email already exists");
    }
    const person = await db.$transaction(async (tx) => {
      const p = await tx.person.create({
        data: {
          ...data,
          organizationId: actor.organizationId,
          externalSource: "LOCAL",
          ministries: ministryIds?.length ? { create: ministryIds.map((ministryId) => ({ ministryId })) } : undefined,
        },
      });
      await audit(tx, actor, req, { action: "person.create", entityType: "Person", entityId: p.id, after: data });
      return p;
    });
    const { pinHash: _ignored, ...safe } = person;
    return reply.status(201).send(safe);
  });

  app.patch(
    "/people/:id",
    { preHandler: staff("ADMIN"), schema: { tags: ["people"], params: z.object({ id: uuid }), body: PersonBody.partial().extend({ active: z.boolean().optional() }) } },
    async (req) => {
      const actor = staffActor(req);
      const existing = await db.person.findFirst({ where: { id: req.params.id, organizationId: actor.organizationId } });
      if (!existing) throw notFound("Person");
      const { ministryIds, ...data } = req.body;
      if (data.role === "OWNER" && actor.role !== "OWNER") throw badRequest("Only an owner can grant the owner role");
      if (existing.id === actor.personId && data.active === false) throw badRequest("You can't deactivate yourself");
      const updated = await db.$transaction(async (tx) => {
        const p = await tx.person.update({ where: { id: existing.id }, data });
        if (ministryIds) {
          await tx.ministryMember.deleteMany({ where: { personId: existing.id } });
          if (ministryIds.length) await tx.ministryMember.createMany({ data: ministryIds.map((ministryId) => ({ personId: existing.id, ministryId })) });
        }
        if (data.active === false) await tx.staffSession.updateMany({ where: { personId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
        const { pinHash: _a, ...before } = existing;
        await audit(tx, actor, req, { action: "person.update", entityType: "Person", entityId: existing.id, before, after: data });
        return p;
      });
      const { pinHash: _b, ...safe } = updated;
      return safe;
    },
  );

  app.put(
    "/people/:id/pin",
    { preHandler: staff("ADMIN"), schema: { tags: ["people"], params: z.object({ id: uuid }), body: z.object({ pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits").nullable() }) } },
    async (req) => {
      const actor = staffActor(req);
      const person = await db.person.findFirst({ where: { id: req.params.id, organizationId: actor.organizationId } });
      if (!person) throw notFound("Person");
      await db.$transaction(async (tx) => {
        await tx.person.update({
          where: { id: person.id },
          data: { pinHash: req.body.pin ? await hashPin(req.body.pin) : null, pinFailedCount: 0, pinLockedUntil: null },
        });
        await audit(tx, actor, req, { action: req.body.pin ? "person.pin.set" : "person.pin.clear", entityType: "Person", entityId: person.id });
      });
      return { ok: true };
    },
  );
}
