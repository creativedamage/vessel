export type AssetStatus = "AVAILABLE" | "CHECKED_OUT" | "IN_SERVICE" | "MISSING" | "RETIRED";
export type Role = "OWNER" | "ADMIN" | "MANAGER" | "VIEWER";

export interface Ref {
  id: string;
  name: string;
}

export interface AssetSummary {
  id: string;
  assetTag: string;
  barcode: string | null;
  name: string | null;
  displayName: string;
  serialNumber: string | null;
  status: AssetStatus;
  quantity: number;
  version: number;
  purchaseDate: string | null;
  purchaseCost: string | null;
  warrantyEndsAt: string | null;
  nextServiceAt: string | null;
  customFields: Record<string, unknown>;
  notes: string | null;
  itemType: { id: string; name: string; manufacturer: string | null; tracking: "INDIVIDUAL" | "BULK"; category: { id: string; name: string; icon: string | null } };
  ministry: (Ref & { color: string | null }) | null;
  homeCampus: Ref | null;
  homeRoom: Ref | null;
  currentRoom: Ref | null;
  openCheckout: null | {
    id: string;
    targetType: "PERSON" | "MINISTRY" | "ROOM";
    checkedOutAt: string;
    dueAt: string | null;
    heldBy: string;
  };
}

export interface Me {
  kind: "staff";
  organization: { id: string; name: string; tagPrefix: string };
  person: { id: string; displayName: string; email: string | null; role: Role };
}

export interface Person {
  id: string;
  displayName: string;
  kind: "STAFF" | "VOLUNTEER" | "CONTACT";
  email?: string | null;
  phone?: string | null;
  role?: Role | null;
  active?: boolean;
  hasPin: boolean;
  openCheckouts?: number;
  externalSource?: string | null;
  ministries?: { isLeader: boolean; ministry: Ref & { color: string | null } }[];
}

export interface Ministry extends Ref {
  color: string | null;
  parentId: string | null;
  assetCount?: number;
  leaders?: { id: string; displayName: string }[];
}

export interface Room extends Ref {
  kind: "BUILDING" | "FLOOR" | "ROOM" | "STORAGE" | "SHELF";
  parentId: string | null;
  qrCode: string | null;
  assetCount?: number;
}

export interface Campus extends Ref {
  address: string | null;
  rooms: Room[];
}

export interface ItemResult {
  assetId: string;
  clientOpId: string;
  status: "ok" | "duplicate" | "already_out" | "already_in" | "not_found" | "out_of_scope" | "unavailable";
  assetTag?: string;
  displayName?: string;
  heldBy?: string;
  returnTo?: string | null;
  message?: string;
}

export interface BatchResult {
  batchId: string;
  target: string | null;
  succeeded: number;
  failed: number;
  results: ItemResult[];
}
