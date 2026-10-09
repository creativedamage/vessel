import { z } from "zod";
import type { App, Deps } from "../app.ts";
import { staff, staffActor, staffOrKiosk } from "../auth/actor.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, notFound } from "../lib/errors.ts";

const uuid = z.string().uuid();

export default function placeRoutes(app: App, { db }: Deps) {
  /** Campuses with a flat room list (clients build the tree from parentId). */
  app.get("/campuses", { preHandler: staff("VIEWER"), schema: { tags: ["places"] } }, async (req) => {
    const organizationId = req.actor!.organizationId;
    const [campuses, counts] = await Promise.all([
      db.campus.findMany({
        where: { organizationId, archivedAt: null },
        orderBy: { name: "asc" },
        include: {
          rooms: {
            where: { archivedAt: null },
            orderBy: { path: "asc" },
            select: { id: true, name: true, kind: true, parentId: true, qrCode: true, path: true },
          },
        },
      }),
      db.asset.groupBy({ by: ["homeRoomId"], where: { organizationId, retiredAt: null }, _count: true }),
    ]);
    const byRoom = new Map(counts.map((c) => [c.homeRoomId, c._count]));
    return {
      items: campuses.map((c) => ({
        ...c,
        rooms: c.rooms.map((r) => ({ ...r, assetCount: byRoom.get(r.id) ?? 0 })),
      })),
    };
  });

  app.post(
    "/campuses",
    { preHandler: staff("ADMIN"), schema: { tags: ["places"], body: z.object({ name: z.string().trim().min(1).max(120), address: z.string().max(300).optional() }) } },
    async (req, reply) => {
      const actor = staffActor(req);
      const campus = await db.$transaction(async (tx) => {
        const c = await tx.campus.create({ data: { ...req.body, organizationId: actor.organizationId } });
        await audit(tx, actor, req, { action: "campus.create", entityType: "Campus", entityId: c.id, after: req.body });
        return c;
      });
      return reply.status(201).send(campus);
    },
  );

  app.post(
    "/rooms",
    {
      preHandler: staff("ADMIN"),
      schema: {
        tags: ["places"],
        body: z.object({
          campusId: uuid,
          parentId: uuid.optional(),
          name: z.string().trim().min(1).max(120),
          kind: z.enum(["BUILDING", "FLOOR", "ROOM", "STORAGE", "SHELF"]).default("ROOM"),
        }),
      },
    },
    async (req, reply) => {
      const actor = staffActor(req);
      const { campusId, parentId, name, kind } = req.body;
      const campus = await db.campus.findFirst({ where: { id: campusId, organizationId: actor.organizationId } });
      if (!campus) throw badRequest("Campus not found");
      let parentPath = `/${campus.id}`;
      if (parentId) {
        const parent = await db.room.findFirst({ where: { id: parentId, organizationId: actor.organizationId, campusId } });
        if (!parent) throw badRequest("Parent room not found on that campus");
        parentPath = parent.path;
      }
      const room = await db.$transaction(async (tx) => {
        const r = await tx.room.create({ data: { organizationId: actor.organizationId, campusId, parentId, name, kind, path: "pending" } });
        const updated = await tx.room.update({
          where: { id: r.id },
          data: { path: `${parentPath}/${r.id}`, qrCode: `RM-${r.id.slice(0, 8).toUpperCase()}` },
        });
        await audit(tx, actor, req, { action: "room.create", entityType: "Room", entityId: r.id, after: req.body });
        return updated;
      });
      return reply.status(201).send(room);
    },
  );

  app.get("/ministries", { preHandler: staff("VIEWER"), schema: { tags: ["places"] } }, async (req) => {
    const organizationId = req.actor!.organizationId;
    const [ministries, counts] = await Promise.all([
      db.ministry.findMany({
        where: { organizationId, archivedAt: null },
        orderBy: { name: "asc" },
        include: { leaders: { where: { isLeader: true }, select: { person: { select: { id: true, displayName: true } } } } },
      }),
      db.asset.groupBy({ by: ["ministryId"], where: { organizationId, retiredAt: null }, _count: true }),
    ]);
    const byMinistry = new Map(counts.map((c) => [c.ministryId, c._count]));
    return {
      items: ministries.map(({ leaders, ...m }) => ({ ...m, leaders: leaders.map((l) => l.person), assetCount: byMinistry.get(m.id) ?? 0 })),
    };
  });

  app.post(
    "/ministries",
    {
      preHandler: staff("ADMIN"),
      schema: {
        tags: ["places"],
        body: z.object({
          name: z.string().trim().min(1).max(120),
          parentId: uuid.optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
          isLegalEntity: z.boolean().default(false),
        }),
      },
    },
    async (req, reply) => {
      const actor = staffActor(req);
      if (req.body.parentId && !(await db.ministry.findFirst({ where: { id: req.body.parentId, organizationId: actor.organizationId } }))) {
        throw notFound("Parent ministry");
      }
      const m = await db.$transaction(async (tx) => {
        const created = await tx.ministry.create({ data: { ...req.body, organizationId: actor.organizationId } });
        await audit(tx, actor, req, { action: "ministry.create", entityType: "Ministry", entityId: created.id, after: req.body });
        return created;
      });
      return reply.status(201).send(m);
    },
  );

  /** One-tap targets for the scanner: ministries + rooms in the caller's scope. */
  app.get("/destinations", { preHandler: staffOrKiosk("checkout", "VIEWER"), schema: { tags: ["places"] } }, async (req) => {
    const actor = req.actor!;
    const campusFilter = actor.kind === "kiosk" && actor.scope.campusIds.length ? { campusId: { in: actor.scope.campusIds } } : {};
    const ministryFilter = actor.kind === "kiosk" && actor.scope.ministryIds.length ? { id: { in: actor.scope.ministryIds } } : {};
    const [ministries, rooms] = await Promise.all([
      db.ministry.findMany({
        where: { organizationId: actor.organizationId, archivedAt: null, ...ministryFilter },
        orderBy: { name: "asc" },
        select: { id: true, name: true, color: true, parentId: true },
      }),
      db.room.findMany({
        where: { organizationId: actor.organizationId, archivedAt: null, kind: { in: ["ROOM", "STORAGE"] }, ...campusFilter },
        orderBy: { name: "asc" },
        select: { id: true, name: true, kind: true, campus: { select: { id: true, name: true } } },
      }),
    ]);
    return { ministries, rooms };
  });
}
