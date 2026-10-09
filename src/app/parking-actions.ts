"use server";

// Parking report setups and runs. Any signed-in user may manage them; every change is logged with who made it.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { cronError } from "@/lib/cron";
import { db } from "@/lib/db";
import { explain } from "@/lib/nav-errors";
import { getSetup, savedPassword, storedSample, testSignIn, verifyRunFiles } from "@/lib/parking";
import { todayMY } from "@/lib/schedule";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { parkingScheduleName, startParkingDay, syncParkingSchedule } from "@/lib/scheduler";
import { seal } from "@/lib/secret";
import type { ParkingColumns, ParkingCountOnly, ParkingSample, ParkingSetup } from "@/lib/types";
import type { Result } from "./actions";

const fail = (error: string) => ({ ok: false as const, error });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const EXPIRED = "Your session has expired. Sign in again.";
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

export type ParkingSetupInput = Omit<ParkingSetup, "id" | "hasPassword"> & { id: number; password?: string };
type SetupValues = Omit<ParkingSetup, "id" | "hasPassword">;

// Setups are added by IT (a new parking portal type needs its clicking steps written first); users edit them.

// Checks and tidies what the setup screen sent. Paused setups may be unfinished; Active ones must be complete.
async function cleanSetup(i: Omit<ParkingSetupInput, "id">, hasSavedPassword: boolean): Promise<Result<SetupValues>> {
  const name = str(i.name, 80);
  if (!name) return fail("Give the setup a name, e.g. the carpark.");
  let portalUrl: string;
  try {
    const u = new URL(str(i.portalUrl, 300));
    if (!/^https?:$/.test(u.protocol)) throw 0;
    portalUrl = u.href.replace(/\/+$/, "");
  } catch {
    return fail("The parking portal address must start with http:// or https://.");
  }
  if (!isDate(i.startDate)) return fail("Pick the first report date.");
  if (!Number.isInteger(i.headerRow) || i.headerRow < 1 || i.headerRow > 100) return fail("The header row must be 1 to 100.");
  const columns = { net: str(i.columns?.net), sst: str(i.columns?.sst), type: str(i.columns?.type) };
  if (!Array.isArray(i.lines)) return fail("Invalid lines.");
  const lines = i.lines.map((l) => ({
    label: str(l.label, 60),
    values: [...new Set((Array.isArray(l.values) ? l.values : []).map((v) => str(v)).filter(Boolean))],
    glAccount: str(l.glAccount, 20),
    description: str(l.description, 50),
    dim1: str(l.dim1, 20),
    dim2: str(l.dim2, 20),
  }));
  if (lines.some((l) => !l.label)) return fail("Every NAV line needs a name.");
  const seen = lines.flatMap((l) => l.values.map((v) => v.toLowerCase()));
  const twice = seen.find((v, n) => seen.indexOf(v) !== n);
  if (twice) return fail(`The payment type "${twice}" is on two lines; each type can go to one line only.`);
  const schedule = str(i.schedule).replace(/\s+/g, " ");
  const bad = cronError(schedule);
  if (bad) return fail(`The schedule is not valid: ${bad}`);
  if (!Number.isInteger(i.catchUpDays) || i.catchUpDays < 0 || i.catchUpDays > 31) return fail("Make-up days must be 0 to 31.");
  if (i.status !== "Active" && i.status !== "Paused") return fail("Invalid status.");
  const sstLine = str(i.sstLine?.glAccount, 20)
    ? { glAccount: str(i.sstLine?.glAccount, 20), description: str(i.sstLine?.description, 50), dim1: str(i.sstLine?.dim1, 20), dim2: str(i.sstLine?.dim2, 20) }
    : null;
  const onlyValues = [...new Set((Array.isArray(i.countOnly?.values) ? i.countOnly.values : []).map((v) => str(v)).filter(Boolean))];
  const countOnly = str(i.countOnly?.column) && onlyValues.length ? { column: str(i.countOnly?.column), values: onlyValues } : null;
  const companyCode = str(i.companyCode) || null;
  if (companyCode) {
    const { rows } = await db.query(`select 1 from companies where code = $1`, [companyCode]);
    if (!rows[0]) return fail("Unknown company.");
  }
  const value: SetupValues = {
    name, portalUrl, username: str(i.username, 120), companyCode, customerNo: str(i.customerNo, 20), startDate: i.startDate,
    headerRow: i.headerRow, columns, lines, sstLine, countOnly, status: i.status, schedule, catchUpDays: i.catchUpDays,
  };
  if (value.status === "Active") {
    const missing = [
      !value.username && "the portal username",
      !hasSavedPassword && !i.password && "the portal password",
      !companyCode && "a company",
      !value.customerNo && "a customer",
      !(columns.net && columns.sst && columns.type) && "the three columns",
      !lines.length && "at least one NAV line",
      ...lines.map((l) => (!l.values.length || !l.glAccount) && `payment types and a G/L account on line "${l.label}"`),
    ].filter(Boolean);
    if (missing.length) return fail(`To switch it on, it still needs ${missing.join(", ")}. Save it as Paused until then.`);
  }
  return { ok: true, data: value };
}

// JSON with object keys sorted: the database returns jsonb keys in its own order, so plain JSON.stringify would
// report unchanged NAV lines as changed.
const same = (a: unknown, b: unknown) => {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, w]) => [k, canon(w)])) : v ?? null);
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
};

// What changed, field by field, for the setup's history. The password itself is never written down, only that it changed.
function diff(before: Partial<SetupValues> | null, after: Partial<SetupValues>, passwordChanged: boolean) {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]) as Set<keyof SetupValues>;
  for (const k of keys) if (!same(before?.[k], after[k])) out[k] = { before: before?.[k] ?? null, after: after[k] ?? null };
  if (passwordChanged) out.password = { before: before ? "(saved)" : null, after: "(changed)" };
  return out;
}

async function logChange(setupId: number, setupName: string, by: string, action: string, changes: object = {}) {
  await db.query(`insert into parking_setup_changes (setup_id, setup_name, changed_by, action, changes) values ($1, $2, $3, $4, $5)`, [
    setupId, setupName, by, action, JSON.stringify(changes),
  ]);
}

const values = ({ id: _, hasPassword: __, ...v }: ParkingSetup): SetupValues => v;

// The live schedule follows the database. If DBOS is down the setup is still saved, and startup syncs it.
async function syncSchedule(id: number): Promise<string | null> {
  try {
    await syncParkingSchedule(id);
    return null;
  } catch (e) {
    return `Saved, but the scheduler is not running, so the schedule takes effect when the portal restarts (${msg(e)}).`;
  }
}

export async function saveParkingSetup(i: ParkingSetupInput): Promise<Result<{ id: number; warning: string | null }>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  const before = Number.isInteger(i.id) ? await getSetup(i.id) : null;
  if (!before) return fail("This setup no longer exists.");
  const id = before.id;
  const c = await cleanSetup(i, before.hasPassword);
  if (!c.ok) return c;
  const v = c.data;
  let sealed: string | null = null;
  try {
    if (i.password) sealed = seal(String(i.password));
  } catch (e) {
    return fail(msg(e).replace(/^Parking setup: /, ""));
  }
  const args = [v.name, v.portalUrl, v.username, v.companyCode, v.customerNo, v.startDate, v.headerRow, JSON.stringify(v.columns), JSON.stringify(v.lines), v.status, v.schedule, v.catchUpDays, user.username, sealed, v.sstLine && JSON.stringify(v.sstLine), v.countOnly && JSON.stringify(v.countOnly)];
  try {
    await db.query(
      `update parking_setups set name = $1, portal_url = $2, username = $3, company_code = $4, customer_no = $5, start_date = $6, header_row = $7,
         columns = $8, lines = $9, status = $10, schedule = $11, catch_up_days = $12, updated_by = $13, updated_at = now(),
         password_enc = coalesce($14, password_enc), sst_line = $15, count_only = $16
       where id = $17`,
      [...args, id],
    );
  } catch (e) {
    if (/parking_setups_name_key/.test(msg(e))) return fail(`There is already a setup called "${v.name}".`);
    return fail(msg(e));
  }
  const changes = diff(values(before), v, !!sealed);
  if (Object.keys(changes).length) await logChange(id, v.name, user.username, "Changed", changes);
  const warning = await syncSchedule(id);
  revalidatePath("/automation/parking-reports");
  return { ok: true, data: { id, warning } };
}

// The schedule part of a setup (on/off, when, make-up days) is set by admins in Settings > Scheduler, like every job.
export async function saveParkingSchedule(id: number, input: { enabled: boolean; schedule: string; catchUpDays: number }): Promise<Result<string | null>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail("Only admins can do this.");
  const s = await getSetup(id);
  if (!s) return fail("This setup no longer exists.");
  const c = await cleanSetup({ ...values(s), status: input.enabled ? "Active" : "Paused", schedule: input.schedule, catchUpDays: input.catchUpDays }, s.hasPassword);
  if (!c.ok) return c;
  const v = c.data;
  await db.query(`update parking_setups set status = $2, schedule = $3, catch_up_days = $4, updated_by = $5, updated_at = now() where id = $1`, [id, v.status, v.schedule, v.catchUpDays, user.username]);
  const changes = diff(values(s), v, false);
  if (Object.keys(changes).length) await logChange(id, s.name, user.username, s.status !== v.status ? (v.status === "Active" ? "Resumed" : "Paused") : "Changed", changes);
  const warning = await syncSchedule(id);
  revalidatePath("/", "layout");
  return warning ? fail(warning) : { ok: true, data: null };
}

// Starts a scheduled run straight away: yesterday plus any make-up days without a draft. Returns before it finishes.
export async function runParkingScheduleNow(id: number): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail("Only admins can do this.");
  try {
    await DBOS.triggerSchedule(parkingScheduleName(id));
  } catch (e) {
    return fail(`The scheduler is not running: ${msg(e)}`);
  }
  return { ok: true, data: null };
}

// Headers and per-payment-type totals from the rows this setup already kept (its latest day), for the setup
// screen's column dropdowns and preview.
export async function getParkingSample(id: number, columns: ParkingColumns, countOnly: ParkingCountOnly | null): Promise<Result<ParkingSample | null>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  return { ok: true, data: await storedSample(id, columns, countOnly) };
}

// Signs in to the parking portal with what the setup screen shows (a newly typed password, else the saved one).
export async function testParkingSignIn(i: { id: number; portalUrl: string; username: string; password?: string }): Promise<Result<string>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  try {
    const password = i.password || (await savedPassword(i.id).catch(() => ""));
    if (!str(i.portalUrl) || !str(i.username) || !password) return fail("Fill in the URL, username and password first.");
    await testSignIn({ portalUrl: str(i.portalUrl, 300), username: str(i.username, 120), password });
    return { ok: true, data: `Signed in to the parking portal as ${str(i.username, 120)}.` };
  } catch (e) {
    return fail(msg(e).replace(/^Parking (setup|report|portal): /, "").split("\n")[0]);
  }
}

export async function verifyParkingRun(runId: number): Promise<Result<Record<number, "ok" | "changed" | "removed">>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  return { ok: true, data: await verifyRunFiles(runId) };
}

// Fetches one day's report for one setup and creates its draft now. Takes about a minute.
export async function runParkingNow(setupId: number, date: string): Promise<Result<string>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (!isDate(date) || date >= todayMY()) return fail("Pick a day before today: a day's report is complete only once the day is over.");
  // The day's workflow (retries included) carries on in the background. Wait a moment: either its run is listed
  // (started), or it ended at once (the day already has a draft, is already being fetched, the setup is gone).
  let handle: Awaited<ReturnType<typeof startParkingDay>>;
  const since = new Date();
  try {
    handle = await startParkingDay(setupId, date, `Fetch by ${user.name}`);
  } catch (e) {
    return fail(msg(e));
  }
  const done = handle.getResult().catch((e: unknown) => new Error(msg(e)));
  const started = (async () => {
    for (let i = 0; i < 40; i++) {
      const { rows } = await db.query(`select 1 from parking_runs where setup_id = $1 and report_date = $2 and ran_at >= $3`, [setupId, date, since]);
      if (rows[0]) return "started" as const;
      await new Promise((r) => setTimeout(r, 250));
    }
    return "started" as const;
  })();
  const first = await Promise.race([done, started]);
  revalidatePath("/activity");
  if (first === "started") return { ok: true, data: "Started. It is listed in Activity as Processing; if the parking portal or NAV doesn't answer, it tries again after 5, 10 and 15 minutes." };
  if (first instanceof Error) return fail(first.message);
  if (first.existing && first.posted) return { ok: true, data: `This day's draft ${first.navDocument} has been posted in NAV as ${first.posted}. Nothing new was created.` };
  if (first.existing) return { ok: true, data: first.navDocument ? `This day already has a draft in NAV: ${first.navDocument}. Nothing new was created.` : "This day had no paid transactions, so it needs no draft." };
  return fail(first.error ?? "The run stopped.");
}
