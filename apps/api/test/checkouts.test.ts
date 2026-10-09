import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assetIdsByTag, items, login, setupTestApp, type TestCtx } from "./helpers.ts";

let ctx: TestCtx;
let staff: { authorization: string };

beforeAll(async () => {
  ctx = await setupTestApp();
  staff = await login(ctx);
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.db.$disconnect();
});

describe("batch check-out / check-in", () => {
  it("checks out 20 items to a ministry in one call and audits every one (M1 gate)", async () => {
    const ids = await assetIdsByTag(ctx.db, ctx.seed.assetTags.slice(0, 20));
    const batchId = randomUUID();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/checkouts/batch",
      headers: staff,
      payload: { batchId, target: { type: "MINISTRY", ministryId: ctx.seed.ministryIds.youth }, items: items(ids) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.succeeded).toBe(20);
    expect(body.failed).toBe(0);
    expect(body.target).toBe("Youth");

    const out = await ctx.db.asset.count({ where: { id: { in: ids }, status: "CHECKED_OUT" } });
    expect(out).toBe(20);
    const events = await ctx.db.auditEvent.count({ where: { batchId, action: "asset.checkout" } });
    expect(events).toBe(20);
  });

  it("is idempotent: replaying the same clientOpIds returns duplicates, not errors", async () => {
    const [id] = await assetIdsByTag(ctx.db, [ctx.seed.assetTags[25]!]);
    const payload = { batchId: randomUUID(), target: { type: "PERSON", personId: ctx.seed.volunteerIds[0] }, items: items([id!]) };
    const first = await ctx.app.inject({ method: "POST", url: "/v1/checkouts/batch", headers: staff, payload });
    const second = await ctx.app.inject({ method: "POST", url: "/v1/checkouts/batch", headers: staff, payload });
    expect(first.json().results[0].status).toBe("ok");
    expect(second.json().results[0].status).toBe("duplicate");
    expect(second.json().results[0].checkoutId).toBe(first.json().results[0].checkoutId);
    expect(await ctx.db.checkout.count({ where: { assetId: id } })).toBe(1);
  });

  it("reports who already has an item instead of failing the whole batch", async () => {
    const [outId, freeId] = await assetIdsByTag(ctx.db, [ctx.seed.assetTags[0]!, ctx.seed.assetTags[30]!]);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/checkouts/batch",
      headers: staff,
      payload: { batchId: randomUUID(), target: { type: "ROOM", roomId: ctx.seed.roomIds.youthRoom }, items: items([outId!, freeId!]) },
    });
    const [a, b] = res.json().results;
    expect(a.status).toBe("already_out");
    expect(a.heldBy).toBe("Youth");
    expect(b.status).toBe("ok");
    const moved = await ctx.db.asset.findUniqueOrThrow({ where: { id: freeId! } });
    expect(moved.currentRoomId).toBe(ctx.seed.roomIds.youthRoom);
  });

  it("only one of two racing devices wins the same asset", async () => {
    const [id] = await assetIdsByTag(ctx.db, [ctx.seed.assetTags[35]!]);
    const send = () =>
      ctx.app.inject({
        method: "POST",
        url: "/v1/checkouts/batch",
        headers: staff,
        payload: { batchId: randomUUID(), target: { type: "MINISTRY", ministryId: ctx.seed.ministryIds.kids }, items: items([id!]) },
      });
    const results = await Promise.all([send(), send(), send()]);
    const statuses = results.map((r) => r.json().results[0].status).sort();
    expect(statuses.filter((s) => s === "ok")).toHaveLength(1);
    expect(await ctx.db.checkout.count({ where: { assetId: id, checkedInAt: null } })).toBe(1);
  });

  it("checks items back in, tells you where they go, and is safe to repeat", async () => {
    const ids = await assetIdsByTag(ctx.db, ctx.seed.assetTags.slice(0, 3));
    const payload = { batchId: randomUUID(), items: items(ids) };
    const res = await ctx.app.inject({ method: "POST", url: "/v1/checkins/batch", headers: staff, payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(["ok", "ok", "ok"]);
    expect(res.json().results[0].returnTo).toBe("AV Closet");
    expect(await ctx.db.asset.count({ where: { id: { in: ids }, status: "AVAILABLE", currentRoomId: ctx.seed.roomIds.avCloset } })).toBe(3);

    const again = await ctx.app.inject({ method: "POST", url: "/v1/checkins/batch", headers: staff, payload: { ...payload, batchId: randomUUID() } });
    expect(again.json().results[0].status).toBe("already_in");
    expect(again.json().failed).toBe(0);
  });

  it("marks damaged returns as in service", async () => {
    const [id] = await assetIdsByTag(ctx.db, [ctx.seed.assetTags[5]!]);
    await ctx.app.inject({
      method: "POST", url: "/v1/checkins/batch", headers: staff,
      payload: { batchId: randomUUID(), items: items([id!]), condition: "damaged" },
    });
    expect((await ctx.db.asset.findUniqueOrThrow({ where: { id: id! } })).status).toBe("IN_SERVICE");
  });

  it("lists open checkouts", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/checkouts?open=true", headers: staff });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(10);
  });
});

describe("audit log", () => {
  it("cannot be edited or deleted, even with raw SQL", async () => {
    await expect(ctx.db.$executeRawUnsafe(`UPDATE "AuditEvent" SET action = 'tampered'`)).rejects.toThrow(/append-only/);
    await expect(ctx.db.$executeRawUnsafe(`DELETE FROM "AuditEvent"`)).rejects.toThrow(/append-only/);
  });
});
