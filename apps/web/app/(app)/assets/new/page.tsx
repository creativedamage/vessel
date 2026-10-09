"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { api, useApi } from "@/lib/api";
import type { AssetSummary, Campus, Ministry } from "@/lib/types";
import { Button, ErrorNote, Field, PageHeader } from "@/components/ui";

interface ItemType { id: string; name: string; manufacturer: string | null; tracking: "INDIVIDUAL" | "BULK"; category: { id: string; name: string } }
interface FieldDef { id: string; key: string; label: string; type: string; options: string[] | null; required: boolean; category: { id: string } | null }

export default function NewAsset() {
  const router = useRouter();
  const { data: types } = useApi<{ items: ItemType[] }>("/item-types");
  const { data: ministries } = useApi<{ items: Ministry[] }>("/ministries");
  const { data: campuses } = useApi<{ items: Campus[] }>("/campuses");
  const { data: fields } = useApi<{ items: FieldDef[] }>("/custom-fields");

  const [f, setF] = useState({
    itemTypeId: "", name: "", count: 1, quantity: 1, serialNumber: "", ministryId: "", homeCampusId: "", homeRoomId: "",
    purchaseDate: "", purchaseCost: "", warrantyEndsAt: "", notes: "",
  });
  const [cf, setCf] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const type = types?.items.find((t) => t.id === f.itemTypeId);
  const rooms = campuses?.items.find((c) => c.id === f.homeCampusId)?.rooms.filter((r) => r.kind !== "BUILDING") ?? [];
  const defs = useMemo(() => fields?.items.filter((d) => !d.category || d.category.id === type?.category.id) ?? [], [fields, type]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const opt = (v: string) => (v ? v : undefined);
    try {
      const res = await api<{ items: AssetSummary[] }>("/assets", {
        method: "POST",
        json: {
          itemTypeId: f.itemTypeId,
          count: Number(f.count),
          name: opt(f.name),
          serialNumber: Number(f.count) === 1 ? opt(f.serialNumber) : undefined,
          quantity: type?.tracking === "BULK" ? Number(f.quantity) : undefined,
          ministryId: opt(f.ministryId),
          homeCampusId: opt(f.homeCampusId),
          homeRoomId: opt(f.homeRoomId),
          purchaseDate: opt(f.purchaseDate),
          purchaseCost: f.purchaseCost ? Number(f.purchaseCost) : undefined,
          warrantyEndsAt: opt(f.warrantyEndsAt),
          notes: opt(f.notes),
          customFields: Object.fromEntries(Object.entries(cf).filter(([, v]) => v !== "" && v != null)),
        },
      });
      router.push(res.items.length === 1 ? `/assets/${res.items[0]!.id}` : "/assets?sort=updatedAt");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <>
      <Link href="/assets" className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800"><ArrowLeft className="size-4" /> Assets</Link>
      <PageHeader title="Add assets" subtitle="Tags are assigned automatically. Add several identical items at once with “How many”." />
      <form onSubmit={submit} className="card max-w-3xl space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="Item type">
              <select className="input" required value={f.itemTypeId} onChange={set("itemTypeId")}>
                <option value="">Choose…</option>
                {types?.items.map((t) => <option key={t.id} value={t.id}>{t.category.name} · {[t.manufacturer, t.name].filter(Boolean).join(" ")}</option>)}
              </select>
            </Field>
          </div>
          <Field label="How many"><input type="number" min={1} max={100} className="input" value={f.count} onChange={set("count")} /></Field>
          <Field label="Nickname" hint="Optional — e.g. “Pastor's lav”"><input className="input" value={f.name} onChange={set("name")} /></Field>
          {Number(f.count) === 1 && <Field label="Serial number"><input className="input" value={f.serialNumber} onChange={set("serialNumber")} /></Field>}
          {type?.tracking === "BULK" && <Field label="Quantity in bin"><input type="number" min={1} className="input" value={f.quantity} onChange={set("quantity")} /></Field>}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ministry">
            <select className="input" value={f.ministryId} onChange={set("ministryId")}>
              <option value="">—</option>
              {ministries?.items.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Campus">
            <select className="input" value={f.homeCampusId} onChange={(e) => setF({ ...f, homeCampusId: e.target.value, homeRoomId: "" })}>
              <option value="">—</option>
              {campuses?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Lives in room">
            <select className="input" value={f.homeRoomId} onChange={set("homeRoomId")} disabled={!f.homeCampusId}>
              <option value="">—</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Purchase date"><input type="date" className="input" value={f.purchaseDate} onChange={set("purchaseDate")} /></Field>
          <Field label="Cost (each)"><input type="number" step="0.01" min={0} className="input" value={f.purchaseCost} onChange={set("purchaseCost")} /></Field>
          <Field label="Warranty ends"><input type="date" className="input" value={f.warrantyEndsAt} onChange={set("warrantyEndsAt")} /></Field>
        </div>

        {defs.length > 0 && (
          <div className="grid gap-4 border-t border-stone-200 pt-6 sm:grid-cols-2 dark:border-stone-800">
            {defs.map((d) => (
              <Field key={d.id} label={d.label + (d.required ? " *" : "")}>
                {d.type === "SELECT" ? (
                  <select className="input" value={String(cf[d.key] ?? "")} onChange={(e) => setCf({ ...cf, [d.key]: e.target.value })}>
                    <option value="">—</option>
                    {d.options?.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : d.type === "BOOLEAN" ? (
                  <select className="input" value={cf[d.key] === undefined ? "" : String(cf[d.key])} onChange={(e) => setCf({ ...cf, [d.key]: e.target.value === "" ? undefined : e.target.value === "true" })}>
                    <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
                  </select>
                ) : (
                  <input className="input" type={d.type === "NUMBER" ? "number" : d.type === "DATE" ? "date" : "text"} value={String(cf[d.key] ?? "")}
                    onChange={(e) => setCf({ ...cf, [d.key]: d.type === "NUMBER" && e.target.value ? Number(e.target.value) : e.target.value })} />
                )}
              </Field>
            ))}
          </div>
        )}

        <Field label="Notes"><textarea className="input min-h-20" value={f.notes} onChange={set("notes")} /></Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" href="/assets">Cancel</Button>
          <Button type="submit" disabled={busy || !f.itemTypeId}>{busy ? "Adding…" : Number(f.count) > 1 ? `Add ${f.count} assets` : "Add asset"}</Button>
        </div>
      </form>
    </>
  );
}
