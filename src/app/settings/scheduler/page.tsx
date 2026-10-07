import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "@/lib/db";
import { todayMY } from "@/lib/schedule";
import { jobs, jobSettings, scheduleName } from "@/lib/scheduler";
import { SchedulerView } from "./view";

export const dynamic = "force-dynamic";

export default async function SchedulerSettings() {
  const settings = await jobSettings();
  // DBOS owns the live schedules; if it did not start, say so instead of failing the page.
  const live = await Promise.all(
    settings.map((s) =>
      DBOS.getSchedule(scheduleName(s.key)).then(
        (l) => (l ? { status: l.status, lastFiredAt: l.lastFiredAt } : { error: "The schedule has not been created yet." }),
        (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
      ),
    ),
  );
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from recurring_invoices i join companies c on c.code = i.company_code where i.status = 'Active' and c.active and i.next_date <= $1`,
    [todayMY()],
  );
  return (
    <SchedulerView
      jobs={jobs.map((j, i) => ({ ...j, settings: settings[i], live: live[i], due: j.key === "recurring-invoices" ? `${rows[0].n} recurring invoice${rows[0].n === 1 ? "" : "s"} due today or earlier` : "" }))}
    />
  );
}
