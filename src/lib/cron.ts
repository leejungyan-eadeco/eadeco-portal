// Cron helpers shared by the Scheduler page (live preview) and the server (validation).
// Standard 5-field cron: minute hour day-of-month month day-of-week, in Malaysia time.
import { CronExpressionParser } from "cron-parser";
import cronstrue from "cronstrue";

export const TIMEZONE = "Asia/Kuala_Lumpur";

// Why the expression is not usable, or "" when it is.
export function cronError(expr: string): string {
  if (expr.trim().split(/\s+/).length !== 5) return "Use 5 parts: minute hour day month weekday, e.g. 0 7 * * 1-5";
  try {
    CronExpressionParser.parse(expr, { tz: TIMEZONE });
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export const describeCron = (expr: string) => (cronError(expr) ? "" : cronstrue.toString(expr, { use24HourTimeFormat: true }));

export function nextRuns(expr: string, count = 3, from = new Date()): Date[] {
  if (cronError(expr)) return [];
  const it = CronExpressionParser.parse(expr, { tz: TIMEZONE, currentDate: from });
  return Array.from({ length: count }, () => it.next().toDate());
}

// The "When" choices on the Scheduler page. Each is just a cron underneath, so DBOS only ever sees cron.
export type When =
  | { mode: "interval"; every: number; unit: "minutes" | "hours" }
  | { mode: "daily"; time: string }
  | { mode: "weekly"; days: number[]; time: string } // 0 = Sunday, like cron
  | { mode: "monthly"; day: number; time: string } // 1-28, so every month has it
  | { mode: "cron"; cron: string };

const hm = (time: string) => time.split(":").map(Number) as [number, number];
const hhmm = (h: string, m: string) => `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;

export function toCron(w: When): string {
  if (w.mode === "cron") return w.cron.trim().replace(/\s+/g, " ");
  if (w.mode === "interval") return w.unit === "minutes" ? `*/${w.every} * * * *` : `0 */${w.every} * * *`;
  const [h, m] = hm(w.time);
  if (w.mode === "daily") return `${m} ${h} * * *`;
  if (w.mode === "weekly") return `${m} ${h} * * ${[...w.days].sort().join(",") || "*"}`;
  return `${m} ${h} ${w.day} * *`;
}

// Reads a saved cron back into the simplest choice that produces it; anything else stays Custom.
export function fromCron(expr: string): When {
  const c = expr.trim().replace(/\s+/g, " ");
  let x: RegExpExecArray | null;
  if ((x = /^\*\/(\d+) \* \* \* \*$/.exec(c))) return { mode: "interval", every: +x[1], unit: "minutes" };
  if ((x = /^0 \*\/(\d+) \* \* \*$/.exec(c))) return { mode: "interval", every: +x[1], unit: "hours" };
  if ((x = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(c))) return { mode: "daily", time: hhmm(x[2], x[1]) };
  if ((x = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6](,[0-6])*)$/.exec(c))) return { mode: "weekly", days: x[3].split(",").map(Number), time: hhmm(x[2], x[1]) };
  if ((x = /^(\d{1,2}) (\d{1,2}) ([1-9]|1\d|2[0-8]) \* \*$/.exec(c))) return { mode: "monthly", day: +x[3], time: hhmm(x[2], x[1]) };
  return { mode: "cron", cron: c };
}

// DBOS cron has a seconds field in front.
export const dbosCron = (expr: string) => `0 ${expr.trim()}`;
