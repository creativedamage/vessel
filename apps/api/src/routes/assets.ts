import { z } from "zod";
import type { Prisma } from "@vessel/db";
import type { App, Deps } from "../app.ts";
import { staff, staffActor } from "../auth/actor.ts";
import { assetSummaryInclude, allocateTag, toSummary, validateCustomFields } from "../lib/assets.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";

const uuid = z.string().uuid();
const date = z.coerce.date();

const AssetFields = z.object({
  itemTypeId: uuid,
  name: z.string().trim().max(120).nullish(),
  serialNumber: z.string().trim().max(120).nullish(),
  barcode: z.string().trim().max(120).nullish(),
  rfidEpc: z.string().trim().max(64).nullish(),
  ministryId: uuid.nullish(),
  homeCampusId: uuid.nullish(),
  homeRoomId: uuid.nullish(),
  quantity: z.number().int().min(1).max(100000).optional(),
  purchaseDate: date.nullish(),
  purchaseCost: z.number().min(0).nullish(),
  fundSource: z.string().max(120).nullish(),
  warrantyEndsAt: date.nullish(),
  nextServiceAt: date.nullish(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(5000).nullish(),
});

const ListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["AVAILABLE", "CHECKED_OUT", "IN_SERVICE", "MISSING", "RETIRED"]).optional(),
  ministryId: uuid.optional(),
  campusId: uuid.optional(),
  categoryId: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["assetTag", "updatedAt", "name"]).default("assetTag"),
});

export default function assetRoutes(app: App, { db }: Deps) {
  async function assertRefs(organizationId: string, b: Partial<z.infer<typeof AssetFields>>) {
    const checks: Promise<unknown>[] = [];
    const must = async (p: Promise<unknown>, what: string) => {
      if (!(await p)) throw badRequest(`${what} not found`);
    };
    if (b.itemTypeId) checks.push(must(db.itemType.findFirst({ where: { id: b.itemTypeId, organizationId } }), "Item type"));
    if (b.ministryId) checks.push(must(db.ministry.findFirst({ where: { id: b.ministryId, organizationId } }), "Ministry"));
    if (b.homeCampusId) checks.push(must(db.campus.findFirst({ where: { id: b.homeCampusId, organizationId } }), "Campus"));
    if (b.homeRoomId) checks.push(must(db.room.findFirst({ where: { id: b.homeRoomId, organizationId } }), "Room"));
    await Promise.all(checks);
  }

  app.get("/assets", { preHandler: staff("VIEWER"), schema: { tags: ["assets"], querystring: ListQuery } }, async (req) => {
    const { q, status, ministryId, campusId, categoryId, page, pageSize, sort } = req.query;
    const where: Prisma.AssetWhereInput = {
      organizationId: req.actor!.organizationId,
      ...(status ? { status } : { retiredAt: null }),
      ...(ministryId && { ministryId }),
      ...(campusId && { homeCampusId: campusId }),
      ...(categoryId && { itemType: { categoryId } }),
      ...(q && {
        OR: [
          { assetTag: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { serialNumber: { contains: q, mode: "insensitive" } },
          { barcode: { contains: q, mode: "insensitive" } },
          { itemType: { name: { contains: q, mode: "insensitive" } } },
          { itemType: { manufacturer: { contains: q, mode: "insensitive" } } },
        ],
      }),
    };
    const [total, rows] = await Promise.all([
      db.asset.count({ where }),
      db.asset.findMany({
        where,
        include: assetSummaryInclude,
        orderBy: sort === "updatedAt" ? { updatedAt: "desc" } : { [sort]: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: rows.map(toSummary) };
  });

  app.get("/assets/:id", { preHandler: staff("VIEWER"), schema: { tags: ["assets"], params: z.object({ id: uuid }) } }, async (req) => {
    const organizationId = req.actor!.organizationId;
    const asset = await db.asset.findFirst({ where: { id: req.params.id, organizationId }, include: assetSummaryInclude });
    if (!asset) throw notFound("Asset");
    const [history, events, fieldDefs, serviceRecords] = await Promise.all([
      db.checkout.findMany({
        where: { assetId: asset.id },
        orderBy: { checkedOutAt: "desc" },
        take: 25,
        include: {
          assignee: { select: { id: true, displayName: true } },
          ministry: { select: { id: true, name: true } },
          room: { select: { id: true, name: true } },
          checkedOutBy: { select: { id: true, displayName: true } },
          checkedInBy: { select: { id: true, displayName: true } },
          kioskDevice: { select: { id: true, name: true } },
        },
      }),
      db.auditEvent.findMany({
        where: { organizationId, entityType: "Asset", entityId: asset.id },
        orderBy: { occurredAt: "desc" },
        take: 25,
      }),
      db.customFieldDef.findMany({
        where: { organizationId, archivedAt: null, OR: [{ categoryId: null }, { categoryId: asset.itemType.category.id }] },
        orderBy: { sortOrder: "asc" },
      }),
      db.serviceRecord.findMany({ where: { assetId: asset.id }, orderBy: { performedAt: "desc" }, take: 25 }),
    ]);
    return {
      asset: toSummary(asset),
      history,
      events: events.map((e) => ({ ...e, id: e.id.toString() })),
      fieldDefs,
      serviceRecords: serviceRecords.map((s) => ({ ...s, cost: s.cost?.toString() ?? null })),
    };
  });

  app.post(
    "/assets",
    {
      preHandler: staff("MANAGER"),
      schema: { tags: ["assets"], body: AssetFields.extend({ assetTag: z.string().trim().min(1).max(40).optional(), count: z.number().int().min(1).max(100).default(1) }) },
    },
    async (req, reply) => {
      const actor = staffActor(req);
      const { count, assetTag, customFields, ...body } = req.body;
      if (assetTag && count > 1) throw badRequest("A custom asset tag can only be used when creating one asset");
      await assertRefs(actor.organizationId, body);
      const itemType = await db.itemType.findUniqueOrThrow({ where: { id: body.itemTypeId } });
      const cf = await validateCustomFields(db, actor.organizationId, itemType.categoryId, customFields ?? {});

      const created = await db.$transaction(async (tx) => {
        const out = [];
        for (let i = 0; i < count; i++) {
          const tag = assetTag?.toUpperCase() ?? (await allocateTag(tx, actor.organizationId));
          const clash = await tx.asset.findFirst({ where: { organizationId: actor.organizationId, assetTag: tag } });
          if (clash) throw conflict(`Asset tag ${tag} is already in use`);
          const asset = await tx.asset.create({
            data: {
              ...body,
              organizationId: actor.organizationId,
              assetTag: tag,
              barcode: body.barcode ?? tag,
              customFields: cf as Prisma.InputJsonValue,
              currentRoomId: body.homeRoomId ?? null,
            },
            include: assetSummaryInclude,
          });
          await audit(tx, actor, req, { action: "asset.create", entityType: "Asset", entityId: asset.id, after: { assetTag: tag, ...body, customFields: cf } });
          out.push(toSummary(asset));
        }
        return out;
      });
      return reply.status(201).send({ items: created });
    },
  );

  app.patch(
    "/assets/:id",
    {
      preHandler: staff("MANAGER"),
      schema: {
        tags: ["assets"],
        params: z.object({ id: uuid }),
        body: AssetFields.partial().extend({
          version: z.number().int(),
          status: z.enum(["AVAILABLE", "IN_SERVICE", "MISSING"]).optional(),
        }),
      },
    },
    async (req) => {
      const actor = staffActor(req);
      const { version, customFields, ...changes } = req.body;
      const existing = await db.asset.findFirst({ where: { id: req.params.id, organizationId: actor.organizationId }, include: { itemType: true } });
      if (!existing) throw notFound("Asset");
      if (existing.version !== version) {
        throw conflict("This asset was changed by someone else. Reload to see the latest.", { currentVersion: existing.version });
      }
      if (changes.status && existing.status === "CHECKED_OUT") throw conflict("Check the asset in before changing its status");
      await assertRefs(actor.organizationId, changes);
      const categoryId = changes.itemTypeId
        ? (await db.itemType.findUniqueOrThrow({ where: { id: changes.itemTypeId } })).categoryId
        : existing.itemType.categoryId;
      const cf = customFields
        ? { ...(existing.customFields as Record<string, unknown>), ...(await validateCustomFields(db, actor.organizationId, categoryId, customFields, { partial: true })) }
        : undefined;
      if (customFields) for (const [k, v] of Object.entries(customFields)) if (v === null || v === "") delete cf![k];

      return db.$transaction(async (tx) => {
        const res = await tx.asset.updateMany({
          where: { id: existing.id, version },
          data: { ...changes, ...(cf && { customFields: cf as Prisma.InputJsonValue }), version: { increment: 1 } },
        });
        if (res.count === 0) throw conflict("This asset was changed by someone else. Reload to see the latest.");
        const updated = await tx.asset.findUniqueOrThrow({ where: { id: existing.id }, include: assetSummaryInclude });
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const key of Object.keys({ ...changes, ...(cf && { customFields: 1 }) })) {
          const k = key as keyof typeof existing;
          before[key] = existing[k];
          after[key] = (updated as Record<string, unknown>)[key];
        }
        await audit(tx, actor, req, { action: "asset.update", entityType: "Asset", entityId: existing.id, before, after });
        return toSummary(updated);
      });
    },
  );

  app.post(
    "/assets/:id/retire",
    { preHandler: staff("ADMIN"), schema: { tags: ["assets"], params: z.object({ id: uuid }), body: z.object({ reason: z.string().max(500).optional() }) } },
    async (req) => {
      const actor = staffActor(req);
      const asset = await db.asset.findFirst({ where: { id: req.params.id, organizationId: actor.organizationId } });
      if (!asset) throw notFound("Asset");
      if (asset.status === "CHECKED_OUT") throw conflict("Check the asset in before retiring it");
      return db.$transaction(async (tx) => {
        const updated = await tx.asset.update({
          where: { id: asset.id },
          data: { status: "RETIRED", retiredAt: new Date(), version: { increment: 1 } },
          include: assetSummaryInclude,
        });
        await audit(tx, actor, req, { action: "asset.retire", entityType: "Asset", entityId: asset.id, before: { status: asset.status }, after: { status: "RETIRED", reason: req.body.reason } });
        return toSummary(updated);
      });
    },
  );

  app.post(
    "/assets/:id/service-records",
    {
      preHandler: staff("MANAGER"),
      schema: {
        tags: ["assets"],
        params: z.object({ id: uuid }),
        body: z.object({
          kind: z.string().trim().min(1).max(120),
          performedAt: date,
          performedBy: z.string().max(120).optional(),
          cost: z.number().min(0).optional(),
          notes: z.string().max(5000).optional(),
          nextServiceAt: date.optional(),
        }),
      },
    },
    async (req, reply) => {
      const actor = staffActor(req);
      const asset = await db.asset.findFirst({ where: { id: req.params.id, organizationId: actor.organizationId }, include: { itemType: true } });
      if (!asset) throw notFound("Asset");
      const { nextServiceAt, ...record } = req.body;
      const next =
        nextServiceAt ??
        (asset.itemType.serviceIntervalDays ? new Date(record.performedAt.getTime() + asset.itemType.serviceIntervalDays * 864e5) : undefined);
      const created = await db.$transaction(async (tx) => {
        const r = await tx.serviceRecord.create({ data: { ...record, organizationId: actor.organizationId, assetId: asset.id } });
        if (next) await tx.asset.update({ where: { id: asset.id }, data: { nextServiceAt: next, version: { increment: 1 } } });
        await audit(tx, actor, req, { action: "asset.service", entityType: "Asset", entityId: asset.id, after: { ...record, nextServiceAt: next } });
        return r;
      });
      return reply.status(201).send({ ...created, cost: created.cost?.toString() ?? null });
    },
  );
}
