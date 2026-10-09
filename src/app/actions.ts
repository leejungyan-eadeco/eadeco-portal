"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bootstrapAdmins, isUsername, toUsername, type Role } from "@/lib/users";
import { clearNavCache, navCompanies, navLookups, navServiceDefs, testCompanyAccess, testNavService, type NavServiceKey } from "@/lib/nav";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { directoryUsers, type DirectoryUser } from "@/lib/directory";
import { explain } from "@/lib/nav-errors";
import { runInvoice } from "@/lib/runs";
import { cronError, dbosCron, TIMEZONE } from "@/lib/cron";
import { isJobKey, scheduleName } from "@/lib/scheduler";
import { nextRun, todayMY } from "@/lib/schedule";
import { listInvoices } from "@/lib/store";
import { frequencies, invoiceTotal, lineTypes, scheduleText, type Frequency, type InvoiceType, type Line, type NavLookups } from "@/lib/types";

export type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const EXPIRED = "Your session has expired. Sign in again.";
const ADMIN_ONLY = "Only admins can do this.";

// ---------- NAV lookups ----------

export async function getNavCompanies(): Promise<Result<string[]>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  try {
    return { ok: true, data: await navCompanies() };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function getLookups(companyCode: string): Promise<Result<NavLookups>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  const { rows } = await db.query(`select nav_company from companies where code = $1 and active`, [companyCode]);
  if (!rows[0]) return fail("Unknown or inactive company.");
  try {
    return { ok: true, data: await navLookups(rows[0].nav_company) };
  } catch (e) {
    return fail(msg(e));
  }
}

// ---------- NAV connection (IT admin) ----------

// Company used to test services: the first company set up in the portal, else the first one in NAV.
async function testCompany(): Promise<string> {
  const { rows } = await db.query(`select nav_company from companies order by active desc, code limit 1`);
  return rows[0]?.nav_company ?? (await navCompanies())[0];
}

// The NAV server address, e.g. http://NAV18APP.eadeco.local:7073/TEST. Saving it clears the cached NAV lists.
export async function saveNavServer(input: string): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  const url = String(input ?? "").trim().replace(/\/+$/, "").replace(/\/ODataV4$/i, "");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail("Enter the full address, e.g. http://NAV18APP.eadeco.local:7073/TEST");
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.pathname.length < 2) return fail("Enter the address with its instance, e.g. http://NAV18APP.eadeco.local:7073/TEST");
  await db.query(
    `insert into nav_settings (base_url, updated_by) values ($1, $2) on conflict (id) do update set base_url = excluded.base_url, updated_by = excluded.updated_by, updated_at = now()`,
    [url, user.username],
  );
  clearNavCache();
  revalidatePath("/settings/nav");
  return { ok: true, data: null };
}

export async function testNavConnection(): Promise<Result<string>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  try {
    const list = await navCompanies();
    return { ok: true, data: `Connected. NAV has ${list.length} companies.` };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function testNavServiceName(serviceName: string): Promise<Result<string>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  if (!/^[\w .-]{1,100}$/.test(serviceName)) return fail("Use letters, numbers, spaces, dots, dashes or underscores.");
  try {
    const company = await testCompany();
    return { ok: true, data: `${await testNavService(serviceName, company)} (tested on ${company})` };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function saveNavServices(names: Partial<Record<NavServiceKey, string>>): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  for (const d of navServiceDefs) {
    const v = names[d.key]?.trim() ?? "";
    if (!/^[\w .-]{1,100}$/.test(v)) return fail(`${d.label}: use letters, numbers, spaces, dots, dashes or underscores.`);
  }
  const client = await db.connect();
  try {
    await client.query("begin");
    for (const d of navServiceDefs) {
      await client.query(
        `insert into nav_services (key, service_name) values ($1, $2)
         on conflict (key) do update set service_name = excluded.service_name, updated_at = now()`,
        [d.key, names[d.key]!.trim()],
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    return fail(msg(e));
  } finally {
    client.release();
  }
  clearNavCache(); // lists may come from different services now
  revalidatePath("/settings/nav");
  return { ok: true, data: null };
}

// ---------- Companies (IT admin) ----------

// Can the portal work in this company? See testCompanyAccess.
export async function testCompanyNav(code: string): Promise<Result<string>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  const { rows } = await db.query(`select nav_company from companies where code = $1`, [code]);
  if (!rows[0]) return fail("Unknown company.");
  try {
    return { ok: true, data: await testCompanyAccess(rows[0].nav_company) };
  } catch (e) {
    const x = explain(msg(e));
    return fail(`${x.summary}. ${x.code === "PORTAL_ERROR" ? msg(e) : x.action}`);
  }
}

// The company's internal ID, made from its NAV name and never shown: "Eadepro Property Services S/B" -> "EADEPROPROP".
// Recurring invoices link to it, so it stays the same when the display name changes.
async function newCompanyCode(navCompany: string): Promise<string> {
  const base =
    navCompany
      .toUpperCase()
      .replace(/\b(SDN|BHD|S\/B|PTE|LTD|BERHAD)\b/g, " ")
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 9) || "CO";
  const { rows } = await db.query<{ code: string }>(`select code from companies where code = $1 or code like $1 || '-%'`, [base]);
  const taken = new Set(rows.map((r) => r.code));
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}-${n}`;
  return code;
}

// No code: a new company. With code: an edit of that company.
export async function saveCompany(input: { code?: string; name: string; navCompany: string; active: boolean }): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  const name = input.name.trim();
  if (!name) return fail("Display name is required.");
  const nav = await getNavCompanies();
  if (!nav.ok) return nav;
  if (!nav.data.includes(input.navCompany)) return fail("Pick a company from NAV's list.");

  try {
    if (!input.code) {
      await db.query(`insert into companies (code, name, nav_company, active) values ($1, $2, $3, $4)`, [await newCompanyCode(input.navCompany), name, input.navCompany, input.active]);
    } else {
      await db.query(`update companies set name = $2, nav_company = $3, active = $4 where code = $1`, [input.code, name, input.navCompany, input.active]);
    }
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return fail("That NAV company is already set up.");
    return fail(msg(e));
  }
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

export async function setCompanyActive(code: string, active: boolean): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  await db.query(`update companies set active = $2 where code = $1`, [code, active]);
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

// A company with recurring invoices cannot go: those invoices would lose their NAV company.
export async function deleteCompany(code: string): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from recurring_invoices where company_code = $1`, [code]);
  if (rows[0].n > 0) return fail(`This company still has ${rows[0].n} recurring invoice${rows[0].n === 1 ? "" : "s"}. Delete them first, or switch the company off instead.`);
  await db.query(`delete from companies where code = $1`, [code]);
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

// ---------- Recurring invoices ----------

export type InvoiceInput = {
  id?: number;
  company: string;
  type: InvoiceType;
  partyNo: string;
  yourReference: string;
  frequency: Frequency;
  weekday: number;
  monthDay: number;
  startDate: string;
  endDate: string | null;
  lines: Line[];
};

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isNum = (n: unknown, min: number, max = Infinity) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;

// Everything from the browser is re-checked here, including against NAV. Field limits follow NAV 2018.
function validate(i: InvoiceInput): string | null {
  if (i.type !== "Sales" && i.type !== "Purchase") return "Invoice type must be Sales or Purchase.";
  if (!frequencies.includes(i.frequency)) return "Unknown frequency.";
  if (!Number.isInteger(i.weekday) || i.weekday < 0 || i.weekday > 6) return "Day of the week is out of range.";
  if (!Number.isInteger(i.monthDay) || i.monthDay < 0 || i.monthDay > 28) return "Day of the month is out of range.";
  if (!isDate(i.startDate)) return "Start date is required.";
  if (i.endDate !== null && (!isDate(i.endDate) || i.endDate < i.startDate)) return "End date must be on or after the start date.";
  if (typeof i.yourReference !== "string" || i.yourReference.length > 35) return "Your Reference can be at most 35 characters (NAV limit).";
  if (!Array.isArray(i.lines) || i.lines.length === 0 || i.lines.length > 200) return "Add between 1 and 200 lines.";
  if (!i.lines.some((l) => l.type !== "")) return "Add at least one line that is not a text line.";
  for (const [n, l] of i.lines.entries()) {
    const at = `Line ${n + 1}`;
    if (!lineTypes.includes(l.type)) return `${at}: unknown type.`;
    if (typeof l.description !== "string" || l.description.length > 50) return `${at}: description can be at most 50 characters (NAV limit).`;
    if (l.type === "") {
      if (!l.description.trim()) return `${at}: a text line needs a description.`;
      continue;
    }
    if (!l.no) return `${at}: pick a No.`;
    if (!isNum(l.quantity, 0) || l.quantity === 0) return `${at}: quantity must be more than 0.`;
    if (!isNum(l.unitPrice, 0)) return `${at}: price cannot be negative.`;
    if (!isNum(l.lineDiscountPct, 0, 100)) return `${at}: discount must be between 0 and 100%.`;
  }
  return null;
}

function checkAgainstNav(i: InvoiceInput, nav: NavLookups): { partyName: string } | string {
  const party = (i.type === "Sales" ? nav.customers : nav.vendors).find((p) => p.no === i.partyNo);
  if (!party) return `${i.type === "Sales" ? "Customer" : "Vendor"} ${i.partyNo || "(none)"} is not in NAV or is blocked.`;
  const has = (list: { no: string }[] | undefined, v: string) => !v || !!list?.some((o) => o.no === v);
  for (const [n, l] of i.lines.entries()) {
    const at = `Line ${n + 1}`;
    if (l.type !== "" && !has(nav.lines[l.type], l.no)) return `${at}: ${l.type} ${l.no} is not in NAV or is blocked.`;
    if (!has(nav.locations, l.locationCode)) return `${at}: location ${l.locationCode} is not in NAV.`;
    if (!has(nav.unitsOfMeasure, l.unitOfMeasure)) return `${at}: unit of measure ${l.unitOfMeasure} is not in NAV.`;
    if (!has(nav.dim1?.values, l.dim1)) return `${at}: ${nav.dim1?.label ?? "dimension 1"} ${l.dim1} is not in NAV or is blocked.`;
    if (!has(nav.dim2?.values, l.dim2)) return `${at}: ${nav.dim2?.label ?? "dimension 2"} ${l.dim2} is not in NAV or is blocked.`;
  }
  return { partyName: party.name };
}

// Another active or paused recurring invoice with the same company, customer/vendor, schedule and lines.
// Only a warning before saving: two identical invoices can be intended (e.g. two rentals at one price).
const lineKey = (l: Line) =>
  l.type === ""
    ? `|${l.description.trim()}`
    : [l.type, l.no, l.description.trim(), l.locationCode, Number(l.quantity), l.unitOfMeasure, Number(l.unitPrice), Number(l.lineDiscountPct), l.dim1, l.dim2].join("|");

export async function findDuplicateInvoice(i: InvoiceInput): Promise<Result<{ partyName: string; schedule: string; total: number } | null>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  const lines = i.lines.map(lineKey).join("\n");
  const twin = (await listInvoices()).find(
    (r) =>
      r.id !== i.id &&
      r.status !== "Ended" &&
      r.company === i.company &&
      r.type === i.type &&
      r.partyNo === i.partyNo &&
      r.frequency === i.frequency &&
      r.weekday === i.weekday &&
      r.monthDay === i.monthDay &&
      r.lines.map(lineKey).join("\n") === lines,
  );
  return { ok: true, data: twin ? { partyName: twin.partyName, schedule: scheduleText(twin), total: invoiceTotal(twin) } : null };
}

export async function saveInvoice(i: InvoiceInput): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  const invalid = validate(i);
  if (invalid) return fail(invalid);
  const lookups = await getLookups(i.company);
  if (!lookups.ok) return lookups;
  const checked = checkAgainstNav(i, lookups.data);
  if (typeof checked === "string") return fail(checked);

  const next = nextRun(i, todayMY());
  const client = await db.connect();
  try {
    await client.query("begin");
    const head = [i.company, i.type, i.partyNo, checked.partyName, i.yourReference.trim(), i.frequency, i.weekday, i.monthDay, i.startDate, i.endDate, next];
    let id = i.id;
    if (id) {
      // Paused stays paused; otherwise the status follows whether a next run exists.
      const { rowCount } = await client.query(
        `update recurring_invoices set company_code = $1, type = $2, party_no = $3, party_name = $4, your_reference = $5, frequency = $6,
           weekday = $7, month_day = $8, start_date = $9, end_date = $10, next_date = $11,
           status = case when status = 'Paused' then 'Paused' when $11::date is null then 'Ended' else 'Active' end, updated_at = now()
         where id = $12`,
        [...head, id],
      );
      if (!rowCount) throw new Error("This recurring invoice no longer exists.");
      await client.query(`delete from recurring_invoice_lines where invoice_id = $1`, [id]);
    } else {
      const { rows } = await client.query(
        `insert into recurring_invoices (company_code, type, party_no, party_name, your_reference, frequency, weekday, month_day, start_date, end_date, next_date, status, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, case when $11::date is null then 'Ended' else 'Active' end, $12) returning id`,
        [...head, user.username],
      );
      id = rows[0].id as number;
    }
    for (const [n, l] of i.lines.entries()) {
      const text = l.type === "";
      await client.query(
        `insert into recurring_invoice_lines (invoice_id, line_no, type, no, description, location_code, quantity, unit_of_measure, unit_price, line_discount_pct, dim1, dim2)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, (n + 1) * 10000, l.type, text ? "" : l.no, l.description.trim(), text ? "" : l.locationCode, text ? 0 : l.quantity, text ? "" : l.unitOfMeasure, text ? 0 : l.unitPrice, text ? 0 : l.lineDiscountPct, text ? "" : l.dim1, text ? "" : l.dim2],
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    return fail(msg(e));
  } finally {
    client.release();
  }
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

export async function setInvoiceStatus(id: number, status: "Active" | "Paused"): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (status !== "Active" && status !== "Paused") return fail("Unknown status.");
  const { rows } = await db.query(
    `select frequency, weekday, month_day as "monthDay", to_char(start_date, 'YYYY-MM-DD') as "startDate", to_char(end_date, 'YYYY-MM-DD') as "endDate"
     from recurring_invoices where id = $1 and status <> 'Ended'`,
    [id],
  );
  if (!rows[0]) return fail("This recurring invoice no longer exists or has ended.");
  // Resuming skips the dates missed while paused: the next run is counted from today.
  const next = status === "Active" ? nextRun(rows[0], todayMY()) : undefined;
  await db.query(
    `update recurring_invoices set status = case when $2 = 'Active' and $3::date is null then 'Ended' else $2 end,
       next_date = coalesce($3::date, case when $2 = 'Paused' then next_date end), updated_at = now() where id = $1`,
    [id, status, next ?? null],
  );
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

// Removes the schedule, its lines and its activity. Drafts already created in NAV stay in NAV.
export async function deleteInvoice(id: number): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(`delete from invoice_runs where invoice_id = $1`, [id]);
    await client.query(`delete from recurring_invoices where id = $1`, [id]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    return fail(msg(e));
  } finally {
    client.release();
  }
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

// Creates today's draft in NAV now, assigned to whoever clicked. Never posts.
export async function runInvoiceNow(id: number): Promise<Result<string>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (!Number.isInteger(id)) return fail("Unknown recurring invoice.");
  try {
    const r = await runInvoice(id, todayMY(), user.username, `Run now by ${user.name}`);
    revalidatePath("/", "layout");
    if (r.result === "Failed") {
      const x = explain(r.error ?? "", r.errorCode);
      return fail(`${x.summary}. ${x.action} (The full NAV message is in Activity.)`);
    }
    if (r.existing) return { ok: true, data: `Today's draft already exists in NAV: ${r.navDocument}. Nothing new was created.` };
    return { ok: true, data: `Draft ${r.navDocument} created in NAV.${r.note ? ` ${r.note}` : ""}` };
  } catch (e) {
    return fail(msg(e));
  }
}

// ---------- Scheduler (admin) ----------

export async function saveJob(key: string, input: { enabled: boolean; schedule: string; catchUpDays: number }): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  if (!isJobKey(key)) return fail("Unknown job.");
  if (typeof input.enabled !== "boolean") return fail("Invalid on/off value.");
  const schedule = String(input.schedule ?? "").trim().replace(/\s+/g, " ");
  const bad = cronError(schedule);
  if (bad) return fail(`The schedule is not valid: ${bad}`);
  if (!isNum(input.catchUpDays, 0, 31) || !Number.isInteger(input.catchUpDays)) return fail("Make-up days must be 0 to 31.");
  try {
    // The live schedule first: if DBOS refuses, the saved settings still match what actually runs.
    await DBOS.updateSchedule(scheduleName(key), { schedule: dbosCron(schedule), cronTimezone: TIMEZONE });
    await (input.enabled ? DBOS.resumeSchedule(scheduleName(key)) : DBOS.pauseSchedule(scheduleName(key)));
  } catch (e) {
    return fail(`The scheduler is not running, so nothing was changed: ${msg(e)}`);
  }
  await db.query(`update scheduled_jobs set enabled = $2, schedule = $3, catch_up_days = $4, updated_by = $5, updated_at = now() where key = $1`, [
    key,
    input.enabled,
    schedule,
    input.catchUpDays,
    user.username,
  ]);
  revalidatePath("/settings/scheduler");
  return { ok: true, data: null };
}

// Starts one run of the job straight away, the same as a scheduled one. Returns before it finishes.
export async function runJobNow(key: string): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  if (!isJobKey(key)) return fail("Unknown job.");
  try {
    await DBOS.triggerSchedule(scheduleName(key));
  } catch (e) {
    return fail(`The scheduler is not running: ${msg(e)}`);
  }
  return { ok: true, data: null };
}

// ---------- Users (admin) ----------

// Active EADECO accounts, for the Invite dropdown.
export async function getDirectoryUsers(): Promise<Result<DirectoryUser[]>> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  try {
    return { ok: true, data: await directoryUsers() };
  } catch (e) {
    return fail(`Could not read the EADECO user list: ${msg(e)}`);
  }
}

export async function inviteUser(input: string, role: Role): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  const username = toUsername(input);
  if (!isUsername(username)) return fail("Enter an AD username such as jenyee, or an email such as jenyee@eadeco.com.my.");
  if (role !== "admin" && role !== "user") return fail("Pick a role.");
  try {
    const ad = await directoryUsers()
      .then((list) => list.find((d) => d.username === username))
      .catch(() => undefined);
    await db.query(`insert into users (username, role, invited_by, display_name, email) values ($1, $2, $3, $4, nullif($5, ''))`, [
      username,
      role,
      user.username,
      ad?.name ?? null,
      ad?.email ?? "",
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return fail(`${username} is already on the list.`);
    return fail(msg(e));
  }
  revalidatePath("/settings/users");
  return { ok: true, data: null };
}

// Anyone's name and email can be edited. Role and access cannot be changed for yourself or the .env admins,
// so there is always at least one admin left.
export async function updateUser(username: string, change: { displayName?: string; email?: string; role?: Role; active?: boolean }): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  const access = change.role !== undefined || change.active !== undefined;
  if (access && username === user.username) return fail("You can't change your own role or access. Ask another admin.");
  if (access && bootstrapAdmins().includes(username)) return fail("This admin is set in the server's .env (BOOTSTRAP_ADMINS); their role and access can't be changed here.");
  if (change.role !== undefined && change.role !== "admin" && change.role !== "user") return fail("Pick a role.");
  if (change.active !== undefined && typeof change.active !== "boolean") return fail("Invalid status.");
  const name = change.displayName?.trim();
  const email = change.email?.trim().toLowerCase();
  if (name !== undefined && name.length > 100) return fail("Name is too long (100 characters at most).");
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return fail("Enter a valid email, such as jenyee@eadeco.com.my.");
  await db.query(
    `update users set role = coalesce($2, role), active = coalesce($3, active),
       display_name = case when $4::boolean then nullif($5, '') else display_name end,
       email = case when $6::boolean then nullif($7, '') else email end
     where username = $1`,
    [username, change.role ?? null, change.active ?? null, name !== undefined, name ?? "", email !== undefined, email ?? ""],
  );
  revalidatePath("/settings/users");
  return { ok: true, data: null };
}

export async function removeUser(username: string): Promise<Result> {
  const user = await currentUser();
  if (!user) return fail(EXPIRED);
  if (user.role !== "admin") return fail(ADMIN_ONLY);
  if (username === user.username) return fail("You can't remove yourself. Ask another admin.");
  await db.query(`delete from users where username = $1`, [username]);
  revalidatePath("/settings/users");
  return { ok: true, data: null };
}
