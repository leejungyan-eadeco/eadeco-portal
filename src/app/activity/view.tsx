"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { explain } from "@/lib/nav-errors";
import type { ParkingRun, ParkingSetupRow, Run } from "@/lib/types";
import { parkingFailure, RunDetails as ParkingRunDetails } from "../automation/parking-reports/run-details";
import { columnHelper, DataTable, RowActions, type Columns } from "../data-table";
import { Dialog } from "../dialog";
import { Badge, fmtDate, fmtDateTime, StatusBadge } from "../ui";

// Every run of every automation, newest first: one log, filtered by Automation instead of a tab per automation.
// A failed run is shown as Failed only when a person has to act. A hiccup the portal retries on its own
// shows Will retry, and once a later run created that draft, the old attempt shows Resolved.
type Status = "Processing" | "Created" | "Deleted in NAV" | "Failed" | "Will retry" | "Resolved";
type Row = {
  key: string;
  automation: "Recurring invoice" | "Parking report";
  at: string;
  triggeredBy: string;
  companyName: string;
  subject: string; // customer / vendor, or the parking setup
  periodDate: string;
  status: Status;
  summary: string;
  note: string | null;
  retryAt?: Date | null;
  open: () => void;
};

const col = columnHelper<Row>();

const statusOf = (result: string, error: string | null, code: string | null, laterCreated: boolean): { status: Status; summary: string } => {
  const x = explain(error ?? "", code);
  return { status: laterCreated ? "Resolved" : x.retry ? "Will retry" : "Failed", summary: x.summary };
};

function InvoiceRunDetails({ run: r, status, onClose }: { run: Run; status: Status; onClose: () => void }) {
  const x = r.error ? explain(r.error, r.errorCode) : null;
  const item = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
  return (
    <Dialog open variant="sheet" onClose={onClose} title={`Run for ${r.partyName}`}>
      <div className="grid gap-6 text-sm">
        <dl className="grid gap-4 sm:grid-cols-2">
          {item("Result", <StatusBadge status={status} />)}
          {item("NAV draft", r.navDocument ? <span className="tabular-nums">{r.navDocument}</span> : <span className="text-ink-3">None</span>)}
          {item("Company", r.companyName)}
          {item("Customer / vendor", r.partyName)}
          {item("For date", fmtDate(r.periodDate))}
          {item("Ran", fmtDateTime(r.at))}
          {item("Started by", r.triggeredBy ?? "Scheduler")}
        </dl>
        {r.note && (
          <div className="rounded-lg bg-warn-soft px-4 py-3 text-warn">
            <p className="mb-1 text-xs font-medium">Note</p>
            {r.note}
          </div>
        )}
        {x && (
          <div className={`grid gap-3 rounded-lg px-4 py-3 ${status === "Failed" ? "bg-bad-soft" : "bg-subtle"}`}>
            {status === "Resolved" && <p className="text-ink-2">A later run created this draft, so there is nothing to do.</p>}
            <div>
              <p className="text-xs font-medium text-ink-3">What happened</p>
              <p className={status === "Failed" ? "text-bad" : "text-ink"}>{x.summary}</p>
            </div>
            {status !== "Resolved" && (
              <>
                <div>
                  <p className="text-xs font-medium text-ink-3">What to do</p>
                  <p className="text-ink">{x.action}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-ink-3">Who fixes it</p>
                  <p className="text-ink">{x.owner}</p>
                </div>
              </>
            )}
            <details className="text-ink-2">
              <summary className="cursor-pointer text-xs font-medium text-ink-3">
                Technical details for IT <Badge className="ml-1 px-1.5 py-px text-[10px]">{x.code}</Badge>
              </summary>
              <p className="mt-2 [overflow-wrap:anywhere] whitespace-pre-wrap text-xs">{r.error}</p>
            </details>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function RunsTable({ runs, parkingRuns, setups, automation }: { runs: Run[]; parkingRuns: ParkingRun[]; setups: ParkingSetupRow[]; automation?: string }) {
  // What is open, by id: the panel then follows the fresh data as the list refreshes (a run in progress fills in).
  const [viewing, setViewing] = useState<{ invoice: Run; status: Status } | { parkingId: number } | null>(null);
  const router = useRouter();

  const rows = useMemo<Row[]>(() => {
    const createdInvoice = new Set(runs.filter((r) => r.result === "Created").map((r) => `${r.invoiceId}|${r.periodDate}`));
    const createdParking = new Set(parkingRuns.filter((r) => r.result === "Created").map((r) => `${r.setupId}|${r.reportDate}`));
    const invoiceRows = runs.map((r): Row => {
      const s = r.result === "Created" ? { status: "Created" as const, summary: r.navDocument ?? "" } : statusOf(r.result, r.error, r.errorCode, createdInvoice.has(`${r.invoiceId}|${r.periodDate}`));
      return {
        key: `i${r.id}`, automation: "Recurring invoice", at: r.at, triggeredBy: r.triggeredBy ?? "Scheduler", companyName: r.companyName, subject: r.partyName,
        periodDate: r.periodDate, note: r.note, ...s, open: () => setViewing({ invoice: r, status: s.status }),
      };
    });
    const parkingRows = parkingRuns.map((r): Row => {
      const net = (r.totals ?? []).reduce((a, t) => a + t.net, 0);
      const s =
        r.result === "Running"
          ? { status: "Processing" as const, summary: `Processing: ${r.steps.at(-1)?.step ?? "starting"}` }
          : r.result === "Deleted"
            ? { status: "Deleted in NAV" as const, summary: r.note ?? `Draft ${r.navDocument} was deleted in NAV` }
          : r.result === "Created"
            ? { status: "Created" as const, summary: r.navDocument ?? r.note ?? "" }
            : parkingFailure(r, createdParking.has(`${r.setupId}|${r.reportDate}`), setups.find((x) => x.id === r.setupId));
      return {
        key: `p${r.id}`, automation: "Parking report", at: r.at, triggeredBy: r.triggeredBy, companyName: r.companyName ?? "", subject: r.setupName,
        periodDate: r.reportDate, note: null, ...s, open: () => setViewing({ parkingId: r.id }),
      };
    });
    return [...invoiceRows, ...parkingRows].sort((a, b) => b.at.localeCompare(a.at));
  }, [runs, parkingRuns]);

  // While anything is processing, fetch the list again every few seconds so its steps and result appear.
  const busy = parkingRuns.some((r) => r.result === "Running");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [busy, router]);

  const openParking = (() => {
    if (!viewing || !("parkingId" in viewing)) return null;
    const r = parkingRuns.find((p) => p.id === viewing.parkingId);
    const row = rows.find((x) => x.key === `p${viewing.parkingId}`);
    return r && row ? { ...r, net: (r.totals ?? []).reduce((a, t) => a + t.net, 0), status: row.status, summary: row.summary, retryAt: row.retryAt ?? null } : null;
  })();

  const columns = useMemo<Columns<Row>>(
    () => [
      col.accessor("at", {
        header: "When",
        cell: ({ row: { original: r } }) => (
          <>
            <div className="whitespace-nowrap tabular-nums">{fmtDateTime(r.at)}</div>
            <div className="text-xs text-ink-3">{r.triggeredBy}</div>
          </>
        ),
      }),
      col.accessor("automation", { header: "Automation", meta: { filter: "automations" }, cell: (c) => <span className="whitespace-nowrap">{c.getValue()}</span> }),
      col.accessor("companyName", { header: "Company", meta: { filter: "companies" }, cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
      col.accessor("subject", {
        header: "Run for",
        cell: ({ row: { original: r } }) => (
          <>
            <div className="whitespace-nowrap">{r.subject}</div>
            <div className="text-xs text-ink-3">{fmtDate(r.periodDate)}</div>
          </>
        ),
      }),
      col.accessor("status", { header: "Result", meta: { filter: "results" }, cell: (c) => <StatusBadge status={c.getValue()} /> }),
      col.accessor((r) => r.summary, {
        id: "detail",
        header: "Details",
        // Takes the space left over and cuts its text to fit (max-w-0 lets a table cell shrink below its content).
        meta: { className: "w-full max-w-0" },
        cell: ({ row: { original: r } }) => (
          <>
            <div className={`truncate ${r.status === "Failed" ? "text-bad" : r.status === "Created" ? "tabular-nums" : "text-ink-3"}`} title={r.summary}>
              {r.summary}
            </div>
            {r.note && (
              <div className="truncate text-xs text-warn" title={r.note}>
                {r.note}
              </div>
            )}
          </>
        ),
      }),
      col.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: r } }) => <RowActions name={`run for ${r.subject}`} onView={r.open} />,
      }),
    ],
    [],
  );

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        filters={automation ? [{ id: "automation", value: [automation] }] : []}
        search="Search company, customer, setup or NAV document"
        empty={{ title: "No runs yet", hint: "Runs appear here once the scheduler starts creating drafts in NAV." }}
      />
      {viewing && "invoice" in viewing && <InvoiceRunDetails run={viewing.invoice} status={viewing.status} onClose={() => setViewing(null)} />}
      {openParking && <ParkingRunDetails run={openParking} onClose={() => setViewing(null)} />}
    </>
  );
}
