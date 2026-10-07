import type { Frequency } from "./types";

// Dates are plain YYYY-MM-DD strings in Malaysia time; arithmetic is done in UTC so nothing shifts.
export type Rule = { frequency: Frequency; weekday: number; monthDay: number; startDate: string; endDate: string | null };

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const todayMY = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

// First run date on or after `onOrAfter` (never before the start date), or null once past the end date.
export function nextRun(r: Rule, onOrAfter: string): string | null {
  const from = onOrAfter > r.startDate ? onOrAfter : r.startDate;
  let out: string;

  if (r.frequency === "Daily") {
    out = from;
  } else if (r.frequency === "Weekly") {
    const d = toDate(from);
    const wd = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() + ((r.weekday - wd + 7) % 7));
    out = iso(d);
  } else {
    // Monthly / quarterly / yearly cycles are anchored on the start month.
    const step = { Monthly: 1, Quarterly: 3, Yearly: 12 }[r.frequency];
    const s = toDate(r.startDate);
    for (let k = 0; ; k += step) {
      const y = s.getUTCFullYear();
      const m = s.getUTCMonth() + k;
      const day = r.monthDay === 0 ? new Date(Date.UTC(y, m + 1, 0)).getUTCDate() : r.monthDay;
      out = iso(new Date(Date.UTC(y, m, day)));
      if (out >= from) break;
    }
  }
  return r.endDate && out > r.endDate ? null : out;
}
