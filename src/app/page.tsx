import Link from "next/link";
import { ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react/ssr";
import { explain } from "@/lib/nav-errors";
import { todayMY } from "@/lib/schedule";
import { listCompanies, listInvoices, listRuns } from "@/lib/store";
import { invoiceTotal } from "@/lib/types";
import { daysFromToday, fmtDate, num, PageHeader, panel, relativeDay, rm, td, th } from "./ui";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const [companies, invoices, runs] = await Promise.all([listCompanies(), listInvoices(), listRuns(50)]);
  const upcoming = invoices
    .filter((i) => i.status === "Active" && i.nextDate && daysFromToday(i.nextDate) <= 14)
    .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!));
  const dueThisWeek = upcoming.filter((i) => daysFromToday(i.nextDate!) <= 7);
  // Only problems a person must deal with: failures not yet resolved by a later run, and either needing a fix
  // (sign-in, invoice data…) or a NAV outage still failing after 3 attempts. Short hiccups stay out of sight.
  // Runs are newest first, so the first failure seen per invoice and date is the latest one.
  const key = (r: { invoiceId: number; periodDate: string }) => `${r.invoiceId}|${r.periodDate}`;
  const created = new Set(runs.filter((r) => r.result === "Created").map(key));
  const attempts = new Map<string, number>();
  for (const r of runs) if (r.result === "Failed") attempts.set(key(r), (attempts.get(key(r)) ?? 0) + 1);
  const seen = new Set<string>();
  const failed = runs
    .filter((r) => {
      if (r.result !== "Failed" || created.has(key(r)) || seen.has(key(r))) return false;
      seen.add(key(r));
      return !explain(r.error ?? "", r.errorCode).retry || (attempts.get(key(r)) ?? 0) >= 3;
    })
    .map((r) => ({ ...r, summary: explain(r.error ?? "", r.errorCode).summary }));
  const active = invoices.filter((i) => i.status === "Active").length;
  const paused = invoices.filter((i) => i.status === "Paused").length;
  const today = new Date(`${todayMY()}T00:00:00Z`).toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  const stats = [
    { label: "Invoices due in 7 days", value: dueThisWeek.length, note: `RM ${rm(dueThisWeek.reduce((t, i) => t + invoiceTotal(i), 0))} in total` },
    { label: "Failed runs", value: failed.length, note: failed.length ? "Not yet created in NAV" : "None", alert: failed.length > 0 },
    { label: "Active recurring invoices", value: active, note: `${paused} paused` },
    { label: "Companies set up", value: companies.filter((c) => c.active).length, note: `${companies.length} in total, set by IT` },
  ];

  return (
    <>
      <PageHeader guide="overview" title="Overview" description={`${today}. What needs attention, and what runs next.`} />

      <div data-tour="stats" className={`${panel} mb-8 grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x`}>
        {stats.map((s) => (
          <div key={s.label} className="px-5 py-4">
            <p className="text-sm text-ink-2">{s.label}</p>
            <p className={`mt-1 text-3xl font-semibold tracking-tight tabular-nums ${s.alert ? "text-bad" : "text-ink"}`}>{s.value}</p>
            <p className="mt-1 text-xs text-ink-3">{s.note}</p>
          </div>
        ))}
      </div>

      {/* Two equal panels, stretched to the same height. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section data-tour="upcoming" className={panel}>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-semibold">Coming up in the next 14 days</h2>
            <Link href="/automation/recurring-invoices" className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
              All invoices <ArrowRight size={14} />
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-ink-2">
              {invoices.length === 0 ? (
                <>
                  No recurring invoices yet.{" "}
                  <Link href="/automation/recurring-invoices" className="font-medium text-accent-ink hover:underline">
                    Create the first one
                  </Link>
                  .
                </>
              ) : (
                "Nothing is due in the next 14 days."
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-subtle">
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Company</th>
                    <th className={th}>Customer / vendor</th>
                    <th className={`${th} text-right`}>Amount excl. VAT (RM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {upcoming.map((i) => (
                    <tr key={i.id}>
                      <td className={`${td} whitespace-nowrap`}>
                        <div className="font-medium">{relativeDay(i.nextDate!)}</div>
                        <div className="text-xs text-ink-3">{fmtDate(i.nextDate!)}</div>
                      </td>
                      <td className={td}>{i.companyName}</td>
                      <td className={td}>
                        <div>{i.partyName}</div>
                        <div className="text-xs text-ink-3">{i.type} invoice, draft in NAV</div>
                      </td>
                      <td className={`${td} ${num}`}>{rm(invoiceTotal(i))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section data-tour="attention" className={panel}>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-semibold">Needs attention</h2>
            <Link href="/runs" className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
              Run history <ArrowRight size={14} />
            </Link>
          </div>
          {failed.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-6 text-sm text-ink-2">
              <CheckCircle size={20} weight="fill" className="text-good" /> Nothing has failed.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {failed.map((r) => (
                <li key={r.id} className="flex gap-3 px-5 py-3">
                  <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-bad" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {r.partyName}, {fmtDate(r.periodDate)}
                    </p>
                    <p className="truncate text-xs text-ink-3" title={r.summary}>
                      {r.companyName} · {r.summary}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
