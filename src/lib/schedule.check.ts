// Run: pnpm check
import assert from "node:assert/strict";
import { nextRun } from "./schedule.ts";

const r = { weekday: 0, monthDay: 1, endDate: null };

assert.equal(nextRun({ ...r, frequency: "Daily", startDate: "2026-10-01" }, "2026-10-05"), "2026-10-05");
assert.equal(nextRun({ ...r, frequency: "Daily", startDate: "2026-11-01" }, "2026-10-05"), "2026-11-01", "never before start");
assert.equal(nextRun({ ...r, frequency: "Weekly", weekday: 3, startDate: "2026-10-01" }, "2026-10-05"), "2026-10-08", "Mon 5 Oct -> Thu 8 Oct");
assert.equal(nextRun({ ...r, frequency: "Weekly", weekday: 0, startDate: "2026-10-01" }, "2026-10-05"), "2026-10-05", "same day counts");
assert.equal(nextRun({ ...r, frequency: "Monthly", monthDay: 0, startDate: "2026-01-31" }, "2026-02-01"), "2026-02-28", "last day of Feb");
assert.equal(nextRun({ ...r, frequency: "Monthly", monthDay: 7, startDate: "2026-01-07" }, "2026-10-08"), "2026-11-07");
assert.equal(nextRun({ ...r, frequency: "Quarterly", monthDay: 15, startDate: "2026-01-15" }, "2026-02-01"), "2026-04-15", "anchored on start month");
assert.equal(nextRun({ ...r, frequency: "Yearly", monthDay: 1, startDate: "2026-03-01" }, "2026-03-02"), "2027-03-01");
assert.equal(nextRun({ ...r, frequency: "Monthly", monthDay: 7, startDate: "2026-01-07", endDate: "2026-09-30" }, "2026-10-01"), null, "ended");

console.log("schedule ok");

// nextParkingRetry: daily at 07:00 from 9 Oct 14:00 MY, so the next run is 10 Oct 07:00 and covers 9 Oct (yesterday).
import { nextParkingRetry } from "./cron.ts";
{
  const now = new Date("2026-10-09T06:00:00Z"); // 14:00 Malaysia time
  const base = { status: "Active", schedule: "0 7 * * *", catchUpDays: 0, startDate: "2026-10-01" };
  const at = (d: string, s = base) => nextParkingRetry(d, s, now)?.toISOString() ?? null;
  assert.equal(at("2026-10-09"), "2026-10-09T23:00:00.000Z"); // 10 Oct 07:00 MY
  assert.equal(at("2026-10-08"), null); // older than the make-up days: never retried
  assert.equal(at("2026-10-08", { ...base, catchUpDays: 2 }), "2026-10-09T23:00:00.000Z");
  assert.equal(at("2026-09-30", { ...base, catchUpDays: 31 }), null); // before the first report date
  assert.equal(at("2026-10-09", { ...base, status: "Paused" }), null);
}
console.log("nextParkingRetry ok");
