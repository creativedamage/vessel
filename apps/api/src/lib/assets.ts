import type { Db, Prisma } from "@vessel/db";
import { badRequest } from "./errors.ts";

/** Everything a list row, a scan result or a cart item needs. */
export const assetSummaryInclude = {
  itemType: { select: { id: true, name: true, manufacturer: true, tracking: true, category: { select: { id: true, name: true, icon: true } } } },
  ministry: { select: { id: true, name: true, color: true } },
  homeCampus: { select: { id: true, name: true } },
  homeRoom: { select: { id: true, name: true } },
  currentRoom: { select: { id: true, name: true } },
  checkouts: {
    where: { checkedInAt: null },
    take: 1,
    select: {
      id: true, targetType: true, checkedOutAt: true, dueAt: true, batchId: true,
      assignee: { select: { id: true, displayName: true } },
      ministry: { select: { id: true, name: true } },
      room: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.AssetInclude;

type AssetWithSummary = Prisma.AssetGetPayload<{ include: typeof assetSummaryInclude }>;

export function toSummary(a: AssetWithSummary) {
  const { checkouts, ...rest } = a;
  const open = checkouts[0] ?? null;
  return {
    ...rest,
    purchaseCost: rest.purchaseCost?.toString() ?? null,
    displayName: rest.name ?? rest.itemType.name,
    openCheckout: open
      ? {
          ...open,
          heldBy: open.assignee?.displayName ?? open.ministry?.name ?? open.room?.name ?? "Unknown",
        }
      : null,
  };
}

export type AssetSummary = ReturnType<typeof toSummary>;

/** Normalise whatever a scanner produced: raw tag, lowercase, or a label URL like https://vsl.to/VSL-000123 */
export function normalizeCode(raw: string) {
  let code = raw.trim();
  if (/^https?:\/\//i.test(code)) {
    try {
      const url = new URL(code);
      code = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    } catch {
      /* keep as-is */
    }
  }
  return code.toUpperCase();
}

/** Atomically take the next tag number for an organization. */
export async function allocateTag(tx: Pick<Db, "$queryRaw">, organizationId: string) {
  const rows = await tx.$queryRaw<{ seq: number; prefix: string }[]>`
    UPDATE "Organization" SET "nextTagSeq" = "nextTagSeq" + 1
    WHERE id = ${organizationId}::uuid
    RETURNING "nextTagSeq" - 1 AS seq, "tagPrefix" AS prefix`;
  const row = rows[0];
  if (!row) throw new Error("Organization not found");
  return `${row.prefix}-${String(row.seq).padStart(6, "0")}`;
}

/**
 * Validate custom field values against the org's definitions (no migrations needed for new fields).
 * Unknown keys are rejected; values are coerced to the declared type.
 */
export async function validateCustomFields(
  db: Pick<Db, "customFieldDef">,
  organizationId: string,
  categoryId: string,
  values: Record<string, unknown>,
  { partial = false } = {},
) {
  const defs = await db.customFieldDef.findMany({
    where: { organizationId, archivedAt: null, OR: [{ categoryId: null }, { categoryId }] },
  });
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) {
      errors[key] = "Unknown field for this category";
      continue;
    }
    if (value === null || value === "") {
      if (def.required) errors[key] = `${def.label} is required`;
      continue;
    }
    switch (def.type) {
      case "NUMBER": {
        const n = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(n)) out[key] = n;
        else errors[key] = `${def.label} must be a number`;
        break;
      }
      case "BOOLEAN":
        if (typeof value === "boolean") out[key] = value;
        else if (value === "true" || value === "false") out[key] = value === "true";
        else errors[key] = `${def.label} must be yes or no`;
        break;
      case "DATE": {
        const d = new Date(String(value));
        if (Number.isNaN(d.getTime())) errors[key] = `${def.label} must be a date`;
        else out[key] = d.toISOString().slice(0, 10);
        break;
      }
      case "SELECT": {
        const options = (def.options as string[] | null) ?? [];
        if (options.includes(String(value))) out[key] = String(value);
        else errors[key] = `${def.label} must be one of: ${options.join(", ")}`;
        break;
      }
      case "MULTISELECT": {
        const options = (def.options as string[] | null) ?? [];
        const arr = Array.isArray(value) ? value.map(String) : [String(value)];
        const bad = arr.filter((v) => !options.includes(v));
        if (bad.length) errors[key] = `${def.label} has invalid options: ${bad.join(", ")}`;
        else out[key] = arr;
        break;
      }
      default:
        out[key] = String(value);
    }
  }
  if (!partial) {
    for (const def of defs) {
      if (def.required && !(def.key in out) && !(def.key in errors)) errors[def.key] = `${def.label} is required`;
    }
  }
  if (Object.keys(errors).length) throw badRequest("Some custom fields are invalid", { fields: errors });
  return out;
}
