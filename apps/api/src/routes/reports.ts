import { z } from "zod";
import type { App, Deps } from "../app.ts";
import { staff } from "../auth/actor.ts";

const uuid = z.string().uuid();

export default function reportRoutes(app: App, { db }: Deps) {
  /** Dashboard numbers in one round-trip. */
  app.get("/stats", { preHandler: staff("VIEWER"), schema: { tags: ["reports"] } }, async (req) => {
    const organizationId = req.actor!.organizationId;
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 864e5);
    const [byStatus, overdue, warranty, service, value, byMinistry, recent] = await Promise.all([
      db.asset.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
      db.checkout.count({ where: { organizationId, checkedInAt: null, dueAt: { lt: now } } }),
      db.asset.findMany({
        where: { organizationId, retiredAt: null, warrantyEndsAt: { gte: now, lte: in60 } },
        orderBy: { warrantyEndsAt: "asc" },
        take: 10,
        select: { id: true, assetTag: true, name: true, warrantyEndsAt: true, itemType: { select: { name: true } } },
      }),
      db.asset.findMany({
        where: { organizationId, retiredAt: null, nextServiceAt: { lte: in60 } },
        orderBy: { nextServiceAt: "asc" },
        take: 10,
        select: { id: true, assetTag: true, name: true, nextServiceAt: true, itemType: { select: { name: true } } },
      }),
      db.asset.aggregate({ where: { organizationId, retiredAt: null }, _sum: { purchaseCost: true } }),
      db.asset.groupBy({ by: ["ministryId", "status"], where: { organizationId, retiredAt: null }, _count: true }),
      db.auditEvent.findMany({
        where: { organizationId, action: { in: ["asset.checkout", "asset.checkin", "asset.create"] } },
        orderBy: { occurredAt: "desc" },
        take: 12,
      }),
    ]);
    const ministries = await db.ministry.findMany({ where: { organizationId }, select: { id: true, name: true, color: true } });
    const ministryRows = ministries
      .map((m) => {
        const rows = byMinistry.filter((r) => r.ministryId === m.id);
        return {
          ...m,
          total: rows.reduce((s, r) => s + r._count, 0),
          checkedOut: rows.filter((r) => r.status === "CHECKED_OUT").reduce((s, r) => s + r._count, 0),
        };
      })
      .filter((m) => m.total > 0)
      .sort((a, b) => b.total - a.total);

    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count])) as Record<string, number>;
    const assetIds = [...new Set(recent.map((e) => e.entityId))];
    const assets = await db.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, assetTag: true, name: true, itemType: { select: { name: true } } } });
    const people = await db.person.findMany({ where: { id: { in: recent.map((e) => e.actorPersonId).filter((x): x is string => !!x) } }, select: { id: true, displayName: true } });
    const devices = await db.kioskDevice.findMany({ where: { id: { in: recent.map((e) => e.kioskDeviceId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });

    return {
      counts: {
        total: Object.entries(counts).filter(([k]) => k !== "RETIRED").reduce((s, [, v]) => s + v, 0),
        available: counts.AVAILABLE ?? 0,
        checkedOut: counts.CHECKED_OUT ?? 0,
        inService: counts.IN_SERVICE ?? 0,
        missing: counts.MISSING ?? 0,
        overdue,
      },
      totalValue: value._sum.purchaseCost?.toString() ?? "0",
      warrantyExpiring: warranty,
      serviceDue: service,
      byMinistry: ministryRows,
      recent: recent.map((e) => {
        const a = assets.find((x) => x.id === e.entityId);
        return {
          id: e.id.toString(),
          action: e.action,
          occurredAt: e.occurredAt,
          asset: a ? { id: a.id, assetTag: a.assetTag, displayName: a.name ?? a.itemType.name } : null,
          actor: people.find((p) => p.id === e.actorPersonId)?.displayName ?? devices.find((d) => d.id === e.kioskDeviceId)?.name ?? "System",
          via: e.kioskDeviceId ? devices.find((d) => d.id === e.kioskDeviceId)?.name ?? "Kiosk" : null,
          after: e.after,
        };
      }),
    };
  });

  app.get(
    "/audit",
    {
      preHandler: staff("VIEWER"),
      schema: {
        tags: ["reports"],
        querystring: z.object({
          entityType: z.string().max(40).optional(),
          entityId: z.string().max(64).optional(),
          action: z.string().max(60).optional(),
          batchId: uuid.optional(),
          before: z.coerce.bigint().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const q = req.query;
      const events = await db.auditEvent.findMany({
        where: {
          organizationId: req.actor!.organizationId,
          ...(q.entityType && { entityType: q.entityType }),
          ...(q.entityId && { entityId: q.entityId }),
          ...(q.action && { action: { startsWith: q.action } }),
          ...(q.batchId && { batchId: q.batchId }),
          ...(q.before && { id: { lt: q.before } }),
        },
        orderBy: { id: "desc" },
        take: q.limit,
      });
      const personIds = [...new Set(events.map((e) => e.actorPersonId).filter((x): x is string => !!x))];
      const deviceIds = [...new Set(events.map((e) => e.kioskDeviceId).filter((x): x is string => !!x))];
      const [people, devices] = await Promise.all([
        db.person.findMany({ where: { id: { in: personIds } }, select: { id: true, displayName: true } }),
        db.kioskDevice.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true } }),
      ]);
      const last = events.at(-1);
      return {
        items: events.map((e) => ({
          ...e,
          id: e.id.toString(),
          actorName: people.find((p) => p.id === e.actorPersonId)?.displayName ?? null,
          deviceName: devices.find((d) => d.id === e.kioskDeviceId)?.name ?? null,
        })),
        nextBefore: events.length === q.limit && last ? last.id.toString() : null,
      };
    },
  );
}
