"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Pencil, Printer, Wrench } from "lucide-react";
import QRCode from "qrcode";
import { api, useApi } from "@/lib/api";
import { ACTION_LABEL, fmtDate, fmtMoney, fmtRelative } from "@/lib/format";
import type { AssetSummary } from "@/lib/types";
import { Button, cx, ErrorNote, Field, MinistryChip, Modal, PageHeader, Skeleton, StatusBadge } from "@/components/ui";

interface FieldDef { id: string; key: string; label: string; type: string; options: string[] | null }
interface Detail {
  asset: AssetSummary;
  history: {
    id: string; targetType: string; checkedOutAt: string; checkedInAt: string | null; dueAt: string | null; checkinCondition: string | null;
    assignee: { displayName: string } | null; ministry: { name: string } | null; room: { name: string } | null;
    checkedOutBy: { displayName: string } | null; kioskDevice: { name: string } | null;
  }[];
  events: { id: string; action: string; occurredAt: string; actorType: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
  fieldDefs: FieldDef[];
  serviceRecords: { id: string; kind: string; performedAt: string; performedBy: string | null; cost: string | null; notes: string | null }[];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function fieldValue(def: FieldDef, v: unknown) {
  if (v === undefined || v === null || v === "") return <span className="text-stone-400">—</span>;
  if (def.type === "BOOLEAN") return v ? "Yes" : "No";
  if (def.type === "DATE") return fmtDate(String(v));
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function Label({ asset }: { asset: AssetSummary }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(`https://vsl.to/${asset.assetTag}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then(setSvg);
  }, [asset.assetTag]);
  return (
    <div id="asset-label" className="mx-auto flex w-72 items-center gap-4 rounded-xl border border-stone-300 bg-white p-4 text-black">
      <div className="size-24 shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="min-w-0">
        <div className="font-mono text-lg font-bold tracking-tight">{asset.assetTag}</div>
        <div className="truncate text-sm">{asset.displayName}</div>
        <div className="mt-1 text-[10px] uppercase tracking-wider text-stone-500">Property of {asset.ministry?.name ?? "the church"}</div>
      </div>
    </div>
  );
}

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, mutate } = useApi<Detail>(`/assets/${id}`);
  const [editing, setEditing] = useState(false);
  const [service, setService] = useState(false);
  const [label, setLabel] = useState(false);

  if (!data) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>;
  const { asset } = data;

  return (
    <>
      <Link href="/assets" className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"><ArrowLeft className="size-4" /> Assets</Link>
      <PageHeader
        title={asset.displayName}
        subtitle={<span className="flex flex-wrap items-center gap-3"><span className="tag">{asset.assetTag}</span><StatusBadge status={asset.status} />{asset.openCheckout && <span>with <b className="font-medium text-stone-700 dark:text-stone-200">{asset.openCheckout.heldBy}</b> since {fmtDate(asset.openCheckout.checkedOutAt)}</span>}</span>}
        actions={
          <>
            <Button variant="secondary" onClick={() => setLabel(true)}><Printer className="size-4" /> Label</Button>
            <Button variant="secondary" onClick={() => setService(true)}><Wrench className="size-4" /> Log service</Button>
            <Button onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <section className="card p-5">
            <h2 className="mb-2 font-semibold">Details</h2>
            <dl className="divide-y divide-stone-100 dark:divide-stone-800">
              <Row label="Type">{[asset.itemType.manufacturer, asset.itemType.name].filter(Boolean).join(" ")}</Row>
              <Row label="Category">{asset.itemType.category.name}</Row>
              <Row label="Ministry"><MinistryChip ministry={asset.ministry} /></Row>
              <Row label="Lives in">{asset.homeRoom?.name ?? "—"}{asset.homeCampus && <span className="font-normal text-stone-500"> · {asset.homeCampus.name}</span>}</Row>
              {asset.currentRoom && asset.currentRoom.id !== asset.homeRoom?.id && <Row label="Currently in">{asset.currentRoom.name}</Row>}
              <Row label="Serial"><span className="tag">{asset.serialNumber ?? "—"}</span></Row>
              {asset.quantity > 1 && <Row label="Quantity">{asset.quantity}</Row>}
              <Row label="Purchased">{fmtDate(asset.purchaseDate)}</Row>
              <Row label="Cost">{fmtMoney(asset.purchaseCost)}</Row>
              <Row label="Warranty ends">{fmtDate(asset.warrantyEndsAt)}</Row>
              <Row label="Next service">{fmtDate(asset.nextServiceAt)}</Row>
            </dl>
          </section>
          {data.fieldDefs.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-2 font-semibold">Custom fields</h2>
              <dl className="divide-y divide-stone-100 dark:divide-stone-800">
                {data.fieldDefs.map((d) => <Row key={d.id} label={d.label}>{fieldValue(d, asset.customFields[d.key])}</Row>)}
              </dl>
            </section>
          )}
          {asset.notes && <section className="card whitespace-pre-wrap p-5 text-sm">{asset.notes}</section>}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <section className="card">
            <h2 className="border-b border-stone-200 px-5 py-4 font-semibold dark:border-stone-800">Check-out history</h2>
            {data.history.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-stone-500">Never checked out.</p>
            ) : (
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {data.history.map((h) => (
                  <li key={h.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                    <div className={cx("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", h.checkedInAt ? "bg-stone-100 text-stone-500 dark:bg-stone-800" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300")}>
                      {h.checkedInAt ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                    </div>
                    <div className="flex-1">
                      <div><b className="font-medium">{h.assignee?.displayName ?? h.ministry?.name ?? h.room?.name}</b> <span className="text-stone-500">· {h.targetType.toLowerCase()}</span></div>
                      <div className="text-xs text-stone-500">
                        Out {fmtDate(h.checkedOutAt)}{h.checkedOutBy && ` by ${h.checkedOutBy.displayName}`}{h.kioskDevice && ` on ${h.kioskDevice.name}`}
                        {h.checkedInAt ? ` · back ${fmtDate(h.checkedInAt)}${h.checkinCondition && h.checkinCondition !== "ok" ? ` (${h.checkinCondition.replace("_", " ")})` : ""}` : h.dueAt ? ` · due ${fmtDate(h.dueAt)}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.serviceRecords.length > 0 && (
            <section className="card">
              <h2 className="border-b border-stone-200 px-5 py-4 font-semibold dark:border-stone-800">Service records</h2>
              <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
                {data.serviceRecords.map((s) => (
                  <li key={s.id} className="flex justify-between gap-4 px-5 py-3">
                    <div><div className="font-medium">{s.kind}</div><div className="text-xs text-stone-500">{s.performedBy}{s.notes && ` · ${s.notes}`}</div></div>
                    <div className="text-right text-stone-500">{fmtDate(s.performedAt)}<div className="text-xs">{fmtMoney(s.cost)}</div></div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <h2 className="border-b border-stone-200 px-5 py-4 font-semibold dark:border-stone-800">Audit trail</h2>
            <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
              {data.events.map((e) => (
                <li key={e.id} className="flex justify-between gap-4 px-5 py-2.5">
                  <span>
                    <span>{(ACTION_LABEL[e.action] ?? e.action).replace(/^./, (c) => c.toUpperCase())}</span>
                    {e.action === "asset.update" && e.after && <span className="text-stone-500"> · {Object.keys(e.after).join(", ")}</span>}
                    {e.actorType === "VOLUNTEER_KIOSK" && <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500 dark:bg-stone-800">kiosk</span>}
                  </span>
                  <time className="shrink-0 text-xs text-stone-400">{fmtRelative(e.occurredAt)}</time>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <EditAsset open={editing} onClose={() => setEditing(false)} detail={data} onSaved={() => { setEditing(false); mutate(); }} />
      <LogService open={service} onClose={() => setService(false)} assetId={asset.id} onSaved={() => { setService(false); mutate(); }} />
      <Modal open={label} onClose={() => setLabel(false)} title="Asset label">
        <Label asset={asset} />
        <p className="mt-4 text-center text-xs text-stone-500">The QR opens this asset from any phone camera, and the Vessel app scans it instantly.</p>
        <Button className="mt-4 w-full" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
      </Modal>
    </>
  );
}

function EditAsset({ open, onClose, detail, onSaved }: { open: boolean; onClose: () => void; detail: Detail; onSaved: () => void }) {
  const a = detail.asset;
  const [form, setForm] = useState({ name: a.name ?? "", serialNumber: a.serialNumber ?? "", notes: a.notes ?? "", status: a.status });
  const [cf, setCf] = useState<Record<string, unknown>>(a.customFields);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/assets/${a.id}`, {
        method: "PATCH",
        json: {
          version: a.version,
          name: form.name || null,
          serialNumber: form.serialNumber || null,
          notes: form.notes || null,
          ...(a.status !== "CHECKED_OUT" && form.status !== a.status && { status: form.status }),
          customFields: cf,
        },
      });
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit asset" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nickname"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={a.itemType.name} /></Field>
        <Field label="Serial number"><input className="input" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></Field>
        {a.status !== "CHECKED_OUT" && (
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}>
              <option value="AVAILABLE">Available</option><option value="IN_SERVICE">In service</option><option value="MISSING">Missing</option>
            </select>
          </Field>
        )}
        {detail.fieldDefs.map((d) => (
          <Field key={d.id} label={d.label}>
            {d.type === "SELECT" ? (
              <select className="input" value={String(cf[d.key] ?? "")} onChange={(e) => setCf({ ...cf, [d.key]: e.target.value || null })}>
                <option value="">—</option>
                {d.options?.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : d.type === "BOOLEAN" ? (
              <select className="input" value={cf[d.key] === undefined ? "" : String(cf[d.key])} onChange={(e) => setCf({ ...cf, [d.key]: e.target.value === "" ? null : e.target.value === "true" })}>
                <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            ) : (
              <input className="input" type={d.type === "NUMBER" ? "number" : d.type === "DATE" ? "date" : "text"} value={String(cf[d.key] ?? "")}
                onChange={(e) => setCf({ ...cf, [d.key]: e.target.value === "" ? null : d.type === "NUMBER" ? Number(e.target.value) : e.target.value })} />
            )}
          </Field>
        ))}
        <div className="sm:col-span-2"><Field label="Notes"><textarea className="input min-h-20" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
      </div>
      <div className="mt-4"><ErrorNote error={error} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
      </div>
    </Modal>
  );
}

function LogService({ open, onClose, assetId, onSaved }: { open: boolean; onClose: () => void; assetId: string; onSaved: () => void }) {
  const [form, setForm] = useState({ kind: "", performedAt: new Date().toISOString().slice(0, 10), performedBy: "", cost: "", notes: "" });
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    try {
      await api(`/assets/${assetId}/service-records`, {
        method: "POST",
        json: { kind: form.kind, performedAt: form.performedAt, performedBy: form.performedBy || undefined, cost: form.cost ? Number(form.cost) : undefined, notes: form.notes || undefined },
      });
      onSaved();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Log service">
      <div className="space-y-4">
        <Field label="What was done"><input className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} placeholder="Lamp replacement, tuning, firmware…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className="input" value={form.performedAt} onChange={(e) => setForm({ ...form, performedAt: e.target.value })} /></Field>
          <Field label="Cost"><input type="number" className="input" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="0" /></Field>
        </div>
        <Field label="Done by"><input className="input" value={form.performedBy} onChange={(e) => setForm({ ...form, performedBy: e.target.value })} placeholder="Vendor or volunteer" /></Field>
        <Field label="Notes"><textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <ErrorNote error={error} />
        <Button className="w-full" onClick={save} disabled={!form.kind}>Save</Button>
      </div>
    </Modal>
  );
}
