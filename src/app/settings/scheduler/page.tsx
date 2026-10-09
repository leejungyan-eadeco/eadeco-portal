import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "@/lib/db";
import { todayMY } from "@/lib/schedule";
import { jobs, jobSettings, parkingScheduleName, scheduleName } from "@/lib/scheduler";
import { SchedulerView } from "./view";

export const dynamic = "force-dynamic";

export default async function SchedulerSettings() {
  const settings = await jobSettings();
  // DBOS owns the live schedules; if it did not start, say so instead of failing the page.
  const liveOf = (name: string) =>
    DBOS.getSchedule(name).then(
      (l) => (l ? { status: l.status, lastFiredAt: l.lastFiredAt } : { error: "The schedule has not been created yet." }),
      (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
    );
  const live = await Promise.all(settings.map((s) => liveOf(scheduleName(s.key))));
  const { rows: setups } = await db.query<{ id: number; name: string; schedule: string; status: string; catchUpDays: number }>(
    `select id, name, schedule, status, catch_up_days as "catchUpDays" from parking_setups order by name`,
  );
  const parking = await Promise.all(
    setups.map(async (p) => ({ id: p.id, name: p.name, settings: { enabled: p.status === "Active", schedule: p.schedule, catchUpDays: p.catchUpDays }, live: await liveOf(parkingScheduleName(p.id)) })),
  );
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from recurring_invoices i join companies c on c.code = i.company_code where i.status = 'Active' and c.active and i.next_date <= $1`,
    [todayMY()],
  );
  return (
    <SchedulerView
      parking={parking}
      jobs={jobs.map((j, i) => ({ ...j, settings: settings[i], live: live[i], due: j.key === "recurring-invoices" ? `${rows[0].n} recurring invoice${rows[0].n === 1 ? "" : "s"} due today or earlier` : "" }))}
    />
  );
}
