import type { ClientKind, Db } from "@vessel/db";
import { randomToken, sha256 } from "../lib/crypto.ts";
import type { Actor } from "./actor.ts";

export const SESSION_COOKIE = "vessel_session";
const SESSION_DAYS = 30;
/** Staff opaque tokens are prefixed so the actor resolver can tell them from kiosk JWTs. */
export const STAFF_TOKEN_PREFIX = "vs_";

export async function createStaffSession(db: Db, personId: string, client: ClientKind) {
  const token = STAFF_TOKEN_PREFIX + randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.staffSession.create({ data: { personId, client, tokenHash: sha256(token), expiresAt } });
  return { token, expiresAt };
}

export async function resolveStaffSession(db: Db, token: string): Promise<Actor | null> {
  const session = await db.staffSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { person: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const p = session.person;
  if (!p.active || p.kind !== "STAFF" || !p.role) return null;
  return {
    kind: "staff",
    organizationId: p.organizationId,
    personId: p.id,
    role: p.role,
    sessionId: session.id,
    displayName: p.displayName,
  };
}

export async function revokeStaffSession(db: Db, sessionId: string) {
  await db.staffSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}
