"use client";

import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, CalendarClock, PackageCheck, Plus, ScanLine, ShieldCheck, Wrench } from "lucide-react";
import { useApi } from "@/lib/api";
import { daysUntil, fmtDate, fmtMoney, fmtRelative } from "@/lib/format";
import { useMe } from "@/components/shell";
import { Button, cx, Empty, PageHeader, Skeleton } from "@/components/ui";

interface Stats {
  counts: { total: number; available: number; checkedOut: number; inService: number; missing: number; overdue: number };
  totalValue: string;
  warrantyExpiring: { id: string; assetTag: string; name: string | null; warrantyEndsAt: string; itemType: { name: string } }[];
  serviceDue: { id: string; assetTag: string; name: string | null; nextServiceAt: string; itemType: { name: string } }[];
  byMinistry: { id: string; name: string; color: string | null; total: number; checkedOut: number }[];
  recent: {
    id: string;
    action: string;
    occurredAt: string;
    asset: { id: string; assetTag: string; displayName: string } | null;
    actor: string;
    via: string | null;
    after: { to?: string; returnedTo?: string } | null;
  }[];
}

function Stat({ label, value, icon: Icon, tone, href }: { label: string; value: number | string | undefined; icon: typeof Boxes; tone: string; href?: string }) {
  const body = (
    <div className="card flex items-center gap-4 p-5 transition hover:border-stone-300 dark:hover:border-stone-700">
      <div className={cx("flex size-11 items-center justify-center rounded-xl", tone)}>
        <Icon className="size-5" />
      </div>
      <div>
        <div className="text-2xl font-semibold tabular-nums">{value ?? <Skeleton className="h-7 w-12" />}</div>
        <div className="text-sm text-stone-500">{label}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function Dashboard() {
  const { data: me } = useMe();
  const { data } = useApi<Stats>("/stats", { refreshInterval: 15000 });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const maxMinistry = Math.max(1, ...(data?.byMinistry.map((m) => m.total) ?? [1]));

  return (
    <>
      <PageHeader
        title={me ? `${greeting}, ${me.person.displayName.split(" ")[0]}` : greeting}
        subtitle={data ? `${data.counts.total} assets worth ${fmtMoney(data.totalValue)} across your campuses` : " "}
        actions={
          <>
            <Button variant="secondary" href="/assets/new"><Plus className="size-4" /> Add asset</Button>
            <Button href="/checkout"><ScanLine className="size-4" /> Check out / in</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Available" value={data?.counts.available} icon={PackageCheck} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" href="/assets?status=AVAILABLE" />
        <Stat label="Checked out" value={data?.counts.checkedOut} icon={ArrowUpRight} tone="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" href="/assets?status=CHECKED_OUT" />
        <Stat label="Overdue returns" value={data?.counts.overdue} icon={AlertTriangle} tone="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" />
        <Stat label="In service" value={data?.counts.inService} icon={Wrench} tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" href="/assets?status=IN_SERVICE" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="card lg:col-span-3">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4 dark:border-stone-800">
            <h2 className="font-semibold">Recent activity</h2>
            <Link href="/activity" className="text-sm text-brand-600 hover:underline dark:text-brand-400">See all</Link>
          </div>
          {!data ? (
            <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : data.recent.length === 0 ? (
            <Empty title="Nothing yet">Check-outs and check-ins will show up here.</Empty>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {data.recent.map((e) => {
                const out = e.action === "asset.checkout";
                const inn = e.action === "asset.checkin";
                return (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                    <div className={cx("flex size-8 shrink-0 items-center justify-center rounded-full",
                      out ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : inn ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300")}>
                      {out ? <ArrowUpRight className="size-4" /> : inn ? <ArrowDownLeft className="size-4" /> : <Plus className="size-4" />}
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <span className="font-medium">{e.actor}</span>{" "}
                      <span className="text-stone-500">{out ? "checked out" : inn ? "checked in" : "added"}</span>{" "}
                      {e.asset && <Link href={`/assets/${e.asset.id}`} className="font-medium hover:underline">{e.asset.displayName}</Link>}
                      {out && e.after?.to && <span className="text-stone-500"> to {e.after.to}</span>}
                      {e.via && e.via !== e.actor && <span className="text-stone-400"> · via {e.via}</span>}
                    </div>
                    <time className="shrink-0 text-xs text-stone-400">{fmtRelative(e.occurredAt)}</time>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="mb-4 font-semibold">By ministry</h2>
            <div className="space-y-3">
              {data?.byMinistry.slice(0, 8).map((m) => (
                <Link key={m.id} href={`/assets?ministryId=${m.id}`} className="block">
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: m.color ?? "#a8a29e" }} />{m.name}</span>
                    <span className="tabular-nums text-stone-500">{m.checkedOut > 0 && <span className="text-amber-600 dark:text-amber-400">{m.checkedOut} out · </span>}{m.total}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                    <div className="h-full rounded-full" style={{ width: `${(m.total / maxMinistry) * 100}%`, background: m.color ?? "#a8a29e" }} />
                  </div>
                </Link>
              )) ?? <Skeleton className="h-40" />}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><CalendarClock className="size-4 text-stone-400" /> Coming up</h2>
            {data && data.serviceDue.length + data.warrantyExpiring.length === 0 && <p className="text-sm text-stone-500">No service or warranty dates in the next 60 days.</p>}
            <ul className="space-y-2 text-sm">
              {data?.serviceDue.map((a) => {
                const d = daysUntil(a.nextServiceAt);
                return (
                  <li key={`s${a.id}`} className="flex items-center gap-2">
                    <Wrench className="size-3.5 shrink-0 text-sky-500" />
                    <Link href={`/assets/${a.id}`} className="flex-1 truncate hover:underline">{a.name ?? a.itemType.name}</Link>
                    <span className={cx("shrink-0 text-xs", d < 0 ? "text-red-600" : "text-stone-500")}>{d < 0 ? `service ${-d}d overdue` : `service ${fmtDate(a.nextServiceAt)}`}</span>
                  </li>
                );
              })}
              {data?.warrantyExpiring.map((a) => (
                <li key={`w${a.id}`} className="flex items-center gap-2">
                  <ShieldCheck className="size-3.5 shrink-0 text-violet-500" />
                  <Link href={`/assets/${a.id}`} className="flex-1 truncate hover:underline">{a.name ?? a.itemType.name}</Link>
                  <span className="shrink-0 text-xs text-stone-500">warranty ends {fmtDate(a.warrantyEndsAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
