import { z } from "zod";
import type { FastifyReply } from "fastify";
import type { App, Deps } from "../app.ts";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/errors.ts";
import { createStaffSession, revokeStaffSession, SESSION_COOKIE } from "../auth/sessions.ts";
import { configuredProviders, finishLogin, startLogin, type OidcTransaction, type Provider } from "../auth/oidc.ts";
import { requireActor } from "../auth/actor.ts";
import { audit } from "../lib/audit.ts";

const OIDC_TX_COOKIE = "vessel_oidc";

export default function authRoutes(app: App, { db, env }: Deps) {
  const secure = env.NODE_ENV === "production";
  const setSessionCookie = (reply: Pick<FastifyReply, "setCookie">, token: string, expiresAt: Date) =>
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", expires: expiresAt });

  app.get("/auth/providers", { schema: { tags: ["auth"] } }, async () => ({
    devLogin: env.AUTH_DEV_LOGIN,
    sso: configuredProviders(env),
  }));

  /** Development only: sign in as any active staff member by email. */
  app.post(
    "/auth/dev-login",
    {
      schema: {
        tags: ["auth"],
        body: z.object({ email: z.string().email(), client: z.enum(["WEB", "MACOS", "MOBILE"]).default("WEB") }),
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      if (!env.AUTH_DEV_LOGIN) throw notFound("Route");
      const person = await db.person.findFirst({
        where: { email: req.body.email.toLowerCase(), kind: "STAFF", active: true, role: { not: null } },
      });
      if (!person) throw unauthorized("No active staff member with that email");
      const { token, expiresAt } = await createStaffSession(db, person.id, req.body.client);
      setSessionCookie(reply, token, expiresAt);
      return { token, expiresAt };
    },
  );

  app.get(
    "/auth/oidc/:provider/start",
    {
      schema: {
        tags: ["auth"],
        params: z.object({ provider: z.enum(["entra", "google"]) }),
        querystring: z.object({ returnTo: z.string().startsWith("/").default("/") }),
      },
    },
    async (req, reply) => {
      const provider = req.params.provider as Provider;
      if (!configuredProviders(env).includes(provider)) throw badRequest(`${provider} sign-in is not configured`);
      const { url, tx } = await startLogin(env, provider, req.query.returnTo);
      reply.setCookie(OIDC_TX_COOKIE, JSON.stringify(tx), {
        httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 600, signed: true,
      });
      return reply.redirect(url);
    },
  );

  app.get(
    "/auth/oidc/:provider/callback",
    { schema: { tags: ["auth"], params: z.object({ provider: z.enum(["entra", "google"]) }) } },
    async (req, reply) => {
      const fail = (code: string) => reply.redirect(`${env.WEB_ORIGIN}/login?error=${code}`);
      const raw = req.cookies[OIDC_TX_COOKIE];
      const unsigned = raw ? req.unsignCookie(raw) : null;
      reply.clearCookie(OIDC_TX_COOKIE, { path: "/" });
      if (!unsigned?.valid || !unsigned.value) return fail("expired");
      const tx = JSON.parse(unsigned.value) as OidcTransaction;
      if (tx.provider !== req.params.provider) return fail("mismatch");

      // Rebuild the URL the browser hit (the web app proxies /api/* to us).
      const current = new URL(`${env.WEB_ORIGIN}/api${req.url}`);
      let identity;
      try {
        identity = await finishLogin(env, tx, current);
      } catch (e) {
        req.log.warn({ err: e }, "OIDC login failed");
        return fail("sso_failed");
      }

      // 1) Already linked by immutable id.
      let person = await db.person.findFirst({
        where: { externalSource: identity.source, externalId: identity.externalId, kind: "STAFF", active: true },
      });
      // 2) First sign-in: match by email inside an org whose IdP config trusts this tenant/domain.
      if (!person && identity.email && identity.tenantOrDomain) {
        const idp = await db.identityProvider.findFirst({
          where: { source: identity.source, tenantOrDomain: identity.tenantOrDomain },
        });
        if (idp) {
          const candidate = await db.person.findFirst({
            where: { organizationId: idp.organizationId, email: identity.email, kind: "STAFF", active: true },
          });
          if (candidate) {
            person = await db.person.update({
              where: { id: candidate.id },
              data: { externalSource: identity.source, externalId: identity.externalId },
            });
          }
        }
      }
      if (!person || !person.role) return fail("not_provisioned");

      const { token, expiresAt } = await createStaffSession(db, person.id, "WEB");
      await audit(db, { kind: "staff", organizationId: person.organizationId, personId: person.id, role: person.role, sessionId: "", displayName: person.displayName }, req, {
        action: "staff.signin", entityType: "Person", entityId: person.id, after: { source: identity.source },
      });
      setSessionCookie(reply, token, expiresAt);
      return reply.redirect(`${env.WEB_ORIGIN}${tx.returnTo}`);
    },
  );

  app.post("/auth/logout", { schema: { tags: ["auth"] } }, async (req, reply) => {
    if (req.actor?.kind === "staff") await revokeStaffSession(db, req.actor.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/me", { schema: { tags: ["auth"] } }, async (req) => {
    const actor = requireActor(req);
    const org = await db.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { id: true, name: true, slug: true, tagPrefix: true, timezone: true },
    });
    if (actor.kind === "kiosk") {
      return { kind: "kiosk" as const, organization: org, device: { id: actor.deviceId, name: actor.name, scope: actor.scope, requirePin: actor.requirePin } };
    }
    const person = await db.person.findUnique({
      where: { id: actor.personId },
      select: { id: true, displayName: true, email: true, role: true },
    });
    if (!person) throw forbidden();
    return { kind: "staff" as const, organization: org, person };
  });
}
