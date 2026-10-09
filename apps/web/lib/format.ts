const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const fmtDate = (d: string | Date | null | undefined) => (d ? dateFmt.format(new Date(d)) : "—");
export const fmtMoney = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : money.format(Number(v)));

export function fmtRelative(d: string | Date) {
  const date = new Date(d);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400 && new Date().getDate() === date.getDate()) return `today ${timeFmt.format(date)}`;
  if (diff < 7 * 86400) return `${date.toLocaleDateString("en-US", { weekday: "short" })} ${timeFmt.format(date)}`;
  return dateFmt.format(date);
}

export const daysUntil = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 864e5);

export const ACTION_LABEL: Record<string, string> = {
  "asset.checkout": "checked out",
  "asset.checkin": "checked in",
  "asset.create": "added",
  "asset.update": "edited",
  "asset.retire": "retired",
  "asset.service": "logged service on",
  "person.create": "added person",
  "person.update": "edited person",
  "person.pin.set": "set a PIN for",
  "kiosk.enroll": "enrolled kiosk",
  "kiosk.revoke": "revoked kiosk",
  "kiosk.enrollment.create": "created a kiosk code",
  "staff.signin": "signed in",
};
