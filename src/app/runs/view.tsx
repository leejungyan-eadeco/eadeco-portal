"use client";

import { useMemo, useState } from "react";
import { explain } from "@/lib/nav-errors";
import type { Run } from "@/lib/types";
import { columnHelper, DataTable, RowActions, type Columns } from "../data-table";
import { Dialog } from "../dialog";
import { Badge, fmtDate, fmtDateTime, StatusBadge } from "../ui";

// A log: read only. Rows stay one line; View shows the whole message.
// A failed run is shown as Failed only when a person has to act. A NAV hiccup the portal retries on its own
// shows Will retry, and once a later run created that draft, the old attempt shows Resolved.
type Row = Run & { status: "Created" | "Failed" | "Will retry" | "Resolved"; summary: string };

const col = columnHelper<Row>();

function RunDetails({ run: r, onClose }: { run: Row; onClose: () => void }) {
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
          {item("Result", <StatusBadge status={r.status} />)}
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
          <div className={`grid gap-3 rounded-lg px-4 py-3 ${r.status === "Failed" ? "bg-bad-soft" : "bg-subtle"}`}>
            {r.status === "Resolved" && <p className="text-ink-2">A later run created this draft, so there is nothing to do.</p>}
            <div>
              <p className="text-xs font-medium text-ink-3">What happened</p>
              <p className={r.status === "Failed" ? "text-bad" : "text-ink"}>{x.summary}</p>
            </div>
            {r.status !== "Resolved" && (
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

export function RunsTable({ runs }: { runs: Run[] }) {
  const [viewing, setViewing] = useState<Row | null>(null);

  const rows = useMemo<Row[]>(() => {
    const created = new Set(runs.filter((r) => r.result === "Created").map((r) => `${r.invoiceId}|${r.periodDate}`));
    return runs.map((r) => {
      if (r.result === "Created") return { ...r, status: "Created", summary: r.navDocument ?? "" };
      const x = explain(r.error ?? "", r.errorCode);
      const status = created.has(`${r.invoiceId}|${r.periodDate}`) ? "Resolved" : x.retry ? "Will retry" : "Failed";
      return { ...r, status, summary: x.summary };
    });
  }, [runs]);

  const columns = useMemo<Columns<Row>>(
    () => [
      col.accessor("at", {
        header: "When",
        cell: ({ row: { original: r } }) => (
          <>
            <div className="whitespace-nowrap tabular-nums">{fmtDateTime(r.at)}</div>
            {r.triggeredBy && <div className="text-xs text-ink-3">{r.triggeredBy}</div>}
          </>
        ),
      }),
      col.accessor("companyName", { header: "Company", meta: { filter: "companies" }, cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
      col.accessor("partyName", {
        header: "Customer / vendor",
        cell: ({ row: { original: r } }) => (
          <>
            <div className="whitespace-nowrap">{r.partyName}</div>
            <div className="text-xs text-ink-3">For {fmtDate(r.periodDate)}</div>
          </>
        ),
      }),
      col.accessor("status", { header: "Result", meta: { filter: "results" }, cell: (c) => <StatusBadge status={c.getValue()} /> }),
      col.accessor((r) => `${r.summary} ${r.navDocument ?? ""}`, {
        id: "detail",
        header: "Details",
        // Takes the space left over and cuts its text to fit (max-w-0 lets a table cell shrink below its content).
        meta: { className: "w-full max-w-0" },
        cell: ({ row: { original: r } }) =>
          r.status === "Created" ? (
            <>
              <div className="tabular-nums">{r.navDocument}</div>
              {r.note && (
                <div className="truncate text-xs text-warn" title={r.note}>
                  {r.note}
                </div>
              )}
            </>
          ) : (
            <div className={`truncate ${r.status === "Failed" ? "text-bad" : "text-ink-3"}`} title={r.summary}>
              {r.summary}
            </div>
          ),
      }),
      col.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: r } }) => <RowActions name={`run for ${r.partyName}`} onView={() => setViewing(r)} />,
      }),
    ],
    [],
  );

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        search="Search company, customer, vendor or NAV document"
        empty={{ title: "No runs yet", hint: "Runs appear here once the scheduler starts creating drafts in NAV." }}
      />
      {viewing && <RunDetails run={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
