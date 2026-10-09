"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity as ActivityIcon } from "lucide-react";
import { useApi } from "@/lib/api";
import { ACTION_LABEL } from "@/lib/format";
import { Button, cx, Empty, PageHeader, Skeleton } from "@/components/ui";

interface Event {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorName: string | null;
  deviceName: string | null;
  batchId: string | null;
  after: Record<string, unknown> | null;
}

const FILTERS = [["", "All"], ["asset.checkout", "Check-outs"], ["asset.checkin", "Check-ins"], ["asset.", "Asset changes"], ["person", "People"], ["kiosk", "Devices"]] as const;

export default function ActivityPage() {
  const [action, setAction] = useState("");
  const [before, setBefore] = useState<string[]>([]);
  const cursor = before.at(-1);
  const qs = new URLSearchParams({ limit: "50" });
  if (action) qs.set("action", action);
  if (cursor) qs.set("before", cursor);
  const { data } = useApi<{ items: Event[]; nextBefore: string | null }>(`/audit?${qs}`, { keepPreviousData: true });

  return (
    <>
      <PageHeader title="Activity" subtitle="Every change, who made it and from which device. This log can't be edited." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map(([v, l]) => (
          <button key={v} onClick={() => { setAction(v); setBefore([]); }}
            className={cx("rounded-full border px-3 py-1 text-sm", action === v ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900" : "border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300")}>
            {l}
          </button>
        ))}
      </div>
      <div className="card overflow-hidden">
        {!data ? (
          <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : data.items.length === 0 ? (
          <Empty icon={<ActivityIcon className="size-8" />} title="No activity" />
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-5 py-2.5 text-xs text-stone-500">{new Date(e.occurredAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium">{e.actorName ?? e.deviceName ?? "System"}</span>{" "}
                    <span className="text-stone-500">{ACTION_LABEL[e.action] ?? e.action}</span>{" "}
                    {e.entityType === "Asset" ? (
                      <Link href={`/assets/${e.entityId}`} className="hover:underline">{e.entityType.toLowerCase()}</Link>
                    ) : (
                      <span className="text-stone-500">{e.entityType.toLowerCase()}</span>
                    )}
                    {typeof e.after?.to === "string" && <span className="text-stone-500"> → {e.after.to}</span>}
                    {typeof e.after?.returnedTo === "string" && <span className="text-stone-500"> → {e.after.returnedTo}</span>}
                  </td>
                  <td className="hidden px-5 py-2.5 text-right text-xs text-stone-400 sm:table-cell">{e.deviceName && e.actorType === "VOLUNTEER_KIOSK" ? `via ${e.deviceName}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-4 flex justify-between">
        <Button variant="secondary" size="sm" disabled={!before.length} onClick={() => setBefore(before.slice(0, -1))}>Newer</Button>
        <Button variant="secondary" size="sm" disabled={!data?.nextBefore} onClick={() => data?.nextBefore && setBefore([...before, data.nextBefore])}>Older</Button>
      </div>
    </>
  );
}
