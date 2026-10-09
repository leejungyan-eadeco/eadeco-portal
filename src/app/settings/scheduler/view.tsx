"use client";

import { useState, useTransition } from "react";
import { Play } from "@phosphor-icons/react";
import { describeCron, nextRuns } from "@/lib/cron";
import type { JobSettings } from "@/lib/scheduler";
import { runJobNow, saveJob, type Result } from "../../actions";
import { runParkingScheduleNow, saveParkingSchedule } from "../../parking-actions";
import { Confirm, ErrorNote } from "../../dialog";
import { myTime, ScheduleEditor } from "../../schedule-editor";
import { Badge, btn, Field, field, PageHeader, panel, Toggle } from "../../ui";

type Live = { status: string; lastFiredAt: string | null } | { error: string };
type Settings = Omit<JobSettings, "key">;
type Job = { key: string; label: string; description: string; due: string; settings: JobSettings; live: Live };
export type ParkingSchedule = { id: number; name: string; settings: Settings; live: Live };

// One scheduled job: on/off, when it runs, how far back it makes up missed runs, and Run now.
function JobCard({
  job,
  onSave,
  onRun,
  runHint,
}: {
  job: { label: string; description: string; due: string; settings: Settings; live: Live };
  onSave: (v: Settings) => Promise<Result<unknown>>;
  onRun: (() => Promise<Result<unknown>>) | null; // null: Run now is off, runHint says why
  runHint?: string;
}) {
  const s = job.settings;
  const [enabled, setEnabled] = useState(s.enabled);
  const [schedule, setSchedule] = useState(s.schedule);
  const [problem, setProblem] = useState("");
  const [catchUpDays, setCatchUpDays] = useState(s.catchUpDays);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, start] = useTransition();

  const dirty = enabled !== s.enabled || schedule !== s.schedule || catchUpDays !== s.catchUpDays;
  const down = "error" in job.live;

  const save = () =>
    start(async () => {
      setError("");
      setNotice("");
      const r = await onSave({ enabled, schedule, catchUpDays });
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
        <button className={`${btn.secondary} disabled:pointer-events-none disabled:opacity-50`} disabled={down || !onRun} title={!onRun ? runHint : undefined} onClick={() => setRunning(true)}>
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

        <ScheduleEditor
          initial={s.schedule}
          onChange={(sc, p) => {
            setSchedule(sc);
            setProblem(p);
          }}
        />

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

      {running && onRun && (
        <Confirm
          title={`Run "${job.label}" now?`}
          action="Run now"
          tone="primary"
          onClose={() => setRunning(false)}
          onConfirm={async () => {
            const r = await onRun();
            if (r.ok) setNotice("Started. Each draft appears in Activity as it is created.");
            return r;
          }}
        >
          <p>Does the same as a scheduled run, straight away{job.due ? ` (${job.due})` : ""}. Nothing is posted, and a date that already has a draft is skipped.</p>
        </Confirm>
      )}
    </section>
  );
}

export function SchedulerView({ jobs, parking }: { jobs: Job[]; parking: ParkingSchedule[] }) {
  return (
    <>
      <PageHeader title="Scheduler" description="Jobs the portal runs on its own. Each has its own schedule, in Malaysia time." />
      <div className="grid gap-6">
        {jobs.map((j) => (
          <JobCard key={j.key} job={j} onSave={(v) => saveJob(j.key, v)} onRun={() => runJobNow(j.key)} />
        ))}
        {parking.map((p) => (
          <JobCard
            key={`parking-${p.id}`}
            job={{ label: `Parking report: ${p.name}`, description: "Downloads yesterday's report from the parking portal and creates its sales invoice draft in NAV. Nothing is posted.", due: "", settings: p.settings, live: p.live }}
            onSave={(v) => saveParkingSchedule(p.id, v)}
            onRun={p.settings.enabled ? () => runParkingScheduleNow(p.id) : null}
            runHint="Switch it on first. To fetch one day while it is off, use Fetch a day on the Parking reports page."
          />
        ))}
      </div>
    </>
  );
}
