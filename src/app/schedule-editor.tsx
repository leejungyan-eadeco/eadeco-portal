"use client";

import { useEffect, useState } from "react";
import { cronError, describeCron, fromCron, nextRuns, TIMEZONE, toCron, type When } from "@/lib/cron";
import { MultiSelect, SearchSelect } from "./select";
import { Field, field, fmtDateTime } from "./ui";

// A Date or ISO string -> Malaysia time in the portal's date format.
export const myTime = (d: Date | string) => fmtDateTime(new Date(d).toLocaleString("sv-SE", { timeZone: TIMEZONE }).replace(" ", "T"));

// Minutes and hours are separate choices; underneath both are the "interval" kind of When.
type Mode = "minutes" | "hours" | "daily" | "weekly" | "monthly" | "cron";
const modes = [
  { value: "minutes", label: "Every few minutes" },
  { value: "hours", label: "Every few hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "cron", label: "Custom (cron)" },
];
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((label, i) => ({ value: String((i + 1) % 7), label }));
const monthDays = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` }));

// The "When" fields and a plain-words check of the result. Reports the cron (5 fields, Malaysia time) and
// what is wrong with it, if anything, whenever either changes.
export function ScheduleEditor({ initial, onChange }: { initial: string; onChange: (schedule: string, problem: string) => void }) {
  // Every choice keeps its own values, so switching back and forth loses nothing.
  const saved = fromCron(initial);
  const [mode, setMode] = useState<Mode>(saved.mode === "interval" ? saved.unit : saved.mode);
  const [minutes, setMinutes] = useState(saved.mode === "interval" && saved.unit === "minutes" ? saved.every : 30);
  const [hours, setHours] = useState(saved.mode === "interval" && saved.unit === "hours" ? saved.every : 3);
  const [time, setTime] = useState("time" in saved ? saved.time : "07:00");
  const [days, setDays] = useState<string[]>(saved.mode === "weekly" ? saved.days.map(String) : ["1", "2", "3", "4", "5"]);
  const [day, setDay] = useState(saved.mode === "monthly" ? saved.day : 1);
  const [cron, setCron] = useState(initial);

  const when: When =
    mode === "minutes" || mode === "hours"
      ? { mode: "interval", every: mode === "minutes" ? minutes : hours, unit: mode }
      : mode === "daily"
        ? { mode, time }
        : mode === "weekly"
          ? { mode, days: days.map(Number), time }
          : mode === "monthly"
            ? { mode, day, time }
            : { mode, cron };
  const schedule = toCron(when);
  const problem =
    mode === "minutes" && !(minutes >= 1 && minutes <= 59)
      ? "Every 1 to 59 minutes."
      : mode === "hours" && !(hours >= 1 && hours <= 23)
        ? "Every 1 to 23 hours."
        : mode === "weekly" && days.length === 0
          ? "Pick at least one day."
          : cronError(schedule);

  useEffect(() => onChange(schedule, problem), [schedule, problem]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Every field shares the row equally (flex-1), so it is always filled whatever the choice. */}
      <div className="flex flex-col gap-4 sm:flex-row [&>*]:min-w-0 [&>*]:flex-1">
        <Field as="div" label="When" required>
          <SearchSelect
            label="When"
            value={mode}
            options={modes}
            onChange={(v) => {
              // Custom starts from whatever the current choice means, so it is easy to tweak.
              if (v === "cron" && mode !== "cron" && !problem) setCron(schedule);
              setMode(v as Mode);
            }}
          />
        </Field>
        {mode === "minutes" && (
          <Field label="Every (minutes)" required hint="1 to 59">
            <input type="number" className={field} min={1} max={59} value={minutes} onChange={(e) => setMinutes(Math.trunc(Number(e.target.value) || 0))} />
          </Field>
        )}
        {mode === "hours" && (
          <Field label="Every (hours)" required hint="1 to 23, on the hour">
            <input type="number" className={field} min={1} max={23} value={hours} onChange={(e) => setHours(Math.trunc(Number(e.target.value) || 0))} />
          </Field>
        )}
        {mode === "weekly" && (
          <Field as="div" label="On" required>
            <MultiSelect label="Days" noun="days" value={days} options={weekdays} onChange={setDays} />
          </Field>
        )}
        {mode === "monthly" && (
          <Field as="div" label="On" required hint="Up to day 28, so every month has it">
            <SearchSelect label="Day of the month" value={String(day)} options={monthDays} onChange={(v) => setDay(Number(v))} />
          </Field>
        )}
        {(mode === "daily" || mode === "weekly" || mode === "monthly") && (
          <Field label="At" required hint="Malaysia time">
            <input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} required />
          </Field>
        )}
        {mode === "cron" && (
          <div className="sm:!flex-[2]">
            <Field label="Cron" required hint="minute hour day month weekday, e.g. 0 7 * * 1-5 = weekdays at 07:00">
              <input className={`${field} tabular-nums`} value={cron} onChange={(e) => setCron(e.target.value)} spellCheck={false} autoCapitalize="none" required />
            </Field>
          </div>
        )}
      </div>

      <div className={`rounded-lg px-4 py-3 text-sm ${problem ? "bg-bad-soft text-bad" : "bg-subtle text-ink-2"}`}>
        {problem ? (
          problem
        ) : (
          <>
            <p className="font-medium text-ink">{describeCron(schedule)}, Malaysia time</p>
            <p className="mt-1 text-xs">Next: {nextRuns(schedule, 3).map(myTime).join(" · ")}</p>
          </>
        )}
      </div>
    </>
  );
}
