import path from "node:path";
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createDb, type Db } from "@vessel/db";
import { seedDemo, type SeedSummary } from "@vessel/db/seed-data";
import { buildApp } from "../src/app.ts";
import { loadEnv } from "../src/env.ts";
import { KIOSK_AUDIENCE } from "../src/auth/kiosk.ts";

loadDotenv({ path: path.resolve(import.meta.dirname, "../../../.env") });

export const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgresql://vessel:vessel@localhost:5432/vessel_test";

export async function setupTestApp() {
  const env = loadEnv({
    ...process.env,
    DATABASE_URL: TEST_URL,
    SESSION_SECRET: "test-secret-test-secret-test-secret-123",
    AUTH_DEV_LOGIN: "true",
    NODE_ENV: "test",
  });
  const db = createDb(TEST_URL);
  await wipe(db);
  const seed = await seedDemo(db);
  const app = await buildApp({ db, env }, { logger: false });
  await app.ready();
  return { app, db, seed, env };
}

export type TestCtx = Awaited<ReturnType<typeof setupTestApp>>;

/** TRUNCATE skips the append-only row trigger, so tests can start clean. */
async function wipe(db: Db) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

export async function login(ctx: TestCtx, email = "admin@grace.example") {
  const res = await ctx.app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const token = res.json().token as string;
  return { authorization: `Bearer ${token}` };
}

export async function assetIdsByTag(db: Db, tags: string[]) {
  const rows = await db.asset.findMany({ where: { assetTag: { in: tags } }, select: { id: true, assetTag: true } });
  return tags.map((t) => rows.find((r) => r.assetTag === t)!.id);
}

export const items = (assetIds: string[]) => assetIds.map((assetId) => ({ assetId, clientOpId: randomUUID() }));

/** Full kiosk enrollment as a phone would do it: keypair → enroll → signed assertion → access token. */
export async function enrollKiosk(ctx: TestCtx, opts: { requirePin?: boolean; campusIds?: string[] } = {}) {
  const staff = await login(ctx);
  const enrollment = await ctx.app.inject({
    method: "POST",
    url: "/v1/kiosks/enrollments",
    headers: staff,
    payload: { name: "Lobby iPad", requirePin: opts.requirePin ?? false, campusIds: opts.campusIds ?? [] },
  });
  if (enrollment.statusCode !== 201) throw new Error(enrollment.body);
  const { code } = enrollment.json();

  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  const enrolled = await ctx.app.inject({
    method: "POST",
    url: "/v1/kiosks/enroll",
    payload: { code: code.toLowerCase(), publicKeyJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } },
  });
  if (enrolled.statusCode !== 201) throw new Error(enrolled.body);
  const { deviceId } = enrolled.json();

  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(deviceId)
    .setAudience(KIOSK_AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .sign(privateKey);
  const tokenRes = await ctx.app.inject({ method: "POST", url: "/v1/kiosks/token", payload: { assertion } });
  if (tokenRes.statusCode !== 200) throw new Error(tokenRes.body);
  return { deviceId, headers: { authorization: `Bearer ${tokenRes.json().accessToken}` }, privateKey, staff };
}

export type { SeedSummary };
