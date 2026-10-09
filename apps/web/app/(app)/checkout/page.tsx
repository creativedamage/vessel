"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Building, Check, CircleAlert, DoorOpen, Loader2, Package, ScanLine, Search, Trash2, User, X } from "lucide-react";
import { api, ApiError, useApi, uuid } from "@/lib/api";
import type { AssetSummary, BatchResult, Ministry, Person } from "@/lib/types";
import { Button, cx, ErrorNote, PageHeader } from "@/components/ui";

type Mode = "out" | "in";
type Target = { type: "PERSON"; id: string; label: string } | { type: "MINISTRY"; id: string; label: string } | { type: "ROOM"; id: string; label: string };
interface CartItem {
  asset: AssetSummary;
  clientOpId: string;
  flag: "ok" | "already_out" | "not_out" | "unavailable";
}
type ScanResult =
  | { type: "asset"; asset: AssetSummary }
  | { type: "kit"; kit: { id: string; name: string }; assets: AssetSummary[] }
  | { type: "room"; room: { id: string; name: string; campus: { name: string } } };

// Tiny audio cues so the operator can keep eyes on the gear, not the screen.
function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1320 : 220;
    o.type = ok ? "sine" : "square";
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.09 : 0.25));
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.3);
  } catch {}
}

function flagFor(mode: Mode, a: AssetSummary): CartItem["flag"] {
  if (mode === "out") return a.status === "AVAILABLE" ? "ok" : a.status === "CHECKED_OUT" ? "already_out" : "unavailable";
  return a.status === "CHECKED_OUT" ? "ok" : "not_out";
}

const FLAG_TEXT = {
  already_out: (a: AssetSummary) => `Already out · ${a.openCheckout?.heldBy ?? ""}`,
  not_out: () => "Not checked out",
  unavailable: (a: AssetSummary) => a.status.replace("_", " ").toLowerCase(),
};

export default function CheckoutStation() {
  const [mode, setMode] = useState<Mode>("out");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [code, setCode] = useState("");
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [dueAt, setDueAt] = useState("");
  const [condition, setCondition] = useState<"ok" | "damaged" | "missing_parts">("ok");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusScan = useCallback(() => setTimeout(() => inputRef.current?.focus(), 0), []);
  useEffect(() => {
    focusScan();
  }, [focusScan, mode]);

  const reset = () => {
    setCart([]);
    setTarget(null);
    setResult(null);
    setError(null);
    setDueAt("");
    setCondition("ok");
    setScanMsg(null);
    focusScan();
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setCart((c) => c.map((i) => ({ ...i, flag: flagFor(m, i.asset) })));
    setResult(null);
  };

  const addAssets = (assets: AssetSummary[]) => {
    let added = 0;
    setCart((c) => {
      const next = [...c];
      for (const a of assets) {
        if (next.some((i) => i.asset.id === a.id)) continue;
        next.unshift({ asset: a, clientOpId: uuid(), flag: flagFor(mode, a) });
        added++;
      }
      return next;
    });
    return added;
  };

  const onScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    setCode("");
    setResult(null);
    setScanning(true);
    try {
      const r = await api<ScanResult>(`/scan/${encodeURIComponent(value)}`);
      if (r.type === "asset") {
        const dup = cart.some((i) => i.asset.id === r.asset.id);
        addAssets([r.asset]);
        const f = flagFor(mode, r.asset);
        beep(f === "ok" && !dup);
        setScanMsg({ ok: f === "ok", text: dup ? `${r.asset.displayName} is already in the list` : `${r.asset.assetTag} · ${r.asset.displayName}` });
      } else if (r.type === "kit") {
        addAssets(r.assets);
        beep(true);
        setScanMsg({ ok: true, text: `Kit “${r.kit.name}” · ${r.assets.length} items` });
      } else if (r.type === "room") {
        if (mode === "out") {
          setTarget({ type: "ROOM", id: r.room.id, label: r.room.name });
          setScanMsg({ ok: true, text: `Destination set to ${r.room.name}` });
        } else setScanMsg({ ok: false, text: `That's a room label (${r.room.name}). Scan item tags to check in.` });
        beep(mode === "out");
      }
    } catch (err) {
      beep(false);
      setScanMsg({ ok: false, text: err instanceof ApiError && err.status === 404 ? `Nothing matches “${value}”` : String((err as Error).message) });
    } finally {
      setScanning(false);
      focusScan();
    }
  };

  const ready = cart.filter((i) => i.flag === "ok");
  const canSubmit = ready.length > 0 && (mode === "in" || !!target) && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const items = ready.map((i) => ({ assetId: i.asset.id, clientOpId: i.clientOpId }));
      const res =
        mode === "out"
          ? await api<BatchResult>("/checkouts/batch", {
              method: "POST",
              json: {
                batchId: uuid(),
                items,
                target: target!.type === "PERSON" ? { type: "PERSON", personId: target!.id } : target!.type === "MINISTRY" ? { type: "MINISTRY", ministryId: target!.id } : { type: "ROOM", roomId: target!.id },
                ...(dueAt && { dueAt: new Date(`${dueAt}T23:59:00`).toISOString() }),
              },
            })
          : await api<BatchResult>("/checkins/batch", { method: "POST", json: { batchId: uuid(), items, condition } });
      setResult(res);
      setCart([]);
      beep(res.failed === 0);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Check out / in"
        subtitle="Scan tags with a USB scanner or type them. Scan a room label to set the destination."
        actions={
          <div className="inline-flex rounded-xl border border-stone-300 bg-white p-1 dark:border-stone-700 dark:bg-stone-900">
            {(["out", "in"] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={cx("flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition",
                  mode === m ? (m === "out" ? "bg-amber-500 text-white" : "bg-emerald-600 text-white") : "text-stone-600 dark:text-stone-300")}
              >
                {m === "out" ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
                Check {m}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <form onSubmit={onScan} className="card p-4">
            <div className="relative">
              <ScanLine className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-stone-400" />
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Scan or type an asset tag…"
                className="input h-14 pl-12 font-mono text-lg placeholder:font-sans placeholder:text-base"
                autoComplete="off"
                spellCheck={false}
                aria-label="Asset tag"
              />
              {scanning && <Loader2 className="absolute right-4 top-1/2 size-5 -translate-y-1/2 animate-spin text-stone-400" />}
            </div>
            {scanMsg && (
              <p className={cx("mt-3 flex items-center gap-2 text-sm", scanMsg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                {scanMsg.ok ? <Check className="size-4" /> : <CircleAlert className="size-4" />} {scanMsg.text}
              </p>
            )}
          </form>

          {result && <ResultPanel result={result} mode={mode} onDone={reset} />}

          <div className="card">
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3 dark:border-stone-800">
              <h2 className="font-semibold">
                {cart.length} {cart.length === 1 ? "item" : "items"}
                {cart.length !== ready.length && <span className="ml-2 text-sm font-normal text-amber-600">{cart.length - ready.length} need attention</span>}
              </h2>
              {cart.length > 0 && <Button variant="ghost" size="sm" onClick={() => setCart([])}>Clear</Button>}
            </div>
            {cart.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-14 text-center text-stone-500">
                <Package className="mb-3 size-8 text-stone-300 dark:text-stone-600" />
                <p className="text-sm">Scanned items show up here. Keep scanning — there's no limit.</p>
              </div>
            ) : (
              <ul className="max-h-[28rem] divide-y divide-stone-100 overflow-auto dark:divide-stone-800">
                {cart.map((i) => (
                  <li key={i.asset.id} className="animate-pop flex items-center gap-3 px-5 py-2.5">
                    <span className={cx("size-2 shrink-0 rounded-full", i.flag === "ok" ? "bg-emerald-500" : "bg-amber-500")} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{i.asset.displayName}</div>
                      <div className="flex gap-2 text-xs text-stone-500">
                        <span className="tag">{i.asset.assetTag}</span>
                        {i.flag !== "ok" && <span className="text-amber-600 dark:text-amber-400">{FLAG_TEXT[i.flag](i.asset)}</span>}
                        {mode === "in" && i.flag === "ok" && i.asset.homeRoom && <span>→ {i.asset.homeRoom.name}</span>}
                      </div>
                    </div>
                    <button onClick={() => setCart((c) => c.filter((x) => x.asset.id !== i.asset.id))} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800" aria-label={`Remove ${i.asset.displayName}`}>
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="card sticky top-6 space-y-5 p-5">
            {mode === "out" ? (
              <>
                <TargetPicker target={target} onChange={(t) => { setTarget(t); focusScan(); }} />
                <label className="block">
                  <span className="label">Due back <span className="font-normal text-stone-400">(optional)</span></span>
                  <input type="date" className="input" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                </label>
              </>
            ) : (
              <div>
                <span className="label">Condition</span>
                <div className="grid grid-cols-3 gap-2">
                  {([["ok", "Good"], ["damaged", "Damaged"], ["missing_parts", "Missing parts"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setCondition(v)} className={cx("rounded-xl border px-2 py-2 text-sm transition",
                      condition === v ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200" : "border-stone-300 dark:border-stone-700")}>
                      {l}
                    </button>
                  ))}
                </div>
                {condition !== "ok" && <p className="mt-2 text-xs text-stone-500">These items will be marked “In service” so nobody grabs them by mistake.</p>}
              </div>
            )}
            <ErrorNote error={error} />
            <Button size="lg" className={cx("w-full", mode === "in" && "!bg-emerald-600 hover:!bg-emerald-700")} disabled={!canSubmit} onClick={submit}>
              {submitting ? <Loader2 className="size-5 animate-spin" /> : mode === "out" ? <ArrowUpRight className="size-5" /> : <ArrowDownLeft className="size-5" />}
              {mode === "out"
                ? target ? `Check out ${ready.length || ""} to ${target.label}` : "Choose who or where"
                : `Check in ${ready.length || ""} ${ready.length === 1 ? "item" : "items"}`}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function TargetPicker({ target, onChange }: { target: Target | null; onChange: (t: Target | null) => void }) {
  const [tab, setTab] = useState<Target["type"]>("PERSON");
  const [q, setQ] = useState("");
  const { data: dest } = useApi<{ ministries: Ministry[]; rooms: { id: string; name: string; campus: { name: string } }[] }>("/destinations");
  const { data: people } = useApi<{ items: Person[] }>(tab === "PERSON" ? `/people?limit=8${q ? `&q=${encodeURIComponent(q)}` : ""}` : null, { keepPreviousData: true });

  const rooms = useMemo(() => dest?.rooms.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())) ?? [], [dest, q]);
  const ministries = useMemo(() => dest?.ministries.filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase())) ?? [], [dest, q]);

  if (target) {
    const Icon = target.type === "PERSON" ? User : target.type === "MINISTRY" ? Building : DoorOpen;
    return (
      <div>
        <span className="label">Checking out to</span>
        <div className="flex items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3 dark:border-brand-700 dark:bg-brand-500/10">
          <Icon className="size-5 text-brand-600 dark:text-brand-300" />
          <span className="flex-1 font-medium">{target.label}</span>
          <button onClick={() => onChange(null)} className="rounded-lg p-1 hover:bg-brand-100 dark:hover:bg-brand-500/20" aria-label="Change">
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  const chip = "flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-left text-sm transition hover:border-brand-400 hover:bg-brand-50 dark:border-stone-700 dark:hover:bg-brand-500/10";
  return (
    <div>
      <span className="label">Who or where?</span>
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1 text-sm dark:bg-stone-800">
        {([["PERSON", "Person", User], ["MINISTRY", "Ministry", Building], ["ROOM", "Room", DoorOpen]] as const).map(([t, l, Icon]) => (
          <button key={t} onClick={() => setTab(t)} className={cx("flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium", tab === t ? "bg-white shadow-xs dark:bg-stone-900" : "text-stone-500")}>
            <Icon className="size-3.5" />{l}
          </button>
        ))}
      </div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
        <input className="input pl-9" placeholder={tab === "PERSON" ? "Type a name…" : "Filter…"} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid max-h-64 gap-1.5 overflow-auto">
        {tab === "PERSON" && people?.items.map((p) => (
          <button key={p.id} className={chip} onClick={() => onChange({ type: "PERSON", id: p.id, label: p.displayName })}>
            <span className="flex size-6 items-center justify-center rounded-full bg-stone-200 text-[10px] font-semibold dark:bg-stone-700">{p.displayName.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span>
            <span className="flex-1">{p.displayName}</span>
            <span className="text-xs capitalize text-stone-400">{p.kind.toLowerCase()}</span>
          </button>
        ))}
        {tab === "PERSON" && people?.items.length === 0 && (
          <p className="text-sm text-stone-500">No match. <Link href="/people" className="text-brand-600 underline">Add a person</Link></p>
        )}
        {tab === "MINISTRY" && ministries.map((m) => (
          <button key={m.id} className={chip} onClick={() => onChange({ type: "MINISTRY", id: m.id, label: m.name })}>
            <span className="size-2.5 rounded-full" style={{ background: m.color ?? "#a8a29e" }} />{m.name}
          </button>
        ))}
        {tab === "ROOM" && rooms.map((r) => (
          <button key={r.id} className={chip} onClick={() => onChange({ type: "ROOM", id: r.id, label: r.name })}>
            <DoorOpen className="size-4 text-stone-400" /><span className="flex-1">{r.name}</span><span className="text-xs text-stone-400">{r.campus.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultPanel({ result, mode, onDone }: { result: BatchResult; mode: Mode; onDone: () => void }) {
  const problems = result.results.filter((r) => !["ok", "duplicate", "already_in"].includes(r.status));
  const byRoom = mode === "in"
    ? Object.entries(result.results.reduce<Record<string, number>>((acc, r) => {
        if (r.status === "ok" && r.returnTo) acc[r.returnTo] = (acc[r.returnTo] ?? 0) + 1;
        return acc;
      }, {}))
    : [];
  return (
    <div className={cx("card animate-pop p-5", problems.length ? "border-amber-300 dark:border-amber-700" : "border-emerald-300 dark:border-emerald-700")}>
      <div className="flex items-start gap-3">
        <div className={cx("flex size-10 items-center justify-center rounded-full", problems.length ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
          {problems.length ? <CircleAlert className="size-5" /> : <Check className="size-5" />}
        </div>
        <div className="flex-1">
          <p className="font-semibold">
            {result.succeeded} {result.succeeded === 1 ? "item" : "items"} {mode === "out" ? `checked out to ${result.target}` : "checked in"}
          </p>
          {byRoom.length > 0 && (
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">Put back: {byRoom.map(([room, n]) => `${n} → ${room}`).join(" · ")}</p>
          )}
          {problems.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {problems.map((p) => (
                <li key={p.clientOpId} className="text-amber-800 dark:text-amber-300">
                  <span className="tag">{p.assetTag}</span> {p.displayName}: {p.status === "already_out" ? `already out with ${p.heldBy}` : p.message ?? p.status.replace("_", " ")}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={onDone}>New batch</Button>
      </div>
    </div>
  );
}
