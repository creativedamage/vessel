import Fastify, { type FastifyBaseLogger, type FastifyInstance, type RawReplyDefaultExpression, type RawRequestDefaultExpression, type RawServerDefault } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Db } from "@vessel/db";
import type { Env } from "./env.ts";
import { HttpError } from "./lib/errors.ts";
import { resolveStaffSession, SESSION_COOKIE, STAFF_TOKEN_PREFIX } from "./auth/sessions.ts";
import { resolveKioskToken } from "./auth/kiosk.ts";
import authRoutes from "./routes/auth.ts";
import scanRoutes from "./routes/scan.ts";
import assetRoutes from "./routes/assets.ts";
import checkoutRoutes from "./routes/checkouts.ts";
import peopleRoutes from "./routes/people.ts";
import placeRoutes from "./routes/places.ts";
import catalogRoutes from "./routes/catalog.ts";
import kioskRoutes from "./routes/kiosks.ts";
import reportRoutes from "./routes/reports.ts";

export type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, FastifyBaseLogger, ZodTypeProvider>;
export interface Deps {
  db: Db;
  env: Env;
}

export async function buildApp(deps: Deps, opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie, { secret: deps.env.SESSION_SECRET });
  await app.register(cors, { origin: [deps.env.WEB_ORIGIN], credentials: true });
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: { info: { title: "Vessel API", version: "0.1.0" }, servers: [] },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  // ── Resolve who is calling: staff session (cookie or bearer) or kiosk token ──
  app.decorateRequest("actor", null);
  app.addHook("onRequest", async (req) => {
    req.actor = null;
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    const cookieToken = req.cookies[SESSION_COOKIE];
    if (bearer && !bearer.startsWith(STAFF_TOKEN_PREFIX)) {
      req.actor = await resolveKioskToken(deps.db, deps.env.SESSION_SECRET, bearer);
      return;
    }
    const token = bearer ?? cookieToken;
    if (token) req.actor = await resolveStaffSession(deps.db, token);
  });

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: "validation",
        message: "Some fields are invalid",
        issues: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: "request_error", message: (err as Error).message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal", message: "Something went wrong" });
  });

  app.get("/health", { schema: { hide: true } }, async () => ({ ok: true }));

  await app.register(
    async (v1) => {
      const api = v1 as unknown as App;
      authRoutes(api, deps);
      scanRoutes(api, deps);
      assetRoutes(api, deps);
      checkoutRoutes(api, deps);
      peopleRoutes(api, deps);
      placeRoutes(api, deps);
      catalogRoutes(api, deps);
      kioskRoutes(api, deps);
      reportRoutes(api, deps);
    },
    { prefix: "/v1" },
  );

  return app;
}
