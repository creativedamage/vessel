"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Plus, ShieldOff, Smartphone, TabletSmartphone } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { fmtDate, fmtRelative } from "@/lib/format";
import type { Campus } from "@/lib/types";
import { Button, cx, Empty, ErrorNote, Field, Modal, PageHeader, Skeleton } from "@/components/ui";

interface Device {
  id: string;
  name: string;
  scope: { campusIds: string[]; ministryIds: string[]; actions: string[] };
  requirePin: boolean;
  enrolledAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  _count: { checkouts: number };
}

export default function Kiosks() {
  const { data, mutate } = useApi<{ items: Device[] }>("/kiosks");
  const { data: campuses } = useApi<{ items: Campus[] }>("/campuses");
  const [creating, setCreating] = useState(false);
  const campusName = (id: string) => campuses?.items.find((c) => c.id === id)?.name ?? "…";

  const revoke = async (d: Device) => {
    if (!confirm(`Revoke "${d.name}"? It will stop working immediately.`)) return;
    await api(`/kiosks/${d.id}/revoke`, { method: "POST" });
    mutate();
  };

  return (
    <>
      <PageHeader
        title="Volunteer devices"
        subtitle="Shared phones and iPads that volunteers use to scan — no personal login needed."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> Enroll a device</Button>}
      />
      <div className="card overflow-hidden">
        {!data ? (
          <div className="space-y-3 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
        ) : data.items.length === 0 ? (
          <Empty icon={<TabletSmartphone className="size-8" />} title="No devices yet">
            Enroll the lobby iPad or a production volunteer's phone. They scan a QR from this page once, and they're set.
          </Empty>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {data.items.map((d) => (
              <li key={d.id} className={cx("flex items-center gap-4 px-5 py-4", d.revokedAt && "opacity-50")}>
                <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800"><Smartphone className="size-5 text-stone-500" /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{d.name} {d.revokedAt && <span className="ml-1 text-xs text-red-600">revoked</span>}</div>
                  <div className="text-xs text-stone-500">
                    {d.scope.campusIds.length ? d.scope.campusIds.map(campusName).join(", ") : "All campuses"} · {d.scope.actions.join(", ")}
                    {d.requirePin && " · PIN required"} · enrolled {fmtDate(d.enrolledAt)}
                  </div>
                </div>
                <div className="hidden text-right text-xs text-stone-500 sm:block">
                  <div>{d._count.checkouts} check-outs</div>
                  <div>{d.lastSeenAt ? `seen ${fmtRelative(d.lastSeenAt)}` : "never seen"}</div>
                </div>
                {!d.revokedAt && <Button variant="ghost" size="sm" onClick={() => revoke(d)}><ShieldOff className="size-4" /> Revoke</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Enroll open={creating} campuses={campuses?.items ?? []} onClose={() => { setCreating(false); mutate(); }} />
    </>
  );
}

function Enroll({ open, campuses, onClose }: { open: boolean; campuses: Campus[]; onClose: () => void }) {
  const [f, setF] = useState({ name: "", campusIds: [] as string[], requirePin: false });
  const [issued, setIssued] = useState<{ code: string; expiresAt: string; enrollUrl: string } | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (issued) QRCode.toString(issued.enrollUrl, { type: "svg", margin: 1 }).then(setQr);
  }, [issued]);

  const close = () => {
    setIssued(null);
    setQr("");
    setF({ name: "", campusIds: [], requirePin: false });
    onClose();
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setIssued(await api("/kiosks/enrollments", { method: "POST", json: f }));
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Modal open={open} onClose={close} title={issued ? "Scan with the Vessel app" : "Enroll a device"}>
      {issued ? (
        <div className="text-center">
          <div className="mx-auto size-56 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="mt-4 text-sm text-stone-500">Or type this code in the app:</p>
          <p className="mt-1 font-mono text-3xl font-semibold tracking-widest">{issued.code}</p>
          <p className="mt-3 text-xs text-stone-500">Works once. Expires {fmtRelative(issued.expiresAt).replace("ago", "from now")} — at {new Date(issued.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>
          <Button className="mt-5 w-full" variant="secondary" onClick={close}>Done</Button>
        </div>
      ) : (
        <form onSubmit={create} className="space-y-4">
          <Field label="Device name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Production booth iPad" /></Field>
          <div>
            <span className="label">Campuses it can work with</span>
            <div className="flex flex-wrap gap-1.5">
              {campuses.map((c) => {
                const on = f.campusIds.includes(c.id);
                return (
                  <button type="button" key={c.id} onClick={() => setF({ ...f, campusIds: on ? f.campusIds.filter((x) => x !== c.id) : [...f.campusIds, c.id] })}
                    className={cx("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200" : "border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300")}>
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-stone-500">{f.campusIds.length ? "Only these campuses." : "None selected = all campuses."}</p>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-700">
            <input type="checkbox" className="mt-1" checked={f.requirePin} onChange={(e) => setF({ ...f, requirePin: e.target.checked })} />
            <span className="text-sm"><span className="font-medium">Require a volunteer PIN</span><br /><span className="text-stone-500">Good for a lobby device anyone can pick up. Leave off for a trusted team phone.</span></span>
          </label>
          <ErrorNote error={error} />
          <Button type="submit" className="w-full">Create enrollment code</Button>
        </form>
      )}
    </Modal>
  );
}
