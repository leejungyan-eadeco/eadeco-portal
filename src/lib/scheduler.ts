// Scheduled jobs: each is a DBOS workflow on its own cron schedule (Settings > Scheduler).
// DBOS keeps the schedules and each run's progress in Postgres (schema "dbos"), so a restart mid-run
// carries on where it stopped, and a run missed while the portal was off is made up when it starts again.
import { DBOS } from "@dbos-inc/dbos-sdk";
import { dbosCron, TIMEZONE } from "./cron";
import { db } from "./db";
import { runInvoice } from "./runs";
import { nextRun } from "./schedule";

// The jobs the portal can run. Parking reports join this list when they are built.
export const jobs = [{ key: "recurring-invoices", label: "Recurring invoice drafts", description: "Creates each due recurring invoice in NAV as a draft. Nothing is posted." }] as const;
export type JobKey = (typeof jobs)[number]["key"];
export const isJobKey = (k: string): k is JobKey => jobs.some((j) => j.key === k);

export type JobSettings = { key: JobKey; enabled: boolean; schedule: string; catchUpDays: number };

export const scheduleName = (key: JobKey) => `job:${key}`;

export async function jobSettings(): Promise<JobSettings[]> {
  const { rows } = await db.query(`select key, enabled, schedule, catch_up_days as "catchUpDays" from scheduled_jobs`);
  return jobs.map((j) => rows.find((r) => r.key === j.key) ?? { key: j.key, enabled: true, schedule: "0 7 * * *", catchUpDays: 7 });
}

const myDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
const minusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

type Counts = { created: number; failed: number; skipped: number };

// ---------- Job: recurring invoice drafts ----------

// Every date this invoice is due on, oldest first, up to today. Stops at the first failure so the
// same date is tried again on the next run instead of being lost.
async function catchUp(invoiceId: number, today: string, oldest: string): Promise<Counts> {
  const out = { created: 0, failed: 0, skipped: 0 };
  for (let guard = 0; guard < 400; guard++) {
    const { rows } = await db.query(
      `select to_char(next_date, 'YYYY-MM-DD') as "nextDate", created_by as "createdBy", frequency, weekday, month_day as "monthDay",
              to_char(start_date, 'YYYY-MM-DD') as "startDate", to_char(end_date, 'YYYY-MM-DD') as "endDate"
       from recurring_invoices where id = $1 and status = 'Active'`,
      [invoiceId],
    );
    const inv = rows[0];
    if (!inv?.nextDate || inv.nextDate > today) break;
    if (inv.nextDate < oldest) {
      // Older than the make-up window: jump ahead without creating drafts.
      await db.query(`update recurring_invoices set next_date = $2, status = case when $2::date is null then 'Ended' else status end, updated_at = now() where id = $1`, [
        invoiceId,
        nextRun(inv, oldest),
      ]);
      out.skipped++;
      continue;
    }
    const r = await runInvoice(invoiceId, inv.nextDate, inv.createdBy ?? "", "Scheduler", true).catch(() => null); // e.g. a Run now in progress
    if (!r || r.result === "Failed") {
      out.failed++;
      break;
    }
    if (!r.existing) out.created++;
  }
  return out;
}

// One run: every active invoice of an active company that is due today or earlier.
async function recurringInvoices(scheduledFor: Date): Promise<void> {
  const today = myDate(scheduledFor);
  const catchUpDays = await DBOS.runStep(async () => (await jobSettings()).find((j) => j.key === "recurring-invoices")!.catchUpDays, { name: "settings" });
  const oldest = minusDays(today, catchUpDays);
  const due = await DBOS.runStep(
    async () =>
      (
        await db.query<{ id: number }>(
          // Skipped: invoices whose last attempt NAV refused for their data (INVOICE_DATA) and that nobody
          // has edited since. Trying the same data again cannot work; saving the invoice lets it run again.
          `select i.id from recurring_invoices i join companies c on c.code = i.company_code
           where i.status = 'Active' and c.active and i.next_date <= $1
             and not exists (
               select 1 from invoice_runs r
               where r.invoice_id = i.id and r.result = 'Failed' and r.error_code = 'INVOICE_DATA' and r.ran_at > i.updated_at
                 and r.id = (select max(id) from invoice_runs where invoice_id = i.id))
           order by i.next_date, i.id`,
          [today],
        )
      ).rows.map((r) => r.id),
    { name: "find-due" },
  );
  const total = { created: 0, failed: 0, skipped: 0 };
  // One step per invoice: after a crash DBOS skips the invoices already done. runInvoice never makes a
  // second draft for the same date, so redoing the interrupted one is safe.
  for (const id of due) {
    const r = await DBOS.runStep(() => catchUp(id, today, oldest), { name: `invoice-${id}` });
    total.created += r.created;
    total.failed += r.failed;
    total.skipped += r.skipped;
  }
  DBOS.logger.info(`Recurring invoices for ${today}: ${total.created} created, ${total.failed} failed, ${total.skipped} skipped (${due.length} due).`);
}

const workflows: Record<JobKey, (scheduledFor: Date) => Promise<void>> = { "recurring-invoices": recurringInvoices };

// ---------- Start-up ----------

// Called once from instrumentation.ts when the server starts: one DBOS schedule per job, and any
// schedule DBOS still has from an older version (e.g. a renamed job) is removed.
export async function startScheduler() {
  const g = globalThis as unknown as { __dbosStarted?: boolean };
  if (g.__dbosStarted) return;
  g.__dbosStarted = true;

  DBOS.setConfig({ name: "eadepro-portal", systemDatabaseUrl: process.env.DATABASE_URL });
  const registered = Object.fromEntries(jobs.map((j) => [j.key, DBOS.registerWorkflow(workflows[j.key], { name: `job-${j.key}` })]));
  await DBOS.launch();

  const settings = await jobSettings();
  await DBOS.applySchedules(
    settings.map((s) => ({ scheduleName: scheduleName(s.key), workflowFn: registered[s.key], schedule: dbosCron(s.schedule), cronTimezone: TIMEZONE, automaticBackfill: true })),
  );
  for (const s of settings) await (s.enabled ? DBOS.resumeSchedule(scheduleName(s.key)) : DBOS.pauseSchedule(scheduleName(s.key)));
  const wanted = new Set(settings.map((s) => scheduleName(s.key)));
  for (const old of await DBOS.listSchedules()) if (!wanted.has(old.scheduleName)) await DBOS.deleteSchedule(old.scheduleName);
}
