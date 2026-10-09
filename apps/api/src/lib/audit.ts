import type { FastifyRequest } from "fastify";
import type { Prisma } from "@vessel/db";
import type { Actor } from "../auth/actor.ts";

type Tx = Pick<Prisma.TransactionClient, "auditEvent">;

export interface AuditInput {
  action: string; // "asset.checkout", "asset.update", ...
  entityType: string;
  entityId: string;
  batchId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Volunteer identified by PIN on a kiosk, if any. */
  onBehalfOfPersonId?: string | null;
}

const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

/** Append one audit event. Call inside the same transaction as the change. */
export async function audit(tx: Tx, actor: Actor | null, req: FastifyRequest | null, input: AuditInput) {
  const base = {
    organizationId: actor?.organizationId ?? "",
    ip: req?.ip ?? null,
    userAgent: (req?.headers["user-agent"] as string | undefined) ?? null,
  };
  const actorFields =
    actor?.kind === "staff"
      ? { actorType: "STAFF" as const, actorPersonId: actor.personId, kioskDeviceId: null }
      : actor?.kind === "kiosk"
        ? { actorType: "VOLUNTEER_KIOSK" as const, actorPersonId: input.onBehalfOfPersonId ?? null, kioskDeviceId: actor.deviceId }
        : { actorType: "SYSTEM_SYNC" as const, actorPersonId: null, kioskDeviceId: null };

  await tx.auditEvent.create({
    data: {
      ...base,
      ...actorFields,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      batchId: input.batchId ?? null,
      before: json(input.before),
      after: json(input.after),
    },
  });
}
