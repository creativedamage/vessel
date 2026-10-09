import { z } from "zod";
import type { Prisma } from "@vessel/db";
import type { App, Deps } from "../app.ts";
import { staff, staffActor } from "../auth/actor.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, conflict } from "../lib/errors.ts";

const uuid = z.string().uuid();

export default function catalogRoutes(app: App, { db }: Deps) {
  app.get("/categories", { preHandler: staff("VIEWER"), schema: { tags: ["catalog"] } }, async (req) => ({
    items: await db.category.findMany({
      where: { organizationId: req.actor!.organizationId },
      orderBy: { name: "asc" },
      include: { _count: { select: { itemTypes: true } } },
    }),
  }));

  app.post(
    "/categories",
    { preHandler: staff("ADMIN"), schema: { tags: ["catalog"], body: z.object({ name: z.string().trim().min(1).max(80), icon: z.string().max(40).optional() }) } },
    async (req, reply) => {
      const actor = staffActor(req);
      if (await db.category.findFirst({ where: { organizationId: actor.organizationId, name: req.body.name } })) throw conflict("That category already exists");
      const c = await db.category.create({ data: { ...req.body, organizationId: actor.organizationId } });
      await audit(db, actor, req, { action: "category.create", entityType: "Category", entityId: c.id, after: req.body });
      return reply.status(201).send(c);
    },
  );

  app.get("/item-types", { preHandler: staff("VIEWER"), schema: { tags: ["catalog"], querystring: z.object({ categoryId: uuid.optional() }) } }, async (req) => ({
    items: await db.itemType.findMany({
      where: { organizationId: req.actor!.organizationId, ...(req.query.categoryId && { categoryId: req.query.categoryId }) },
      orderBy: { name: "asc" },
      include: { category: { select: { id: true, name: true } }, _count: { select: { assets: true } } },
    }),
  }));

  app.post(
    "/item-types",
    {
      preHandler: staff("MANAGER"),
      schema: {
        tags: ["catalog"],
        body: z.object({
          categoryId: uuid,
          name: z.string().trim().min(1).max(120),
          manufacturer: z.string().max(120).optional(),
          modelNumber: z.string().max(120).optional(),
          tracking: z.enum(["INDIVIDUAL", "BULK"]).default("INDIVIDUAL"),
          serviceIntervalDays: z.number().int().min(1).max(3650).optional(),
        }),
      },
    },
    async (req, reply) => {
      const actor = staffActor(req);
      if (!(await db.category.findFirst({ where: { id: req.body.categoryId, organizationId: actor.organizationId } }))) throw badRequest("Category not found");
      if (await db.itemType.findFirst({ where: { organizationId: actor.organizationId, name: req.body.name } })) throw conflict("An item type with that name exists");
      const t = await db.itemType.create({ data: { ...req.body, organizationId: actor.organizationId } });
      await audit(db, actor, req, { action: "itemType.create", entityType: "ItemType", entityId: t.id, after: req.body });
      return reply.status(201).send(t);
    },
  );

  app.get("/custom-fields", { preHandler: staff("VIEWER"), schema: { tags: ["catalog"] } }, async (req) => ({
    items: await db.customFieldDef.findMany({
      where: { organizationId: req.actor!.organizationId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      include: { category: { select: { id: true, name: true } } },
    }),
  }));

  app.post(
    "/custom-fields",
    {
      preHandler: staff("ADMIN"),
      schema: {
        tags: ["catalog"],
        body: z.object({
          key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Use lowercase letters, digits and underscores"),
          label: z.string().trim().min(1).max(80),
          type: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT", "MULTISELECT", "URL", "ROOM_REF", "PERSON_REF"]),
          categoryId: uuid.optional(),
          options: z.array(z.string().min(1).max(80)).max(100).optional(),
          required: z.boolean().default(false),
          showOnMobile: z.boolean().default(false),
          sortOrder: z.number().int().default(0),
        }),
      },
    },
    async (req, reply) => {
      const actor = staffActor(req);
      const body = req.body;
      if ((body.type === "SELECT" || body.type === "MULTISELECT") && !body.options?.length) throw badRequest("Choice fields need at least one option");
      if (await db.customFieldDef.findFirst({ where: { organizationId: actor.organizationId, key: body.key } })) throw conflict("A field with that key exists");
      const def = await db.customFieldDef.create({
        data: { ...body, options: body.options as Prisma.InputJsonValue | undefined, organizationId: actor.organizationId },
      });
      await audit(db, actor, req, { action: "customField.create", entityType: "CustomFieldDef", entityId: def.id, after: body });
      return reply.status(201).send(def);
    },
  );
}
