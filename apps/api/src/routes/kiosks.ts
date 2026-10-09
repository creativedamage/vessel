import { z } from "zod";
import type { Prisma } from "@vessel/db";
import type { App, Deps } from "../app.ts";
import { staff, staffActor } from "../auth/actor.ts";
import { KIOSK_TOKEN_TTL_SECONDS, mintKioskToken, parseScope, verifyDeviceAssertion } from "../auth/kiosk.ts";
import { audit } from "../lib/audit.ts";
import { enrollmentCode, sha256 } from "../lib/crypto.ts";
import { badRequest, notFound, unauthorized } from "../lib/errors.ts";

const uuid = z.string().uuid();
const ENROLLMENT_MINUTES = 15;

const PublicJwk = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string().min(20), y: z.string().min(20) });

export default function kioskRoutes(app: App, { db, env }: Deps) {
  /** Admin creates a one-time code, shown as a QR on screen. */
  app.post(
    "/kiosks/enrollments",
    {
      preHandler: staff("ADMIN"),
      schema: {
        tags: ["kiosks"],
        body: z.object({
          name: z.string().trim().min(1).max(80),
          campusIds: z.array(uuid).default([]),
          ministryIds: z.array(uuid).default([]),
          actions: z.array(z.enum(["checkout", "checkin", "lookup"])).min(1).default(["checkout", "checkin", "lookup"]),
          requirePin: z.boolean().default(false),
        }),
      },
    },
    async (req, reply) => {
      const actor = staffActor(req);
      const { name, campusIds, ministryIds, actions, requirePin } = req.body;
      if (campusIds.length) {
        const n = await db.campus.count({ where: { organizationId: actor.organizationId, id: { in: campusIds } } });
        if (n !== campusIds.length) throw badRequest("Unknown campus in scope");
      }
      const code = enrollmentCode();
      const expiresAt = new Date(Date.now() + ENROLLMENT_MINUTES * 60e3);
      const enrollment = await db.kioskEnrollment.create({
        data: {
          organizationId: actor.organizationId,
          codeHash: sha256(code),
          name,
          scope: { campusIds, ministryIds, actions } as Prisma.InputJsonValue,
          requirePin,
          createdById: actor.personId,
          expiresAt,
        },
      });
      await audit(db, actor, req, { action: "kiosk.enrollment.create", entityType: "KioskEnrollment", entityId: enrollment.id, after: { name, campusIds, ministryIds, actions, requirePin } });
      // The QR encodes this deep link; the app also accepts the bare code typed in.
      const enrollUrl = `vessel://enroll?server=${encodeURIComponent(env.WEB_ORIGIN)}&code=${code}`;
      return reply.status(201).send({ id: enrollment.id, code, expiresAt, enrollUrl });
    },
  );

  app.get("/kiosks", { preHandler: staff("ADMIN"), schema: { tags: ["kiosks"] } }, async (req) => {
    const devices = await db.kioskDevice.findMany({
      where: { organizationId: req.actor!.organizationId },
      orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { enrolledAt: "desc" }],
      select: { id: true, name: true, scope: true, requirePin: true, enrolledAt: true, lastSeenAt: true, revokedAt: true, _count: { select: { checkouts: true } } },
    });
    return { items: devices.map((d) => ({ ...d, scope: parseScope(d.scope) })) };
  });

  app.post("/kiosks/:id/revoke", { preHandler: staff("ADMIN"), schema: { tags: ["kiosks"], params: z.object({ id: uuid }) } }, async (req) => {
    const actor = staffActor(req);
    const device = await db.kioskDevice.findFirst({ where: { id: req.params.id, organizationId: actor.organizationId } });
    if (!device) throw notFound("Device");
    await db.$transaction(async (tx) => {
      await tx.kioskDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
      await audit(tx, actor, req, { action: "kiosk.revoke", entityType: "KioskDevice", entityId: device.id });
    });
    return { ok: true };
  });

  /** Device redeems the code and registers its public key. Unauthenticated by design. */
  app.post(
    "/kiosks/enroll",
    {
      schema: { tags: ["kiosks"], body: z.object({ code: z.string().trim().toUpperCase(), publicKeyJwk: PublicJwk, deviceModel: z.string().max(80).optional() }) },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const code = req.body.code.replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");
      const enrollment = await db.kioskEnrollment.findUnique({ where: { codeHash: sha256(code) } });
      if (!enrollment || enrollment.usedAt || enrollment.expiresAt < new Date()) throw unauthorized("That code is invalid or has expired");

      const device = await db.$transaction(async (tx) => {
        const claimed = await tx.kioskEnrollment.updateMany({ where: { id: enrollment.id, usedAt: null }, data: { usedAt: new Date() } });
        if (claimed.count === 0) throw unauthorized("That code was already used");
        const d = await tx.kioskDevice.create({
          data: {
            organizationId: enrollment.organizationId,
            name: enrollment.name,
            publicKeyJwk: req.body.publicKeyJwk as Prisma.InputJsonValue,
            scope: enrollment.scope as Prisma.InputJsonValue,
            requirePin: enrollment.requirePin,
            enrolledById: enrollment.createdById,
          },
        });
        await tx.kioskEnrollment.update({ where: { id: enrollment.id }, data: { deviceId: d.id } });
        await tx.auditEvent.create({
          data: {
            organizationId: d.organizationId, actorType: "VOLUNTEER_KIOSK", kioskDeviceId: d.id, actorPersonId: enrollment.createdById,
            action: "kiosk.enroll", entityType: "KioskDevice", entityId: d.id, after: { name: d.name, deviceModel: req.body.deviceModel ?? null }, ip: req.ip,
          },
        });
        return d;
      });
      const org = await db.organization.findUniqueOrThrow({ where: { id: device.organizationId }, select: { id: true, name: true, tagPrefix: true } });
      return reply.status(201).send({ deviceId: device.id, name: device.name, organization: org, scope: parseScope(device.scope), requirePin: device.requirePin });
    },
  );

  /** Exchange a device-signed assertion (ES256 JWT, sub = deviceId) for a 1-hour access token. */
  app.post(
    "/kiosks/token",
    { schema: { tags: ["kiosks"], body: z.object({ assertion: z.string().min(20).max(4000) }) }, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      const device = await verifyDeviceAssertion(db, req.body.assertion);
      if (!device) throw unauthorized("Device is not enrolled or has been revoked");
      await db.kioskDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      return { accessToken: await mintKioskToken(env.SESSION_SECRET, device), expiresIn: KIOSK_TOKEN_TTL_SECONDS, tokenType: "Bearer" };
    },
  );
}
