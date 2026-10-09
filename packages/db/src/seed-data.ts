import type { Db } from "./index.ts";

/**
 * Demo data for a fictional church. Used by `npm run db:seed` and by the API tests.
 * Returns the ids the tests need.
 */
export async function seedDemo(db: Db, slug = "grace") {
  const existing = await db.organization.findUnique({ where: { slug } });
  if (existing) return summarize(db, existing.id);

  const org = await db.organization.create({
    data: { name: "Grace Community Church", slug, tagPrefix: "VSL", timezone: "America/Chicago" },
  });
  const organizationId = org.id;

  // ── Campuses & rooms ──────────────────────────────────────
  const main = await db.campus.create({ data: { organizationId, name: "Main Campus", address: "100 Main St" } });
  const north = await db.campus.create({ data: { organizationId, name: "North Campus", address: "2200 N Loop Rd" } });

  async function room(campusId: string, name: string, kind: "BUILDING" | "ROOM" | "STORAGE", parentPath: string, parentId?: string) {
    const r = await db.room.create({
      data: { organizationId, campusId, name, kind, parentId, path: "pending", qrCode: null },
    });
    const path = `${parentPath}/${r.id}`;
    await db.room.update({ where: { id: r.id }, data: { path, qrCode: `RM-${r.id.slice(0, 8).toUpperCase()}` } });
    return { ...r, path };
  }
  const worshipCenter = await room(main.id, "Worship Center", "BUILDING", `/${main.id}`);
  const sanctuary = await room(main.id, "Sanctuary", "ROOM", worshipCenter.path, worshipCenter.id);
  const avCloset = await room(main.id, "AV Closet", "STORAGE", worshipCenter.path, worshipCenter.id);
  const booth = await room(main.id, "Production Booth", "ROOM", worshipCenter.path, worshipCenter.id);
  const education = await room(main.id, "Education Wing", "BUILDING", `/${main.id}`);
  const kidsRoom = await room(main.id, "Kids Room 101", "ROOM", education.path, education.id);
  const youthRoom = await room(main.id, "Youth Room", "ROOM", education.path, education.id);
  const northHall = await room(north.id, "North Hall", "ROOM", `/${north.id}`);
  const northStorage = await room(north.id, "North Storage", "STORAGE", `/${north.id}`);

  // ── Ministries ────────────────────────────────────────────
  const m = async (name: string, color: string, parentId?: string) =>
    db.ministry.create({ data: { organizationId, name, color, parentId } });
  const worship = await m("Worship", "#7c3aed");
  const production = await m("Production", "#2563eb", worship.id);
  const audio = await m("Audio", "#0891b2", production.id);
  const lighting = await m("Lighting", "#d97706", production.id);
  const video = await m("Video", "#dc2626", production.id);
  const youth = await m("Youth", "#16a34a");
  const kids = await m("Kids", "#db2777");
  const facilities = await m("Facilities", "#64748b");
  const hospitality = await m("Hospitality", "#ca8a04");

  // ── People ────────────────────────────────────────────────
  const staff = async (displayName: string, email: string, role: "OWNER" | "ADMIN" | "MANAGER" | "VIEWER") =>
    db.person.create({ data: { organizationId, kind: "STAFF", displayName, email, role, externalSource: "LOCAL" } });
  const admin = await staff("Pat Admin", "admin@grace.example", "OWNER");
  const prodDirector = await staff("Jordan Rivera", "jordan@grace.example", "MANAGER");
  await staff("Casey Viewer", "casey@grace.example", "VIEWER");
  await db.ministryMember.create({ data: { personId: prodDirector.id, ministryId: production.id, isLeader: true } });

  const volunteerNames = [
    "Alex Morgan", "Bailey Chen", "Cameron Brooks", "Dana Okafor", "Eli Thompson",
    "Fiona Walsh", "Gabe Martinez", "Hannah Lee", "Isaac Patel", "Jade Wilson",
  ];
  const volunteers = [];
  for (const name of volunteerNames) {
    volunteers.push(await db.person.create({ data: { organizationId, kind: "VOLUNTEER", displayName: name } }));
  }

  // ── Catalog ───────────────────────────────────────────────
  const cat = async (name: string, icon: string) => db.category.create({ data: { organizationId, name, icon } });
  const av = await cat("Audio", "mic");
  const light = await cat("Lighting", "lightbulb");
  const vid = await cat("Video", "video");
  const it = await cat("IT", "laptop");
  const inst = await cat("Instruments", "music");
  const furn = await cat("Furniture & Event", "armchair");

  const t = async (categoryId: string, name: string, manufacturer: string, tracking: "INDIVIDUAL" | "BULK" = "INDIVIDUAL", serviceIntervalDays?: number) =>
    db.itemType.create({ data: { organizationId, categoryId, name, manufacturer, tracking, serviceIntervalDays } });
  const sm58 = await t(av.id, "SM58 Vocal Mic", "Shure");
  const ulxd = await t(av.id, "ULXD2 Wireless Handheld", "Shure");
  const lav = await t(av.id, "DPA 4088 Headset", "DPA");
  const xlrBin = await t(av.id, "XLR Cable 25ft (bin)", "Generic", "BULK");
  const par = await t(light.id, "LED Par", "Chauvet", "INDIVIDUAL", 365);
  const mover = await t(light.id, "Moving Head", "Martin", "INDIVIDUAL", 180);
  const camera = await t(vid.id, "PTZ Camera", "PTZOptics");
  const projector = await t(vid.id, "Laser Projector", "Epson", "INDIVIDUAL", 365);
  const laptop = await t(it.id, "MacBook Air 13", "Apple");
  const ipad = await t(it.id, "iPad 10th Gen", "Apple");
  const keyboard = await t(inst.id, "Stage Piano", "Nord", "INDIVIDUAL", 365);
  const table = await t(furn.id, "6ft Folding Table", "Lifetime");

  // ── Custom fields (no migrations needed) ──────────────────
  await db.customFieldDef.createMany({
    data: [
      { organizationId, key: "sunday_setup_location", label: "Sunday setup location", type: "SELECT",
        options: ["Stage left", "Stage right", "Center stage", "FOH", "Lobby", "Kids check-in"], showOnMobile: true, sortOrder: 1 },
      { organizationId, key: "frequency_band", label: "RF band", type: "TEXT", categoryId: av.id, sortOrder: 2 },
      { organizationId, key: "lamp_hours", label: "Lamp / laser hours", type: "NUMBER", categoryId: vid.id, sortOrder: 3 },
      { organizationId, key: "asset_owner_gift", label: "Donated by", type: "TEXT", sortOrder: 4 },
      { organizationId, key: "needs_case", label: "Requires road case", type: "BOOLEAN", sortOrder: 5 },
    ],
  });

  // ── Assets ────────────────────────────────────────────────
  let seq = 1;
  const nextTag = () => `VSL-${String(seq++).padStart(6, "0")}`;
  const year = (y: number, mo = 1) => new Date(Date.UTC(y, mo - 1, 15));
  type A = { itemTypeId: string; ministryId: string; homeCampusId: string; homeRoomId: string; name?: string; serialNumber?: string;
    purchaseDate?: Date; purchaseCost?: number; warrantyEndsAt?: Date; customFields?: Record<string, string | number | boolean>; quantity?: number; nextServiceAt?: Date };
  const assets: { id: string; assetTag: string }[] = [];
  const add = async (a: A, count = 1) => {
    for (let i = 0; i < count; i++) {
      const tag = nextTag();
      assets.push(await db.asset.create({
        data: { organizationId, assetTag: tag, barcode: tag, ...a, name: a.name && count > 1 ? `${a.name} ${i + 1}` : a.name,
          serialNumber: a.serialNumber ?? `SN${Math.floor(100000 + seq * 7919) % 999999}` },
        select: { id: true, assetTag: true },
      }));
    }
  };
  const mainAV = { homeCampusId: main.id, homeRoomId: avCloset.id };
  await add({ ...mainAV, itemTypeId: sm58.id, ministryId: audio.id, name: "SM58", purchaseDate: year(2021, 3), purchaseCost: 99, customFields: { sunday_setup_location: "Center stage" } }, 8);
  await add({ ...mainAV, itemTypeId: ulxd.id, ministryId: audio.id, name: "Wireless", purchaseDate: year(2023, 6), purchaseCost: 1149, warrantyEndsAt: year(2026, 6), customFields: { frequency_band: "G50 470–534 MHz", sunday_setup_location: "Stage left", needs_case: true } }, 4);
  await add({ ...mainAV, itemTypeId: lav.id, ministryId: audio.id, name: "Pastor headset", purchaseDate: year(2024, 1), purchaseCost: 549, warrantyEndsAt: year(2027, 1), customFields: { sunday_setup_location: "Center stage" } }, 2);
  await add({ ...mainAV, itemTypeId: xlrBin.id, ministryId: audio.id, name: "XLR bin", quantity: 40 });
  await add({ homeCampusId: main.id, homeRoomId: sanctuary.id, itemTypeId: par.id, ministryId: lighting.id, name: "Stage wash", purchaseDate: year(2022, 9), purchaseCost: 399, nextServiceAt: year(2026, 9) }, 6);
  await add({ homeCampusId: main.id, homeRoomId: sanctuary.id, itemTypeId: mover.id, ministryId: lighting.id, name: "Spot", purchaseDate: year(2024, 2), purchaseCost: 4200, nextServiceAt: year(2026, 11), customFields: { needs_case: true } }, 4);
  await add({ homeCampusId: main.id, homeRoomId: booth.id, itemTypeId: camera.id, ministryId: video.id, name: "Cam", purchaseDate: year(2023, 1), purchaseCost: 1999, warrantyEndsAt: year(2026, 1) }, 3);
  await add({ homeCampusId: main.id, homeRoomId: sanctuary.id, itemTypeId: projector.id, ministryId: video.id, name: "Main projector", purchaseCost: 7800, purchaseDate: year(2022, 5), customFields: { lamp_hours: 6120, asset_owner_gift: "The Nguyen family" } });
  await add({ homeCampusId: main.id, homeRoomId: booth.id, itemTypeId: laptop.id, ministryId: production.id, name: "ProPresenter Mac", purchaseDate: year(2024, 8), purchaseCost: 1299, warrantyEndsAt: year(2027, 8) }, 2);
  await add({ homeCampusId: main.id, homeRoomId: kidsRoom.id, itemTypeId: ipad.id, ministryId: kids.id, name: "Kids check-in iPad", purchaseDate: year(2024, 3), purchaseCost: 349, customFields: { sunday_setup_location: "Kids check-in" } }, 3);
  await add({ homeCampusId: main.id, homeRoomId: youthRoom.id, itemTypeId: keyboard.id, ministryId: youth.id, name: "Youth keys", purchaseDate: year(2020, 10), purchaseCost: 2999 });
  await add({ homeCampusId: north.id, homeRoomId: northStorage.id, itemTypeId: table.id, ministryId: hospitality.id, name: "Table" }, 6);
  await add({ homeCampusId: north.id, homeRoomId: northHall.id, itemTypeId: sm58.id, ministryId: worship.id, name: "North SM58" }, 2);

  await db.organization.update({ where: { id: organizationId }, data: { nextTagSeq: seq } });

  return {
    organizationId,
    adminId: admin.id,
    managerId: prodDirector.id,
    volunteerIds: volunteers.map((v) => v.id),
    campusIds: { main: main.id, north: north.id },
    roomIds: { sanctuary: sanctuary.id, avCloset: avCloset.id, youthRoom: youthRoom.id, northHall: northHall.id },
    ministryIds: { worship: worship.id, production: production.id, audio: audio.id, youth: youth.id, kids: kids.id, facilities: facilities.id },
    assetTags: assets.map((a) => a.assetTag),
  };
}

async function summarize(db: Db, organizationId: string) {
  const [admin, manager, volunteers, campuses, rooms, ministries, assets] = await Promise.all([
    db.person.findFirstOrThrow({ where: { organizationId, role: "OWNER" } }),
    db.person.findFirstOrThrow({ where: { organizationId, role: "MANAGER" } }),
    db.person.findMany({ where: { organizationId, kind: "VOLUNTEER" }, orderBy: { displayName: "asc" } }),
    db.campus.findMany({ where: { organizationId } }),
    db.room.findMany({ where: { organizationId } }),
    db.ministry.findMany({ where: { organizationId } }),
    db.asset.findMany({ where: { organizationId }, orderBy: { assetTag: "asc" }, select: { assetTag: true } }),
  ]);
  const byName = <T extends { name: string; id: string }>(xs: T[], n: string) => xs.find((x) => x.name === n)!.id;
  return {
    organizationId,
    adminId: admin.id,
    managerId: manager.id,
    volunteerIds: volunteers.map((v) => v.id),
    campusIds: { main: byName(campuses, "Main Campus"), north: byName(campuses, "North Campus") },
    roomIds: { sanctuary: byName(rooms, "Sanctuary"), avCloset: byName(rooms, "AV Closet"), youthRoom: byName(rooms, "Youth Room"), northHall: byName(rooms, "North Hall") },
    ministryIds: { worship: byName(ministries, "Worship"), production: byName(ministries, "Production"), audio: byName(ministries, "Audio"), youth: byName(ministries, "Youth"), kids: byName(ministries, "Kids"), facilities: byName(ministries, "Facilities") },
    assetTags: assets.map((a) => a.assetTag),
  };
}

export type SeedSummary = Awaited<ReturnType<typeof seedDemo>>;
