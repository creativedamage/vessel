import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { login, setupTestApp, type TestCtx } from "./helpers.ts";

let ctx: TestCtx;
let admin: { authorization: string };

beforeAll(async () => {
  ctx = await setupTestApp();
  admin = await login(ctx);
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.db.$disconnect();
});

describe("auth", () => {
  it("rejects anonymous calls", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/v1/assets" })).statusCode).toBe(401);
  });

  it("sets an httpOnly session cookie on sign-in and resolves /me from it", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email: "ADMIN@grace.example" } });
    const cookie = res.cookies.find((c) => c.name === "vessel_session");
    expect(cookie?.httpOnly).toBe(true);
    const me = await ctx.app.inject({ method: "GET", url: "/v1/me", cookies: { vessel_session: cookie!.value } });
    expect(me.json().person.role).toBe("OWNER");
    expect(me.json().organization.name).toBe("Grace Community Church");
  });

  it("enforces roles: viewers can read but not write", async () => {
    const viewer = await login(ctx, "casey@grace.example");
    expect((await ctx.app.inject({ method: "GET", url: "/v1/assets", headers: viewer })).statusCode).toBe(200);
    const itemType = await ctx.db.itemType.findFirstOrThrow();
    const res = await ctx.app.inject({ method: "POST", url: "/v1/assets", headers: viewer, payload: { itemTypeId: itemType.id } });
    expect(res.statusCode).toBe(403);
  });

  it("revokes the session on logout", async () => {
    const headers = await login(ctx);
    await ctx.app.inject({ method: "POST", url: "/v1/auth/logout", headers });
    expect((await ctx.app.inject({ method: "GET", url: "/v1/me", headers })).statusCode).toBe(401);
  });
});

describe("scan lookup", () => {
  it("resolves tags, lowercase input, label URLs and room codes", async () => {
    const tag = ctx.seed.assetTags[0]!;
    for (const code of [tag, tag.toLowerCase(), `https://vsl.to/${tag}`]) {
      const res = await ctx.app.inject({ method: "GET", url: `/v1/scan/${encodeURIComponent(code)}`, headers: admin });
      expect(res.json().asset.assetTag).toBe(tag);
    }
    const room = await ctx.db.room.findFirstOrThrow({ where: { name: "Sanctuary" } });
    const res = await ctx.app.inject({ method: "GET", url: `/v1/scan/${room.qrCode}`, headers: admin });
    expect(res.json()).toMatchObject({ type: "room", room: { name: "Sanctuary" } });
    expect((await ctx.app.inject({ method: "GET", url: "/v1/scan/NOPE-1", headers: admin })).statusCode).toBe(404);
  });
});

describe("assets", () => {
  it("creates assets with the next tag number and validated custom fields", async () => {
    const itemType = await ctx.db.itemType.findFirstOrThrow({ where: { name: "SM58 Vocal Mic" } });
    const res = await ctx.app.inject({
      method: "POST", url: "/v1/assets", headers: admin,
      payload: { itemTypeId: itemType.id, count: 2, ministryId: ctx.seed.ministryIds.audio, customFields: { sunday_setup_location: "Stage left", frequency_band: "n/a" } },
    });
    expect(res.statusCode).toBe(201);
    const tags = res.json().items.map((a: { assetTag: string }) => a.assetTag);
    const next = ctx.seed.assetTags.length + 1;
    expect(tags).toEqual([`VSL-${String(next).padStart(6, "0")}`, `VSL-${String(next + 1).padStart(6, "0")}`]);
  });

  it("rejects custom field values that don't match the definition", async () => {
    const itemType = await ctx.db.itemType.findFirstOrThrow({ where: { name: "SM58 Vocal Mic" } });
    const res = await ctx.app.inject({
      method: "POST", url: "/v1/assets", headers: admin,
      payload: { itemTypeId: itemType.id, customFields: { sunday_setup_location: "The roof", lamp_hours: 3 } },
    });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().details.fields).sort()).toEqual(["lamp_hours", "sunday_setup_location"]);
  });

  it("refuses a stale edit (optimistic concurrency)", async () => {
    const asset = await ctx.db.asset.findFirstOrThrow({ where: { status: "AVAILABLE" } });
    const ok = await ctx.app.inject({ method: "PATCH", url: `/v1/assets/${asset.id}`, headers: admin, payload: { version: asset.version, name: "Renamed" } });
    expect(ok.statusCode).toBe(200);
    const stale = await ctx.app.inject({ method: "PATCH", url: `/v1/assets/${asset.id}`, headers: admin, payload: { version: asset.version, name: "Again" } });
    expect(stale.statusCode).toBe(409);
    const events = await ctx.db.auditEvent.findMany({ where: { entityId: asset.id, action: "asset.update" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.before).toMatchObject({ name: asset.name });
  });

  it("searches across tag, name, serial and item type", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/assets?q=shure", headers: admin });
    expect(res.json().total).toBeGreaterThan(5);
  });

  it("returns dashboard stats", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/stats", headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json().counts.total).toBeGreaterThan(40);
    expect(res.json().byMinistry[0].name).toBeDefined();
  });
});
