"use client";

import { useState, useTransition } from "react";
import { Car, Play } from "@phosphor-icons/react";
import { cronError, describeCron, fromCron, nextRuns, TIMEZONE, toCron, type When } from "@/lib/cron";
import type { JobSettings } from "@/lib/scheduler";
import { runJobNow, saveJob } from "../../actions";
import { Confirm, ErrorNote } from "../../dialog";
import { MultiSelect, SearchSelect } from "../../select";
import { Badge, btn, Field, field, fmtDateTime, PageHeader, panel, Toggle } from "../../ui";

type Live = { status: string; lastFiredAt: string | null } | { error: string };
type Job = { key: string; label: string; description: string; due: string; settings: JobSettings; live: Live };

// A Date or ISO string -> Malaysia time in the portal's date format.
const myTime = (d: Date | string) => fmtDateTime(new Date(d).toLocaleString("sv-SE", { timeZone: TIMEZONE }).replace(" ", "T"));

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

function JobCard({ job }: { job: Job }) {
  const s = job.settings;
  const [enabled, setEnabled] = useState(s.enabled);
  // Every choice keeps its own values, so switching back and forth loses nothing.
  const saved = fromCron(s.schedule);
  const [mode, setMode] = useState<Mode>(saved.mode === "interval" ? saved.unit : saved.mode);
  const [minutes, setMinutes] = useState(saved.mode === "interval" && saved.unit === "minutes" ? saved.every : 30);
  const [hours, setHours] = useState(saved.mode === "interval" && saved.unit === "hours" ? saved.every : 3);
  const [time, setTime] = useState("time" in saved ? saved.time : "07:00");
  const [days, setDays] = useState<string[]>(saved.mode === "weekly" ? saved.days.map(String) : ["1", "2", "3", "4", "5"]);
  const [day, setDay] = useState(saved.mode === "monthly" ? saved.day : 1);
  const [cron, setCron] = useState(s.schedule);
  const [catchUpDays, setCatchUpDays] = useState(s.catchUpDays);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, start] = useTransition();

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
  const dirty = enabled !== s.enabled || schedule !== s.schedule || catchUpDays !== s.catchUpDays;
  const down = "error" in job.live;

  const save = () =>
    start(async () => {
      setError("");
      setNotice("");
      const r = await saveJob(job.key, { enabled, schedule, catchUpDays });
      if (r.ok) setNotice(enabled ? `Saved. Runs ${describeCron(schedule).replace(/^At/, "at")}, Malaysia time.` : "Saved. This job is off; nothing runs on its own.");
      else setError(r.error);
    });

  return (
    <section className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-semibold">{job.label}</h2>
          <p className="mt-0.5 text-sm text-ink-2">{job.description}</p>
        </div>
        <button className={`${btn.secondary} disabled:pointer-events-none disabled:opacity-50`} disabled={down} onClick={() => setRunning(true)}>
          <Play size={16} /> Run now
        </button>
      </div>

      <dl className="grid grid-cols-1 divide-y divide-line border-b border-line md:grid-cols-4 md:divide-x md:divide-y-0">
        <div className="px-5 py-3">
          <dt className="text-xs text-ink-3">Status</dt>
          <dd className="mt-1">{down ? <Badge tone="bad">Not running</Badge> : (job.live as { status: string }).status === "ACTIVE" ? <Badge tone="good">On</Badge> : <Badge tone="warn">Off</Badge>}</dd>
        </div>
        <div className="px-5 py-3">
          <dt className="text-xs text-ink-3">Last run</dt>
          <dd className="mt-1 text-sm">{"lastFiredAt" in job.live && job.live.lastFiredAt ? myTime(job.live.lastFiredAt) : <span className="text-ink-3">Not yet</span>}</dd>
        </div>
        <div className="px-5 py-3">
          <dt className="text-xs text-ink-3">Next run</dt>
          <dd className="mt-1 text-sm">{s.enabled && !down ? myTime(nextRuns(s.schedule, 1)[0]) : <span className="text-ink-3">None</span>}</dd>
        </div>
        <div className="px-5 py-3">
          <dt className="text-xs text-ink-3">Due now</dt>
          <dd className="mt-1 text-sm">{job.due || <span className="text-ink-3">None</span>}</dd>
        </div>
      </dl>

      {down && (
        <div className="border-b border-line p-4">
          <ErrorNote>The scheduler did not start: {(job.live as { error: string }).error} Restart the portal; if it keeps happening, check the server log.</ErrorNote>
        </div>
      )}

      <form className="grid gap-6 p-5" onSubmit={(e) => (e.preventDefault(), save())}>
        {error && <ErrorNote>{error}</ErrorNote>}
        {notice && !dirty && <p className="rounded-lg bg-good-soft px-3.5 py-3 text-sm text-good">{notice}</p>}
        <div className="flex items-center gap-3 text-sm">
          <Toggle checked={enabled} onChange={setEnabled} label={`${job.label} on`} />
          {enabled ? "On: runs on the schedule below" : "Off: nothing runs on its own"}
        </div>

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

        <Field
          label="Create missed drafts (days back)"
          hint="If the portal was switched off at run time, it makes the drafts it missed when it is back on, going back at most this many days. 0 = don't make missed drafts."
        >
          <input
            type="number"
            className={field}
            min={0}
            max={31}
            value={catchUpDays}
            onChange={(e) => setCatchUpDays(Math.max(0, Math.min(31, Math.trunc(Number(e.target.value) || 0))))}
          />
        </Field>

        <div>
          <button type="submit" className={`${btn.primary} disabled:pointer-events-none disabled:opacity-50`} disabled={!dirty || !!problem || saving}>
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </form>

      {running && (
        <Confirm
          title={`Run "${job.label}" now?`}
          action="Run now"
          tone="primary"
          onClose={() => setRunning(false)}
          onConfirm={async () => {
            const r = await runJobNow(job.key);
            if (r.ok) setNotice("Started. Each draft appears in Run history as it is created.");
            return r;
          }}
        >
          <p>Does the same as a scheduled run, straight away{job.due ? ` (${job.due})` : ""}. Nothing is posted, and a date that already has a draft is skipped.</p>
        </Confirm>
      )}
    </section>
  );
}

export function SchedulerView({ jobs }: { jobs: Job[] }) {
  return (
    <>
      <PageHeader title="Scheduler" description="Jobs the portal runs on its own. Each has its own schedule, in Malaysia time." />
      <div className="grid gap-6">
        {jobs.map((j) => (
          <JobCard key={j.key} job={j} />
        ))}
        {/* Room for the next job, so it is clear where it will go. */}
        <section className={`${panel} flex items-center gap-3 px-5 py-4 text-ink-3`}>
          <Car size={20} />
          <div className="flex-1">
            <p className="font-medium">Parking reports</p>
            <p className="text-sm">Gets its own schedule here once it is built.</p>
          </div>
          <Badge>Soon</Badge>
        </section>
      </div>
    </>
  );
}
