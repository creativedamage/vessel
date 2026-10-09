import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assetIdsByTag, enrollKiosk, items, setupTestApp, type TestCtx } from "./helpers.ts";

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.db.$disconnect();
});

describe("volunteer kiosk", () => {
  it("enrolls with a one-time code and can scan, search people and check out without a personal login", async () => {
    const kiosk = await enrollKiosk(ctx);
    const scan = await ctx.app.inject({ method: "GET", url: `/v1/scan/${ctx.seed.assetTags[0]!.toLowerCase()}`, headers: kiosk.headers });
    expect(scan.statusCode).toBe(200);
    expect(scan.json().type).toBe("asset");

    const people = await ctx.app.inject({ method: "GET", url: "/v1/people?q=ale", headers: kiosk.headers });
    expect(people.json().items[0].displayName).toBe("Alex Morgan");
    expect(people.json().items[0].email).toBeUndefined(); // kiosks get names only

    const [id] = await assetIdsByTag(ctx.db, [ctx.seed.assetTags[1]!]);
    const res = await ctx.app.inject({
      method: "POST", url: "/v1/checkouts/batch", headers: kiosk.headers,
      payload: { batchId: randomUUID(), target: { type: "PERSON", personId: people.json().items[0].id }, items: items([id!]) },
    });
    expect(res.json().results[0].status).toBe("ok");
    const co = await ctx.db.checkout.findFirstOrThrow({ where: { assetId: id } });
    expect(co.kioskDeviceId).toBe(kiosk.deviceId);
  });

  it("cannot reuse an enrollment code", async () => {
    const kiosk = await enrollKiosk(ctx);
    const enrollment = await ctx.db.kioskEnrollment.findFirstOrThrow({ where: { deviceId: kiosk.deviceId } });
    expect(enrollment.usedAt).not.toBeNull();
  });

  it("is kept away from admin routes", async () => {
    const kiosk = await enrollKiosk(ctx);
    expect((await ctx.app.inject({ method: "GET", url: "/v1/assets", headers: kiosk.headers })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/kiosks/enrollments", headers: kiosk.headers, payload: { name: "x" } })).statusCode).toBe(403);
  });

  it("requires a PIN when configured, and locks after 5 wrong tries", async () => {
    const kiosk = await enrollKiosk(ctx, { requirePin: true });
    const volunteer = ctx.seed.volunteerIds[2]!;
    await ctx.app.inject({ method: "PUT", url: `/v1/people/${volunteer}/pin`, headers: kiosk.staff, payload: { pin: "2468" } });
    const [id] = await assetIdsByTag(ctx.db, [ctx.seed.assetTags[10]!]);
    const send = (pin?: string) =>
      ctx.app.inject({
        method: "POST", url: "/v1/checkouts/batch", headers: kiosk.headers,
        payload: { batchId: randomUUID(), target: { type: "MINISTRY", ministryId: ctx.seed.ministryIds.worship }, items: items([id!]), ...(pin && { pin: { personId: volunteer, pin } }) },
      });

    expect((await send()).json().error).toBe("pin_required");
    for (let i = 0; i < 5; i++) expect((await send("0000")).statusCode).toBe(401);
    expect((await send("2468")).statusCode).toBe(423); // locked now, even with the right PIN

    await ctx.db.person.update({ where: { id: volunteer }, data: { pinLockedUntil: null } });
    const ok = await send("2468");
    expect(ok.json().results[0].status).toBe("ok");
    const co = await ctx.db.checkout.findFirstOrThrow({ where: { assetId: id } });
    expect(co.checkedOutById).toBe(volunteer);
  });

  it("only touches assets on its own campus", async () => {
    const kiosk = await enrollKiosk(ctx, { campusIds: [ctx.seed.campusIds.north] });
    const mainCampusAsset = await ctx.db.asset.findFirstOrThrow({ where: { homeCampusId: ctx.seed.campusIds.main, status: "AVAILABLE" } });
    const res = await ctx.app.inject({
      method: "POST", url: "/v1/checkouts/batch", headers: kiosk.headers,
      payload: { batchId: randomUUID(), target: { type: "MINISTRY", ministryId: ctx.seed.ministryIds.worship }, items: items([mainCampusAsset.id]) },
    });
    expect(res.json().results[0].status).toBe("out_of_scope");
    const dest = await ctx.app.inject({ method: "GET", url: "/v1/destinations", headers: kiosk.headers });
    expect(dest.json().rooms.every((r: { campus: { id: string } }) => r.campus.id === ctx.seed.campusIds.north)).toBe(true);
  });

  it("stops working the moment an admin revokes it", async () => {
    const kiosk = await enrollKiosk(ctx);
    await ctx.app.inject({ method: "POST", url: `/v1/kiosks/${kiosk.deviceId}/revoke`, headers: kiosk.staff });
    const res = await ctx.app.inject({ method: "GET", url: `/v1/scan/${ctx.seed.assetTags[0]}`, headers: kiosk.headers });
    expect(res.statusCode).toBe(401);
  });
});
