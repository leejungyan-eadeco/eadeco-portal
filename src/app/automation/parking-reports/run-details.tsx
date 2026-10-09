"use client";

import { useEffect, useState } from "react";
import { ArrowClockwise, CheckCircle, CircleNotch, DownloadSimple, ShieldCheck, ShieldWarning, XCircle } from "@phosphor-icons/react";
import { explain } from "@/lib/nav-errors";
import { myTime } from "../../schedule-editor";
import type { ParkingRun } from "@/lib/types";
import { Dialog } from "../../dialog";
import { runParkingNow, verifyParkingRun } from "../../parking-actions";
import { Badge, btn, fmtDate, fmtDateTime, num, rm, StatusBadge, td, th } from "../../ui";

export type RunRow = ParkingRun & { status: "Processing" | "Created" | "Deleted in NAV" | "Failed" | "Will retry" | "Resolved"; summary: string; net: number };

export const fileUrl = (folder: string, name: string) => `/automation/parking-reports/files/${folder}/${encodeURIComponent(name)}`;

const proof = { ok: "Fingerprint matches", changed: "Changed since the run: this file is not the original", removed: "Removed after 30 days" } as const;

// Status of a failed parking run: "Will retry" while its next automatic attempt is pending (5, 10, 15 minutes after a
// temporary failure), otherwise Failed.
export function parkingFailure(r: ParkingRun, laterCreated: boolean): Pick<RunRow, "status" | "summary" | "retryAt"> {
  const x = explain(r.error ?? "", r.errorCode);
  if (laterCreated) return { status: "Resolved", summary: x.summary, retryAt: null };
  if (r.retryAt && Date.parse(r.retryAt) > Date.now()) return { status: "Will retry", summary: `${x.summary}. Tries again ${myTime(r.retryAt)}`, retryAt: r.retryAt };
  return { status: "Failed", summary: x.summary, retryAt: null };
}

export function RunDetails({ run: r, onClose, onRetried }: { run: RunRow; onClose: () => void; onRetried?: (message: string) => void }) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const retry = async () => {
    setRetrying(true);
    setRetryError("");
    const res = await runParkingNow(r.setupId, r.reportDate);
    setRetrying(false);
    if (!res.ok) return setRetryError(res.error);
    onRetried?.(res.data);
    onClose();
  };
  const x = r.error ? explain(r.error, r.errorCode) : null;
  const processing = r.status === "Processing";
  const [checked, setChecked] = useState<Record<number, keyof typeof proof> | null>(null);
  // Re-check fingerprints when the run finishes (its files are complete then).
  useEffect(() => {
    if (!processing) verifyParkingRun(r.id).then((v) => v.ok && setChecked(v.data));
  }, [r.id, processing]);

  const excel = r.steps.find((s) => s.file?.endsWith(".xlsx"));
  const tampered = checked && Object.values(checked).includes("changed");

  const item = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );

  return (
    <Dialog open wide variant="sheet" onClose={onClose} title={`${r.setupName}: ${fmtDate(r.reportDate)}`}>
      <div className="grid gap-6 text-sm">
        <dl className="grid gap-4 sm:grid-cols-3">
          {item("Result", <StatusBadge status={r.status} />)}
          {item("NAV draft", r.navDocument ? <span className="tabular-nums">{r.navDocument}</span> : <span className="text-ink-3">None</span>)}
          {item("Started by", `${r.triggeredBy}, ${fmtDateTime(r.at)}`)}
        </dl>

        {(r.status === "Failed" || r.status === "Will retry") && (
          <div className="flex flex-wrap items-center gap-3">
            <button className={`${btn.primary} disabled:pointer-events-none disabled:opacity-50`} disabled={retrying} onClick={retry}>
              <ArrowClockwise size={16} className={retrying ? "animate-spin" : ""} /> {retrying ? "Starting" : "Retry now"}
            </button>
            {retryError && <span className="text-sm text-bad">{retryError}</span>}
          </div>
        )}

        {processing && (
          <p className="flex items-center gap-2 rounded-lg bg-info-soft px-3.5 py-3 text-info">
            <CircleNotch size={18} className="shrink-0 animate-spin" /> Processing. Each step appears in the timeline below as it happens; this takes about a minute.
          </p>
        )}
        {tampered && (
          <p className="flex gap-2 rounded-lg bg-bad-soft px-3.5 py-3 text-bad">
            <ShieldWarning size={18} weight="fill" className="mt-px shrink-0" /> A file of this run no longer matches the fingerprint taken when it was written. Tell IT.
          </p>
        )}
        {r.note && <div className="rounded-lg bg-subtle px-4 py-3 text-ink-2">{r.note}</div>}

        {excel && r.folder && checked?.[excel.seq] !== "removed" && (
          <div>
            <a className={btn.secondary} href={fileUrl(r.folder, excel.file!)}>
              <DownloadSimple size={16} /> Excel file
            </a>
          </div>
        )}

        {x && (
          <div className={`grid gap-3 rounded-lg px-4 py-3 ${r.status === "Failed" ? "bg-bad-soft" : "bg-subtle"}`}>
            {r.status === "Resolved" && <p className="text-ink-2">A later run created this day&apos;s draft, so there is nothing to do.</p>}
            <div>
              <p className="text-xs font-medium text-ink-3">What happened</p>
              <p className={r.status === "Failed" ? "text-bad" : "text-ink"}>{x.summary}</p>
            </div>
            {r.status !== "Resolved" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-ink-3">What to do</p>
                  <p className="text-ink">
                    {r.retryAt
                      ? `Nothing to do. It tries again ${myTime(r.retryAt)}; after a temporary failure the portal tries 5, 10 and 15 minutes later.`
                      : x.retry && r.status === "Failed"
                        ? "It was tried again 5, 10 and 15 minutes later without success. Use Retry when the parking portal or NAV is back; tell IT if it keeps failing."
                        : x.action}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-ink-3">Who fixes it</p>
                  <p className="text-ink">{x.owner}</p>
                </div>
              </div>
            )}
            <details className="text-ink-2">
              <summary className="cursor-pointer text-xs font-medium text-ink-3">
                Technical details for IT <Badge className="ml-1 px-1.5 py-px text-[10px]">{x.code}</Badge>
              </summary>
              <p className="mt-2 [overflow-wrap:anywhere] whitespace-pre-wrap text-xs">{r.error}</p>
            </details>
          </div>
        )}

        {r.totals && (() => {
          // The invoice as NAV gets it: one row per line, then the SST line (when the setup adds one), then the total.
          const lines = r.settings?.lines ?? [];
          const sstLine = r.settings?.sstLine ?? null;
          const sst = r.totals.reduce((a, t) => a + t.sst, 0);
          const net = r.totals.reduce((a, t) => a + t.net, 0);
          return (
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full">
                <thead className="bg-subtle">
                  <tr>
                    <th className={th}>Invoice line</th>
                    <th className={th}>G/L account</th>
                    <th className={`${th} text-right`}>Rows</th>
                    <th className={`${th} text-right`}>Amount (RM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.totals.map((t) => (
                    <tr key={t.label}>
                      <td className={td}>{t.label}</td>
                      <td className={`${td} tabular-nums`}>{lines.find((l) => l.label === t.label)?.glAccount ?? "–"}</td>
                      <td className={`${td} ${num}`}>{t.count}</td>
                      <td className={`${td} ${num}`}>{rm(t.net)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className={td}>{sstLine ? sstLine.description || "SST" : <span className="text-ink-3">SST in the report (left to NAV&apos;s VAT)</span>}</td>
                    <td className={`${td} tabular-nums`}>{sstLine?.glAccount ?? "–"}</td>
                    <td className={`${td} ${num}`} />
                    <td className={`${td} ${num} ${sstLine ? "" : "text-ink-3"}`}>{rm(sst)}</td>
                  </tr>
                  <tr className="font-medium">
                    <td className={td} colSpan={2}>
                      Total{r.rowCount != null && <span className="font-normal text-ink-3"> ({r.rowCount.toLocaleString()} rows in the report)</span>}
                    </td>
                    <td className={`${td} ${num}`}>{r.totals.reduce((a, t) => a + t.count, 0)}</td>
                    <td className={`${td} ${num}`}>{rm(sstLine ? net + sst : net)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* Timeline: every step in order, its time on the left, with its screenshot and the file fingerprint check. */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
          <ol>
            {r.steps.map((s, i) => {
              const img = s.file?.endsWith(".jpg") || s.file?.endsWith(".png");
              const state = checked?.[s.seq];
              const last = i === r.steps.length - 1 && !processing;
              return (
                <li key={s.seq} className="grid grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] gap-x-3">
                  <span className="pt-px text-right text-xs text-ink-3 tabular-nums">{s.at}</span>
                  <span className="flex flex-col items-center">
                    <span className={`grid size-5 place-items-center rounded-full bg-surface ${s.ok ? "text-good" : "text-bad"}`}>
                      {s.ok ? <CheckCircle size={20} weight="fill" /> : <XCircle size={20} weight="fill" />}
                    </span>
                    {!last && <span className="w-px flex-1 bg-line" />}
                  </span>
                  <div className={last ? "" : "pb-6"}>
                    <span className="font-medium">{s.step}</span>
                    {s.detail && <p className={`mt-0.5 [overflow-wrap:anywhere] ${s.ok ? "text-ink-2" : "text-bad"}`}>{s.detail}</p>}
                    {s.file && r.folder && (
                      <div className="mt-2">
                        {img && state !== "removed" && (
                          <a href={fileUrl(r.folder, s.file)} target="_blank" rel="noreferrer" className="block w-full max-w-md overflow-hidden rounded-lg border border-line hover:border-line-strong">
                            {/* eslint-disable-next-line @next/next/no-img-element -- private file behind sign-in, not a static asset */}
                            <img src={fileUrl(r.folder, s.file)} alt={`Screenshot: ${s.step}`} loading="lazy" className="aspect-[16/10] w-full bg-subtle object-cover object-top" />
                          </a>
                        )}
                        <p className={`mt-1 flex items-center gap-1 text-xs ${state === "changed" ? "text-bad" : "text-ink-3"}`} title={s.sha256 ? `SHA-256 ${s.sha256}` : undefined}>
                          {state === "changed" ? <ShieldWarning size={14} /> : <ShieldCheck size={14} />}
                          {s.file} · {state ? proof[state] : processing ? "Checked when the run finishes" : "Checking"}
                        </p>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
            {processing && (
              <li className="grid grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] gap-x-3">
                <span />
                <span className="flex justify-center text-info">
                  <CircleNotch size={20} className="animate-spin" />
                </span>
                <span className="text-ink-3">Working on the next step</span>
              </li>
            )}
            {r.steps.length === 0 && !processing && <li className="text-ink-3">No steps were recorded for this run.</li>}
          </ol>
        </div>

      </div>
    </Dialog>
  );
}
