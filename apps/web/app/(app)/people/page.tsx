"use client";

import { useState } from "react";
import { KeyRound, Plus, Search, Users } from "lucide-react";
import { api, useApi } from "@/lib/api";
import type { Ministry, Person, Role } from "@/lib/types";
import { useMe } from "@/components/shell";
import { Button, cx, Empty, ErrorNote, Field, Modal, PageHeader, Skeleton } from "@/components/ui";

const KIND_TABS = [["", "Everyone"], ["STAFF", "Staff"], ["VOLUNTEER", "Volunteers"], ["CONTACT", "Contacts"]] as const;

export default function People() {
  const { data: me } = useMe();
  const isAdmin = me && (me.person.role === "ADMIN" || me.person.role === "OWNER");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const params = new URLSearchParams({ limit: "200" });
  if (q) params.set("q", q);
  if (kind) params.set("kind", kind);
  const { data, mutate } = useApi<{ items: Person[] }>(`/people?${params}`, { keepPreviousData: true });
  const [adding, setAdding] = useState(false);
  const [pinFor, setPinFor] = useState<Person | null>(null);

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Staff sign in with SSO. Volunteers don't need an account — just a name, and an optional PIN for shared devices."
        actions={isAdmin && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add person</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <input className="input pl-9" placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="inline-flex rounded-xl border border-stone-300 bg-white p-1 text-sm dark:border-stone-700 dark:bg-stone-900">
          {KIND_TABS.map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} className={cx("rounded-lg px-3 py-1.5 font-medium", kind === k ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-600 dark:text-stone-300")}>{l}</button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {!data ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : data.items.length === 0 ? (
          <Empty icon={<Users className="size-8" />} title="No one here yet" />
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {data.items.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-5 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold dark:bg-stone-800">
                  {p.displayName.split(" ").map((x) => x[0]).join("").slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.displayName}</span>
                    {p.role && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium capitalize text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">{p.role.toLowerCase()}</span>}
                    {p.kind !== "STAFF" && <span className="text-xs capitalize text-stone-500">{p.kind.toLowerCase()}</span>}
                    {p.active === false && <span className="text-xs text-red-600">inactive</span>}
                  </div>
                  <div className="truncate text-xs text-stone-500">
                    {[p.email, p.ministries?.map((m) => m.ministry.name + (m.isLeader ? " (lead)" : "")).join(", ")].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {!!p.openCheckouts && <span className="text-sm text-amber-600 dark:text-amber-400">{p.openCheckouts} out</span>}
                {isAdmin && (
                  <Button variant="ghost" size="sm" onClick={() => setPinFor(p)} title="Set kiosk PIN">
                    <KeyRound className={cx("size-4", p.hasPin && "text-emerald-600")} /> {p.hasPin ? "PIN set" : "Set PIN"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddPerson open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); mutate(); }} canAddOwner={me?.person.role === "OWNER"} />
      <SetPin person={pinFor} onClose={() => setPinFor(null)} onSaved={() => { setPinFor(null); mutate(); }} />
    </>
  );
}

function AddPerson({ open, onClose, onSaved, canAddOwner }: { open: boolean; onClose: () => void; onSaved: () => void; canAddOwner?: boolean }) {
  const { data: ministries } = useApi<{ items: Ministry[] }>(open ? "/ministries" : null);
  const [f, setF] = useState({ kind: "VOLUNTEER", displayName: "", email: "", phone: "", role: "MANAGER" as Role });
  const [ministryIds, setMinistryIds] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api("/people", {
        method: "POST",
        json: { kind: f.kind, displayName: f.displayName, email: f.email || undefined, phone: f.phone || undefined, role: f.kind === "STAFF" ? f.role : undefined, ministryIds },
      });
      setF({ ...f, displayName: "", email: "", phone: "" });
      setMinistryIds([]);
      onSaved();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add person">
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1 text-sm dark:bg-stone-800">
          {(["VOLUNTEER", "STAFF", "CONTACT"] as const).map((k) => (
            <button type="button" key={k} onClick={() => setF({ ...f, kind: k })} className={cx("rounded-lg py-1.5 font-medium capitalize", f.kind === k ? "bg-white shadow-xs dark:bg-stone-900" : "text-stone-500")}>{k.toLowerCase()}</button>
          ))}
        </div>
        <Field label="Name"><input className="input" required value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.kind === "STAFF" ? "Work email" : "Email"}><input type="email" className="input" required={f.kind === "STAFF"} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        {f.kind === "STAFF" && (
          <Field label="Role" hint="Managers handle assets and check-outs; admins also manage people, places and devices.">
            <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              <option value="VIEWER">Viewer</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option>
              {canAddOwner && <option value="OWNER">Owner</option>}
            </select>
          </Field>
        )}
        <div>
          <span className="label">Ministries</span>
          <div className="flex flex-wrap gap-1.5">
            {ministries?.items.map((m) => {
              const on = ministryIds.includes(m.id);
              return (
                <button type="button" key={m.id} onClick={() => setMinistryIds(on ? ministryIds.filter((x) => x !== m.id) : [...ministryIds, m.id])}
                  className={cx("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200" : "border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300")}>
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
        <ErrorNote error={error} />
        <Button type="submit" className="w-full">Add {f.kind.toLowerCase()}</Button>
      </form>
    </Modal>
  );
}

function SetPin({ person, onClose, onSaved }: { person: Person | null; onClose: () => void; onSaved: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<unknown>(null);
  const save = async (value: string | null) => {
    setError(null);
    try {
      await api(`/people/${person!.id}/pin`, { method: "PUT", json: { pin: value } });
      setPin("");
      onSaved();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Modal open={!!person} onClose={onClose} title={`Kiosk PIN for ${person?.displayName ?? ""}`}>
      <p className="mb-4 text-sm text-stone-500">On shared devices that require a PIN, volunteers pick their name and enter this to check gear out. Five wrong tries locks it for 15 minutes.</p>
      <input className="input text-center font-mono text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" autoFocus />
      <div className="mt-3"><ErrorNote error={error} /></div>
      <div className="mt-4 flex gap-2">
        {person?.hasPin && <Button variant="secondary" onClick={() => save(null)}>Remove PIN</Button>}
        <Button className="flex-1" disabled={pin.length < 4} onClick={() => save(pin)}>Save PIN</Button>
      </div>
    </Modal>
  );
}
