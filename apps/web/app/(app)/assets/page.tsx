"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { useApi } from "@/lib/api";
import type { AssetStatus, AssetSummary, Campus, Ministry } from "@/lib/types";
import { Button, Empty, MinistryChip, PageHeader, Skeleton, StatusBadge } from "@/components/ui";

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: AssetSummary[];
}

function AssetList() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "";
  const ministryId = params.get("ministryId") ?? "";
  const campusId = params.get("campusId") ?? "";
  const page = Number(params.get("page") ?? 1);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    router.replace(`/assets?${next}`);
  };

  // Debounce the search box into the URL.
  useEffect(() => {
    const t = setTimeout(() => (q !== (params.get("q") ?? "") ? setParam("q", q) : undefined), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = new URLSearchParams({ pageSize: "50", page: String(page) });
  for (const [k, v] of Object.entries({ q: params.get("q") ?? "", status, ministryId, campusId })) if (v) query.set(k, v);
  const { data, isLoading } = useApi<ListResponse>(`/assets?${query}`, { keepPreviousData: true });
  const { data: ministries } = useApi<{ items: Ministry[] }>("/ministries");
  const { data: campuses } = useApi<{ items: Campus[] }>("/campuses");

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle={data ? `${data.total} ${data.total === 1 ? "asset" : "assets"}` : " "}
        actions={<Button href="/assets/new"><Plus className="size-4" /> Add asset</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <input className="input pl-9" placeholder="Search tag, name, serial, make…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={status} onChange={(e) => setParam("status", e.target.value)} aria-label="Status">
          <option value="">All active</option>
          {(["AVAILABLE", "CHECKED_OUT", "IN_SERVICE", "MISSING", "RETIRED"] as AssetStatus[]).map((s) => (
            <option key={s} value={s}>{s.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>
          ))}
        </select>
        <select className="input w-auto" value={ministryId} onChange={(e) => setParam("ministryId", e.target.value)} aria-label="Ministry">
          <option value="">All ministries</option>
          {ministries?.items.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select className="input w-auto" value={campusId} onChange={(e) => setParam("campusId", e.target.value)} aria-label="Campus">
          <option value="">All campuses</option>
          {campuses?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:bg-stone-900/60">
              <tr>
                <th className="px-5 py-3">Asset</th>
                <th className="px-3 py-3">Tag</th>
                <th className="px-3 py-3">Ministry</th>
                <th className="hidden px-3 py-3 md:table-cell">Home</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {isLoading && !data
                ? Array.from({ length: 8 }, (_, i) => (
                    <tr key={i}><td colSpan={5} className="px-5 py-3"><Skeleton className="h-6" /></td></tr>
                  ))
                : data?.items.map((a) => (
                    <tr key={a.id} className="cursor-pointer transition hover:bg-stone-50 dark:hover:bg-stone-800/40" onClick={() => router.push(`/assets/${a.id}`)}>
                      <td className="px-5 py-3">
                        <Link href={`/assets/${a.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{a.displayName}</Link>
                        <div className="text-xs text-stone-500">{[a.itemType.manufacturer, a.itemType.name].filter(Boolean).join(" ")}{a.quantity > 1 && ` · qty ${a.quantity}`}</div>
                      </td>
                      <td className="px-3 py-3"><span className="tag text-stone-600 dark:text-stone-400">{a.assetTag}</span></td>
                      <td className="px-3 py-3"><MinistryChip ministry={a.ministry} /></td>
                      <td className="hidden px-3 py-3 text-stone-600 md:table-cell dark:text-stone-400">{a.homeRoom?.name ?? "—"}<span className="text-stone-400"> · {a.homeCampus?.name}</span></td>
                      <td className="px-3 py-3">
                        <StatusBadge status={a.status} />
                        {a.openCheckout && <div className="mt-0.5 text-xs text-stone-500">{a.openCheckout.heldBy}</div>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {data && data.items.length === 0 && (
          <Empty icon={<Boxes className="size-8" />} title="No assets match">Try a different search or clear the filters.</Empty>
        )}
        {data && pages > 1 && (
          <div className="flex items-center justify-between border-t border-stone-200 px-5 py-3 text-sm dark:border-stone-800">
            <span className="text-stone-500">Page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}><ChevronLeft className="size-4" /></Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setParam("page", String(page + 1))}><ChevronRight className="size-4" /></Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function AssetsPage() {
  return (
    <Suspense>
      <AssetList />
    </Suspense>
  );
}
