import type { FastifyReply, FastifyRequest } from "fastify";
import type { StaffRole } from "@vessel/db";
import { forbidden, unauthorized } from "../lib/errors.ts";

export type KioskAction = "checkout" | "checkin" | "lookup";

export interface KioskScope {
  campusIds: string[]; // empty = every campus
  ministryIds: string[]; // empty = every ministry
  actions: KioskAction[];
}

export type Actor =
  | { kind: "staff"; organizationId: string; personId: string; role: StaffRole; sessionId: string; displayName: string }
  | { kind: "kiosk"; organizationId: string; deviceId: string; scope: KioskScope; requirePin: boolean; name: string };

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

const RANK: Record<StaffRole, number> = { VIEWER: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };

export const hasRole = (actual: StaffRole, min: StaffRole) => RANK[actual] >= RANK[min];

export function requireActor(req: FastifyRequest): Actor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}

/** preHandler: staff only, with at least `min` role. */
export function staff(min: StaffRole = "VIEWER") {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const actor = requireActor(req);
    if (actor.kind !== "staff") throw forbidden("Staff sign-in required");
    if (!hasRole(actor.role, min)) throw forbidden(`Requires ${min.toLowerCase()} role or higher`);
  };
}

/** preHandler: staff (at least `min`) or a kiosk device allowed to perform `action`. */
export function staffOrKiosk(action: KioskAction, min: StaffRole = "MANAGER") {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const actor = requireActor(req);
    if (actor.kind === "staff") {
      if (!hasRole(actor.role, min)) throw forbidden(`Requires ${min.toLowerCase()} role or higher`);
      return;
    }
    if (!actor.scope.actions.includes(action)) throw forbidden(`This device can't ${action}`);
  };
}

export function staffActor(req: FastifyRequest) {
  const a = requireActor(req);
  if (a.kind !== "staff") throw forbidden("Staff sign-in required");
  return a;
}

export function inKioskCampusScope(actor: Actor, campusId: string | null | undefined) {
  if (actor.kind !== "kiosk") return true;
  if (actor.scope.campusIds.length === 0) return true;
  return !!campusId && actor.scope.campusIds.includes(campusId);
}
