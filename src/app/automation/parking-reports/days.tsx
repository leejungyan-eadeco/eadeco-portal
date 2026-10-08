"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { explain } from "@/lib/nav-errors";
import { todayMY } from "@/lib/schedule";
import type { ParkingRun } from "@/lib/types";
import { columnHelper, DataTable, RowActions, type Columns } from "../../data-table";
import { fmtDate, fmtDateTime, num, rm, StatusBadge } from "../../ui";
import { RunDetails, type RunRow } from "./run-details";

// One row per report day, newest first: did it run, what did it create, how many tries. A day gets at most one
// draft from the portal; extra tries are failures that were retried (or a Fetch for a day that already had one).
type Day = { date: string; result: "Created" | "Processing" | "Deleted in NAV" | "Failed" | "Will retry" | "Not run"; run: RunRow | null; tries: number };

const col = columnHelper<Day>();
const minusDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

const toRow = (r: ParkingRun, laterCreated: boolean): RunRow => {
  const net = (r.totals ?? []).reduce((a, t) => a + t.net, 0);
  if (r.result === "Running") return { ...r, net, status: "Processing", summary: "Processing" };
  if (r.result === "Deleted") return { ...r, net, status: "Deleted in NAV", summary: r.note ?? `Draft ${r.navDocument} was deleted in NAV` };
  if (r.result === "Created") return { ...r, net, status: "Created", summary: r.navDocument ?? r.note ?? "" };
  const x = explain(r.error ?? "", r.errorCode);
  return { ...r, net, status: laterCreated ? "Resolved" : x.retry ? "Will retry" : "Failed", summary: x.summary };
};

export function DaysTab({ runs, startDate }: { runs: ParkingRun[]; startDate: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const router = useRouter();

  const days = useMemo<Day[]>(() => {
    const byDate = new Map<string, ParkingRun[]>();
    for (const r of runs) byDate.set(r.reportDate, [...(byDate.get(r.reportDate) ?? []), r]); // newest first
    // Every day from the first report date to yesterday, plus any other day that has runs.
    const dates = new Set(byDate.keys());
    for (let d = minusDay(todayMY()); d >= startDate; d = minusDay(d)) dates.add(d);
    return [...dates]
      .sort((a, b) => b.localeCompare(a))
      .map((date) => {
        const list = byDate.get(date) ?? [];
        const created = list.find((r) => r.result === "Created");
        const run = created ? toRow(created, false) : list[0] ? toRow(list[0], false) : null;
        return { date, run, tries: list.length, result: run ? (run.status as Day["result"]) : "Not run" };
      });
  }, [runs, startDate]);

  // While a run is in progress, refresh so its day updates when it finishes.
  const busy = runs.some((r) => r.result === "Running");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [busy, router]);

  const columns = useMemo<Columns<Day>>(
    () => [
      col.accessor("date", { header: "Report date", cell: (c) => <span className="font-medium whitespace-nowrap">{fmtDate(c.getValue())}</span> }),
      col.accessor("result", { header: "Result", meta: { filter: "results" }, cell: (c) => <StatusBadge status={c.getValue()} /> }),
      col.accessor((d) => d.run?.navDocument ?? "", { id: "nav", header: "NAV draft", cell: (c) => <span className="tabular-nums">{c.getValue() || <span className="text-ink-3">–</span>}</span> }),
      col.accessor((d) => d.run?.net ?? 0, {
        id: "net",
        header: "Net sales (RM)",
        meta: { className: "text-right" },
        cell: ({ row: { original: d } }) => (d.run?.totals ? <span className={num}>{rm(d.run.net)}</span> : <span className="text-ink-3">–</span>),
      }),
      col.accessor("tries", { header: "Tries", meta: { className: "text-right" }, cell: (c) => <span className={`${num} ${c.getValue() > 1 ? "font-medium text-warn" : ""}`}>{c.getValue() || "–"}</span> }),
      col.accessor((d) => d.run?.at ?? "", {
        id: "last",
        header: "Ran",
        meta: { className: "w-full" },
        cell: ({ row: { original: d } }) =>
          d.run ? (
            <>
              <div className="whitespace-nowrap tabular-nums">{fmtDateTime(d.run.at)}</div>
              <div className="text-xs text-ink-3">{d.run.triggeredBy}</div>
            </>
          ) : (
            <span className="text-ink-3">No run yet</span>
          ),
      }),
      col.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: d } }) => (d.run ? <RowActions name={`run for ${fmtDate(d.date)}`} onView={() => setOpen(d.run!.id)} /> : null),
      }),
    ],
    [],
  );

  const openRow = open != null ? days.find((d) => d.run?.id === open)?.run ?? null : null;

  return (
    <>
      <DataTable data={days} columns={columns} search="Search date or NAV document" empty={{ title: "No days yet", hint: "Days appear from the first report date onwards." }} />
      {openRow && <RunDetails run={openRow} onClose={() => setOpen(null)} />}
    </>
  );
}
