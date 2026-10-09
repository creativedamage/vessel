"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, ChevronRight, DoorOpen, Layers, Plus, Warehouse } from "lucide-react";
import { api, useApi } from "@/lib/api";
import type { Campus, Ministry, Room } from "@/lib/types";
import { useMe } from "@/components/shell";
import { Button, ErrorNote, Field, Modal, PageHeader, Skeleton } from "@/components/ui";

const ROOM_ICON = { BUILDING: Building2, FLOOR: Layers, ROOM: DoorOpen, STORAGE: Warehouse, SHELF: Warehouse };

function RoomTree({ rooms, parentId, depth }: { rooms: Room[]; parentId: string | null; depth: number }) {
  const children = rooms.filter((r) => r.parentId === parentId);
  if (!children.length) return null;
  return (
    <ul>
      {children.map((r) => {
        const Icon = ROOM_ICON[r.kind];
        return (
          <li key={r.id}>
            <div className="flex items-center gap-2 rounded-lg py-1.5 pr-2 text-sm hover:bg-stone-50 dark:hover:bg-stone-800/50" style={{ paddingLeft: 8 + depth * 20 }}>
              <Icon className="size-4 text-stone-400" />
              <span className="flex-1">{r.name}</span>
              {r.qrCode && <span className="tag text-xs text-stone-400">{r.qrCode}</span>}
              {r.assetCount ? <span className="w-16 text-right text-xs text-stone-500">{r.assetCount} assets</span> : <span className="w-16" />}
            </div>
            <RoomTree rooms={rooms} parentId={r.id} depth={depth + 1} />
          </li>
        );
      })}
    </ul>
  );
}

function MinistryTree({ items, parentId, depth }: { items: Ministry[]; parentId: string | null; depth: number }) {
  const children = items.filter((m) => m.parentId === parentId);
  if (!children.length) return null;
  return (
    <ul>
      {children.map((m) => (
        <li key={m.id}>
          <Link href={`/assets?ministryId=${m.id}`} className="group flex items-center gap-2 rounded-lg py-1.5 pr-2 text-sm hover:bg-stone-50 dark:hover:bg-stone-800/50" style={{ paddingLeft: 8 + depth * 20 }}>
            <span className="size-2.5 rounded-full" style={{ background: m.color ?? "#a8a29e" }} />
            <span className="flex-1 font-medium">{m.name}</span>
            {m.leaders?.length ? <span className="text-xs text-stone-500">{m.leaders.map((l) => l.displayName).join(", ")}</span> : null}
            <span className="w-16 text-right text-xs text-stone-500">{m.assetCount ?? 0} assets</span>
            <ChevronRight className="size-4 text-stone-300 opacity-0 group-hover:opacity-100" />
          </Link>
          <MinistryTree items={items} parentId={m.id} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

export default function Places() {
  const { data: me } = useMe();
  const isAdmin = me && (me.person.role === "ADMIN" || me.person.role === "OWNER");
  const { data: campuses, mutate: reloadCampuses } = useApi<{ items: Campus[] }>("/campuses");
  const { data: ministries, mutate: reloadMinistries } = useApi<{ items: Ministry[] }>("/ministries");
  const [modal, setModal] = useState<null | "campus" | "room" | "ministry">(null);

  return (
    <>
      <PageHeader title="Campuses & Ministries" subtitle="Where things live, and which team they belong to." />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Campuses &amp; rooms</h2>
            {isAdmin && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setModal("room")}><Plus className="size-4" /> Room</Button>
                <Button size="sm" variant="ghost" onClick={() => setModal("campus")}><Plus className="size-4" /> Campus</Button>
              </div>
            )}
          </div>
          {!campuses ? <Skeleton className="h-48" /> : campuses.items.map((c) => (
            <div key={c.id} className="mb-4 last:mb-0">
              <div className="mb-1 flex items-baseline justify-between px-2">
                <h3 className="font-medium">{c.name}</h3>
                <span className="text-xs text-stone-500">{c.address}</span>
              </div>
              <RoomTree rooms={c.rooms} parentId={null} depth={0} />
            </div>
          ))}
        </section>
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Ministries</h2>
            {isAdmin && <Button size="sm" variant="ghost" onClick={() => setModal("ministry")}><Plus className="size-4" /> Ministry</Button>}
          </div>
          {!ministries ? <Skeleton className="h-48" /> : <MinistryTree items={ministries.items} parentId={null} depth={0} />}
        </section>
      </div>

      <AddCampus open={modal === "campus"} onClose={() => setModal(null)} onSaved={() => { setModal(null); reloadCampuses(); }} />
      <AddRoom open={modal === "room"} campuses={campuses?.items ?? []} onClose={() => setModal(null)} onSaved={() => { setModal(null); reloadCampuses(); }} />
      <AddMinistry open={modal === "ministry"} ministries={ministries?.items ?? []} onClose={() => setModal(null)} onSaved={() => { setModal(null); reloadMinistries(); }} />
    </>
  );
}

function useSubmit(fn: () => Promise<unknown>, onSaved: () => void) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

function AddCampus({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const s = useSubmit(() => api("/campuses", { method: "POST", json: { name, address: address || undefined } }), onSaved);
  return (
    <Modal open={open} onClose={onClose} title="Add campus">
      <form onSubmit={s.run} className="space-y-4">
        <Field label="Name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="West Campus" /></Field>
        <Field label="Address"><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <ErrorNote error={s.error} />
        <Button type="submit" className="w-full" disabled={s.busy}>Add campus</Button>
      </form>
    </Modal>
  );
}

function AddRoom({ open, campuses, onClose, onSaved }: { open: boolean; campuses: Campus[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ campusId: "", parentId: "", name: "", kind: "ROOM" });
  const parents = campuses.find((c) => c.id === f.campusId)?.rooms ?? [];
  const s = useSubmit(() => api("/rooms", { method: "POST", json: { ...f, parentId: f.parentId || undefined } }), onSaved);
  return (
    <Modal open={open} onClose={onClose} title="Add room">
      <form onSubmit={s.run} className="space-y-4">
        <Field label="Campus">
          <select className="input" required value={f.campusId} onChange={(e) => setF({ ...f, campusId: e.target.value, parentId: "" })}>
            <option value="">Choose…</option>
            {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Inside (optional)">
          <select className="input" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
            <option value="">— top level —</option>
            {parents.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Green Room" /></Field>
          <Field label="Kind">
            <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="BUILDING">Building</option><option value="FLOOR">Floor</option><option value="ROOM">Room</option><option value="STORAGE">Storage</option><option value="SHELF">Shelf</option>
            </select>
          </Field>
        </div>
        <ErrorNote error={s.error} />
        <Button type="submit" className="w-full" disabled={s.busy}>Add room</Button>
      </form>
    </Modal>
  );
}

const COLORS = ["#7c3aed", "#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#d97706", "#dc2626", "#db2777", "#64748b"];

function AddMinistry({ open, ministries, onClose, onSaved }: { open: boolean; ministries: Ministry[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", parentId: "", color: COLORS[0]! });
  const s = useSubmit(() => api("/ministries", { method: "POST", json: { ...f, parentId: f.parentId || undefined } }), onSaved);
  return (
    <Modal open={open} onClose={onClose} title="Add ministry">
      <form onSubmit={s.run} className="space-y-4">
        <Field label="Name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Students" /></Field>
        <Field label="Part of (optional)">
          <select className="input" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
            <option value="">— none —</option>
            {ministries.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <div>
          <span className="label">Color</span>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setF({ ...f, color: c })} className="size-7 rounded-full ring-offset-2 dark:ring-offset-stone-900" style={{ background: c, boxShadow: f.color === c ? `0 0 0 2px ${c}` : undefined }} aria-label={c} />
            ))}
          </div>
        </div>
        <ErrorNote error={s.error} />
        <Button type="submit" className="w-full" disabled={s.busy}>Add ministry</Button>
      </form>
    </Modal>
  );
}
