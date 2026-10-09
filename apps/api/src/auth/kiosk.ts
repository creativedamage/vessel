import { importJWK, jwtVerify, SignJWT, type JWK } from "jose";
import type { Db } from "@vessel/db";
import type { Actor, KioskScope } from "./actor.ts";

const ISSUER = "vessel";
const AUDIENCE = "vessel-kiosk";
export const KIOSK_TOKEN_TTL_SECONDS = 3600;

const key = (secret: string) => new TextEncoder().encode(secret);

export function parseScope(raw: unknown): KioskScope {
  const s = (raw ?? {}) as Partial<KioskScope>;
  return {
    campusIds: Array.isArray(s.campusIds) ? s.campusIds : [],
    ministryIds: Array.isArray(s.ministryIds) ? s.ministryIds : [],
    actions: Array.isArray(s.actions) && s.actions.length ? s.actions : ["checkout", "checkin", "lookup"],
  };
}

/** Mint a short-lived kiosk access token (HS256, server secret). */
export async function mintKioskToken(secret: string, device: { id: string; organizationId: string }) {
  return new SignJWT({ org: device.organizationId, typ: "kiosk" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(device.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${KIOSK_TOKEN_TTL_SECONDS}s`)
    .sign(key(secret));
}

/** Validate a kiosk access token and load the (non-revoked) device. */
export async function resolveKioskToken(db: Db, secret: string, token: string): Promise<Actor | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, audience: AUDIENCE });
    if (payload.typ !== "kiosk" || !payload.sub) return null;
    const device = await db.kioskDevice.findUnique({ where: { id: payload.sub } });
    if (!device || device.revokedAt) return null;
    return {
      kind: "kiosk",
      organizationId: device.organizationId,
      deviceId: device.id,
      scope: parseScope(device.scope),
      requirePin: device.requirePin,
      name: device.name,
    };
  } catch {
    return null;
  }
}

/**
 * Verify a device assertion: a JWT signed (ES256) by the device's private key,
 * `sub` = deviceId, issued within the last 2 minutes. Proves possession of the enrolled key.
 */
export async function verifyDeviceAssertion(db: Db, assertion: string) {
  const [, payloadB64] = assertion.split(".");
  if (!payloadB64) return null;
  let sub: string | undefined;
  try {
    sub = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")).sub;
  } catch {
    return null;
  }
  if (!sub) return null;
  const device = await db.kioskDevice.findUnique({ where: { id: sub } });
  if (!device || device.revokedAt) return null;
  try {
    const publicKey = await importJWK(device.publicKeyJwk as JWK, "ES256");
    const { payload } = await jwtVerify(assertion, publicKey, { subject: device.id, maxTokenAge: "2m", audience: AUDIENCE });
    if (!payload.iat) return null;
    return device;
  } catch {
    return null;
  }
}

export { AUDIENCE as KIOSK_AUDIENCE };
