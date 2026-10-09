// Parking reports: for each setup (one carpark / portal account), download a day's export from the parking portal
// (WhizzParking), keep the file and every row, and create one NAV sales invoice draft with a line per payment
// type group. Never posts. Every run leaves an evidence log: each step with its time, a screenshot and the
// SHA-256 fingerprint of every file it wrote.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { chromium, type Page } from "playwright";
import { db } from "./db";
import { createNavDraft, navDraftState } from "./nav";
import { classify } from "./nav-errors";
import { unseal } from "./secret";
import type { Line, ParkingColumns, ParkingCountOnly, ParkingSample, ParkingSetup, ParkingTotal } from "./types";

export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "storage");
export const PARKING_DIR = path.join(STORAGE_DIR, "parking");
const KEEP_DAYS = 30; // screenshots and traces; the Excel file and the ".keep" screenshot of the export stay

export const setupSelect = `
  select id, name, portal_url as "portalUrl", username, password_enc is not null as "hasPassword", company_code as "companyCode",
         customer_no as "customerNo", to_char(start_date, 'YYYY-MM-DD') as "startDate", header_row as "headerRow", columns, lines, sst_line as "sstLine", count_only as "countOnly",
         status, schedule, catch_up_days as "catchUpDays"
  from parking_setups`;

export async function getSetup(id: number): Promise<ParkingSetup | null> {
  const { rows } = await db.query(`${setupSelect} where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function savedPassword(id: number): Promise<string> {
  const { rows } = await db.query<{ p: string | null }>(`select password_enc as p from parking_setups where id = $1`, [id]);
  if (!rows[0]?.p) throw new Error("Parking setup: no password is saved for the parking portal account.");
  return unseal(rows[0].p);
}

// ---------- 1. The parking portal (Playwright) ----------

export type StepOptions = { shot?: boolean; keep?: boolean; file?: string; ok?: boolean };
export type StepLog = (step: string, detail: string, o?: StepOptions) => Promise<void>;
export type Credentials = { portalUrl: string; username: string; password: string };

const base = (url: string) => url.replace(/\/+$/, "");

export async function signIn(page: Page, c: Credentials, log: StepLog) {
  page.setDefaultTimeout(30_000);
  await page.goto(`${base(c.portalUrl)}/login`);
  await log("Open the parking portal", `${base(c.portalUrl)}/login`, { shot: true });
  await page.getByRole("textbox", { name: "Please Key In Your Account" }).fill(c.username);
  await page.getByRole("textbox", { name: "Please Key In Your Password" }).fill(c.password);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForLoadState("networkidle");
  if (new URL(page.url()).pathname === "/login") {
    await log("Sign in", `Refused for ${c.username}`, { shot: true, ok: false });
    throw new Error(`Parking portal sign-in failed for ${c.username}: still on the login page after signing in.`);
  }
  await log("Sign in", `Signed in as ${c.username}`, { shot: true });
}

// The report page's date pickers open on the current month. Older months: step back until the header
// shows the wanted month. .old/.new are the greyed days of the neighbouring months, which share numbers with this one.
async function pickDay(page: Page, date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const today = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" })}T00:00:00Z`);
  if (d.getUTCMonth() !== today.getUTCMonth() || d.getUTCFullYear() !== today.getUTCFullYear()) {
    const month = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toLowerCase();
    const year = String(d.getUTCFullYear());
    const header = page.locator(".picker-switch, .datepicker-switch").filter({ visible: true }).first();
    for (let i = 0; ; i++) {
      const shown = (await header.innerText()).toLowerCase();
      if (shown.includes(year) && (shown.includes(month) || shown.includes(month.slice(0, 3)))) break;
      if (i > 36) throw new Error(`Parking portal: the date picker never showed ${month} ${year} (it shows "${shown}").`);
      await page.locator("th.prev").filter({ visible: true }).first().click();
    }
  }
  await page
    .locator("td.day:not(.old):not(.new)")
    .filter({ hasText: new RegExp(`^${d.getUTCDate()}$`), visible: true })
    .click();
}

// After signIn: sets both dates to `date`, searches and exports. Returns the saved file's path.
export async function exportReport(page: Page, portalUrl: string, date: string, folder: string, log: StepLog): Promise<string> {
  // Login lands on the lane dashboard; the report is its own page.
  await page.goto(`${base(portalUrl)}/report`);
  await page.getByRole("button", { name: "Search" }).waitFor();
  await log("Open the report page", `${base(portalUrl)}/report`, { shot: true });

  await page.locator(".fa").first().click();
  await pickDay(page, date);
  await page.locator("#div-end-date > .input-group-append > .input-group-text > .fa").click();
  await pickDay(page, date);
  await log("Pick the dates", `${date} 00:00:00 to ${date} 23:59:59`, { shot: true });

  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForLoadState("networkidle");
  await log("Search", "Transactions listed", { shot: true });

  const popup = page.waitForEvent("popup");
  const download = page.waitForEvent("download", { timeout: 180_000 });
  await page.getByRole("button", { name: "Export" }).click();
  await (await popup).close().catch(() => {});
  const file = path.join(folder, `parking-report-${date}.xlsx`);
  await (await download).saveAs(file);
  await log("Export", "The portal exported the report", { shot: true, keep: true });
  await log("Save the file", `${path.basename(file)}, ${Math.round((await stat(file)).size / 1024)} KB`, { file });
  return file;
}

// ---------- 2. The Excel file ----------

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // formula
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text); // hyperlink
  }
  return String(v);
};
const norm = (s: string) => s.trim().toLowerCase();

type Rows = { rowNo: number; data: Record<string, unknown> }[];

// Every row below the header, keyed by header text; and the dates the export says it covers.
async function parseWorkbook(file: string, headerRow: number) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Parking report: the Excel file has no sheet.");

  const dates = new Set<string>();
  for (let r = 1; r < headerRow; r++)
    ws.getRow(r).eachCell((c) => {
      const m = /^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}$/.exec(cellText(c.value).trim());
      if (m) dates.add(m[1]);
    });

  const names = new Map<number, string>();
  ws.getRow(headerRow).eachCell((c, col) => {
    let name = cellText(c.value).trim() || `Column ${col}`;
    while ([...names.values()].includes(name)) name += " (2)";
    names.set(col, name);
  });
  if (!names.size) throw new Error(`Parking report: row ${headerRow} is empty, so it can't be the header row.`);

  const rows: Rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    const data: Record<string, unknown> = {};
    row.eachCell((c, col) => {
      const v = c.value;
      data[names.get(col) ?? `Column ${col}`] = typeof v === "object" && v !== null ? cellText(v as ExcelJS.CellValue) : v;
    });
    rows.push({ rowNo: r, data });
  }
  return { dates, headers: [...names.values()], rows };
}

const cents = (v: unknown, where: string): number => {
  const t = String(v ?? "").replace(/,/g, "").trim();
  if (t === "") return 0;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`Parking report: ${where} should be an amount but is "${t}".`);
  return Math.round(n * 100);
};

// Net and SST per payment type, in sen, over the rows that count (see ParkingCountOnly); the others are tallied apart.
function byType(headers: string[], rows: Rows, c: ParkingColumns, only: ParkingCountOnly | null = null) {
  const find = (label: string, h: string) => {
    const found = headers.find((x) => norm(x) === norm(h));
    if (!found) throw new Error(`Parking report: no column "${h}" (${label}) in the header row. The columns there are: ${headers.join(", ")}. Check the setup's columns.`);
    return found;
  };
  const net = find("net sales", c.net);
  const sst = find("SST", c.sst);
  const type = find("payment type", c.type);
  const onlyCol = only ? find("rows that count", only.column) : null;
  const counts = (data: Record<string, unknown>) => !onlyCol || only!.values.some((v) => norm(v) === norm(String(data[onlyCol] ?? "")));
  const out = new Map<string, { count: number; net: number; sst: number }>();
  const ignored = { count: 0, money: 0 };
  for (const { rowNo, data } of rows) {
    if (!counts(data)) {
      ignored.count++;
      ignored.money += cents(data[net], `${net} on row ${rowNo}`) + cents(data[sst], `${sst} on row ${rowNo}`);
      continue;
    }
    const t = String(data[type] ?? "").trim();
    const x = out.get(t) ?? { count: 0, net: 0, sst: 0 };
    out.set(t, { count: x.count + 1, net: x.net + cents(data[net], `${net} on row ${rowNo}`), sst: x.sst + cents(data[sst], `${sst} on row ${rowNo}`) });
  }
  return { types: out, ignored };
}

const toSample = (date: string, headers: string[], types: Map<string, { count: number; net: number; sst: number }>): ParkingSample => ({
  date,
  headers,
  types: [...types].map(([value, t]) => ({ value, count: t.count, net: t.net / 100, sst: t.sst / 100 })).sort((a, b) => b.net - a.net),
});

// For the setup screen: the headers, and the totals per payment type when the columns are found.
export async function sampleFromFile(file: string, date: string, headerRow: number, columns: ParkingColumns, only: ParkingCountOnly | null = null): Promise<ParkingSample> {
  const { headers, rows } = await parseWorkbook(file, headerRow);
  let types = new Map<string, { count: number; net: number; sst: number }>();
  try {
    types = byType(headers, rows, columns, only).types;
  } catch {} // columns not chosen yet: headers only
  return toSample(date, headers, types);
}

// The same from the rows already kept for this setup (its latest day), without going to the portal.
export async function storedSample(setupId: number, columns: ParkingColumns, only: ParkingCountOnly | null = null): Promise<ParkingSample | null> {
  const { rows } = await db.query<{ date: string; headers: string[] }>(
    `select to_char(report_date, 'YYYY-MM-DD') as date, (select array_agg(k order by k) from jsonb_object_keys(data) k) as headers
     from parking_transactions where setup_id = $1 order by report_date desc, row_no limit 1`,
    [setupId],
  );
  if (!rows[0]) return null;
  const amount = (p: string) => `sum(case when data->>${p} ~ '^-?[0-9]+(\\.[0-9]+)?$' then (data->>${p})::numeric else 0 end)::float`;
  const { rows: types } = await db.query<{ value: string; count: number; net: number; sst: number }>(
    `select coalesce(trim(data->>$3), '') as value, count(*)::int as count, ${amount("$4")} as net, ${amount("$5")} as sst
     from parking_transactions where setup_id = $1 and report_date = $2
       and ($6::text is null or lower(trim(data->>$6)) = any(select lower(trim(v)) from unnest($7::text[]) v))
     group by 1 order by 3 desc`,
    [setupId, rows[0].date, columns.type, columns.net, columns.sst, only?.column ?? null, only?.values ?? []],
  );
  const known = rows[0].headers.map(norm);
  const all = [columns.type, columns.net, columns.sst].every((h) => known.includes(norm(h)));
  return { date: rows[0].date, headers: rows[0].headers, types: all ? types : [] };
}

// problem: money that no NAV line takes. The rows are still returned so they can be kept, but no draft is made.
export type Report = { rows: Rows; totals: ParkingTotal[]; lines: Line[]; ignored: { count: number; money: number }; problem: string | null };

export async function readReport(
  file: string,
  s: Pick<ParkingSetup, "headerRow" | "columns" | "lines"> & { sstLine?: ParkingSetup["sstLine"]; countOnly?: ParkingSetup["countOnly"] },
  date: string,
): Promise<Report> {
  const { dates, headers, rows } = await parseWorkbook(file, s.headerRow);
  // The export must be for the wanted day: every date-time above the header (Start/End Datetime) is on it.
  if (dates.size !== 1 || !dates.has(date))
    throw new Error(`Parking portal: the export is for ${[...dates].join(" to ") || "no date shown"}, not ${date}. The dates were not picked correctly.`);

  const { types, ignored } = byType(headers, rows, s.columns, s.countOnly ?? null);
  const byLine = s.lines.map((l) => ({ label: l.label, count: 0, net: 0, sst: 0 }));
  const unmapped: string[] = [];
  for (const [type, t] of types) {
    const i = s.lines.findIndex((l) => l.values.some((v) => norm(v) === norm(type)));
    if (i >= 0) {
      byLine[i].count += t.count;
      byLine[i].net += t.net;
      byLine[i].sst += t.sst;
    } else if (t.net || t.sst) {
      // Money that no line takes would silently go missing from NAV, so the run stops instead.
      unmapped.push(`"${type || "(blank)"}" (${t.count} rows, RM ${((t.net + t.sst) / 100).toFixed(2)})`);
    }
  }
  const problem = unmapped.length ? `Parking report: payment types with money that no NAV line takes: ${unmapped.join(", ")}. Add them to a line in the setup.` : null;

  // Unit price is the net sales; NAV adds SST from the G/L account's VAT setup.
  const lines: Line[] = s.lines.flatMap((l, i) =>
    byLine[i].net
      ? [{ type: "G/L Account" as const, no: l.glAccount, description: (l.description || `${l.label} parking ${date}`).slice(0, 50), locationCode: "", quantity: 1, unitOfMeasure: "", unitPrice: byLine[i].net / 100, lineDiscountPct: 0, dim1: l.dim1, dim2: l.dim2 }]
      : [],
  );
  // SST line: the report's own SST total (rounded per ticket), so the invoice total equals the report's.
  const sst = byLine.reduce((a, t) => a + t.sst, 0);
  if (s.sstLine?.glAccount && sst)
    lines.push({ type: "G/L Account", no: s.sstLine.glAccount, description: (s.sstLine.description || `SST parking ${date}`).slice(0, 50), locationCode: "", quantity: 1, unitOfMeasure: "", unitPrice: sst / 100, lineDiscountPct: 0, dim1: s.sstLine.dim1, dim2: s.sstLine.dim2 });
  return { rows, totals: byLine.map((t) => ({ ...t, net: t.net / 100, sst: t.sst / 100 })), lines, ignored: { count: ignored.count, money: ignored.money / 100 }, problem };
}

// Signs in only, for the setup screen's Test sign-in. Nothing is downloaded.
export async function testSignIn(c: Credentials): Promise<void> {
  const browser = await chromium.launch();
  try {
    await signIn(await browser.newPage(), c, async () => {});
  } finally {
    await browser.close();
  }
}

// ---------- 3. One setup, one day, end to end ----------

export type ParkingOutcome = { result: "Created" | "Failed"; navDocument: string | null; error: string | null; errorCode: string | null; existing: boolean; posted?: string; runId?: number };

async function pruneEvidence() {
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  const files = await readdir(PARKING_DIR, { recursive: true }).catch(() => [] as string[]);
  for (const f of files.filter((f) => /\.(jpg|png|zip|webm)$/.test(f) && !f.includes(".keep."))) {
    const p = path.join(PARKING_DIR, f);
    if ((await stat(p)).mtimeMs < cutoff) await rm(p, { force: true });
  }
}

function setupProblem(s: ParkingSetup, navCompany: string | undefined): string | null {
  if (!s.portalUrl) return "the parking portal address is empty";
  if (!s.username || !s.hasPassword) return "the parking portal account or password is missing";
  if (!navCompany) return "no active company is chosen";
  if (!s.customerNo) return "no customer is chosen";
  if (!s.lines.length) return "there are no NAV lines";
  const bad = s.lines.find((l) => !l.glAccount || !l.values.length);
  if (bad) return `line "${bad.label}" needs a G/L account and at least one payment type`;
  return null;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// One draft per setup per report date: a second run for a date that has one returns it instead of making another.
// The run is recorded as Running straight away and each step is written as it happens, so Activity shows it live.
// onStarted: called once that Running row exists (Fetch a day returns then and lets the run carry on).
// recheck (Fetch a day): when the day already has a draft, ask NAV what became of it. Posted or still there: nothing
// new. Deleted in NAV: that run is marked Deleted and the day is created again. The scheduler never rechecks, so a
// draft someone deleted on purpose (e.g. a duplicate) is not re-created behind their back.
export async function runParkingReport(setupId: number, date: string, trigger: string, onStarted?: () => void, recheck = false): Promise<ParkingOutcome> {
  const client = await db.connect();
  // ponytail: one int key per (setup, day); fine below ~21,000 setups.
  const lockKey = setupId * 100_000 + Date.parse(`${date}T00:00:00Z`) / 864e5;
  try {
    const { rows: lock } = await client.query<{ ok: boolean }>(`select pg_try_advisory_lock(7103, $1) as ok`, [lockKey]);
    if (!lock[0].ok) throw new Error(`The parking report for ${date} is already being fetched; it is listed in Activity.`);
    try {
      const { rows: done } = await client.query<{ id: number; navDocument: string | null; navCompany: string | null }>(
        `select r.id, r.nav_document_no as "navDocument", c.nav_company as "navCompany"
         from parking_runs r left join companies c on c.code = r.settings->>'companyCode'
         where r.setup_id = $1 and r.report_date = $2 and r.result = 'Created'`,
        [setupId, date],
      );
      if (done[0]) {
        const d = done[0];
        const nav = recheck && d.navDocument && d.navCompany ? await navDraftState(d.navCompany, d.navDocument) : null;
        if (nav?.state !== "gone") return { result: "Created", navDocument: d.navDocument, error: null, errorCode: null, existing: true, posted: nav?.state === "posted" ? nav.no : undefined };
        await client.query(`update parking_runs set result = 'Deleted', note = $2 where id = $1`, [d.id, `Draft ${d.navDocument} was deleted in NAV; found when the day was fetched again (${trigger}).`]);
      }

      await pruneEvidence();
      const s = await getSetup(setupId);
      if (!s) throw new Error("This parking setup no longer exists.");
      const { hasPassword: _, ...settings } = s;
      const { rows: co } = await client.query<{ nav_company: string }>(`select nav_company from companies where code = $1 and active`, [s.companyCode]);
      const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kuala_Lumpur" }).replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1-");
      const folder = `${setupId}/${date}/${stamp}`; // relative to PARKING_DIR; also the URL path of its files
      const dir = path.join(PARKING_DIR, folder);
      const { rows: run } = await db.query<{ id: number }>(
        `insert into parking_runs (setup_id, report_date, result, folder, triggered_by, settings) values ($1, $2, 'Running', $3, $4, $5) returning id`,
        [setupId, date, folder, trigger, JSON.stringify(settings)],
      );
      const runId = run[0].id;
      onStarted?.();

      let seq = 0;
      let failedStep = false;
      let page: Page | null = null;
      const log: StepLog = async (step, detail, o = {}) => {
        const n = ++seq;
        let file = o.file ? path.basename(o.file) : null;
        let hash: string | null = null;
        if (o.file) hash = sha256(await readFile(o.file));
        else if (o.shot && page) {
          const shot = await page.screenshot({ type: "jpeg", quality: 70 }).catch(() => null);
          if (shot) {
            file = `${String(n).padStart(2, "0")}-${step.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${o.keep ? ".keep" : ""}.jpg`;
            await writeFile(path.join(dir, file), shot);
            hash = sha256(shot);
          }
        }
        if (o.ok === false) failedStep = true;
        await db.query(`insert into parking_run_steps (run_id, seq, at, step, detail, ok, file, sha256) values ($1, $2, now(), $3, $4, $5, $6, $7)`, [runId, n, step, detail, o.ok ?? true, file, hash]);
      };

      let navDocument: string | null = null;
      let report: Report | null = null;
      let error: string | null = null;
      let note: string | null = null;
      try {
        const problem = setupProblem(s, co[0]?.nav_company);
        if (problem) throw new Error(`Parking setup: ${problem}.`);
        const password = await savedPassword(setupId);
        await mkdir(dir, { recursive: true });

        const browser = await chromium.launch();
        try {
          page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
          let file: string;
          try {
            await signIn(page, { portalUrl: s.portalUrl, username: s.username, password }, log);
            file = await exportReport(page, s.portalUrl, date, dir, log);
            page = null;
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            if (!failedStep) await log("Stopped here", m.split("\n")[0], { shot: true, ok: false });
            page = null;
            // Playwright's own errors (timeouts, missing buttons) are the portal's side too.
            throw new Error(/^Parking (portal|setup)/.test(m) ? m : `Parking portal: ${m.split("\n")[0]}`);
          }
          report = await readReport(file, s, date);
          const left = report.ignored.count ? ` ${report.ignored.count} not counted (${s.countOnly?.column} not ${s.countOnly?.values.join(" / ")}, RM ${report.ignored.money.toFixed(2)}).` : "";
          await log("Read the file", `${report.rows.length.toLocaleString()} rows.${left} ${report.totals.map((t) => `${t.label} RM ${t.net.toFixed(2)}`).join(" · ")}`, { ok: !report.problem });
        } finally {
          await browser.close();
        }

        // Raw rows first: kept even if NAV then refuses the draft.
        await client.query("begin");
        await client.query(`delete from parking_transactions where setup_id = $1 and report_date = $2`, [setupId, date]);
        await client.query(
          `insert into parking_transactions (setup_id, report_date, row_no, data) select $1, $2, (x->>'rowNo')::int, x->'data' from jsonb_array_elements($3::jsonb) x`,
          [setupId, date, JSON.stringify(report.rows)],
        );
        await client.query("commit");
        // Rows are kept (so the setup screen can suggest their payment types), but no draft that misses money is made.
        if (report.problem) throw new Error(report.problem);

        if (report.lines.length) {
          try {
            navDocument = await createNavDraft(co[0].nav_company, { type: "Sales", partyNo: s.customerNo, yourReference: `Parking ${date}`, postingDate: date, assignedUserId: "", lines: report.lines });
          } catch (e) {
            await log("Create the NAV draft", e instanceof Error ? e.message : String(e), { ok: false });
            throw e;
          }
          await log("Create the NAV draft", `${navDocument} in ${co[0].nav_company}, customer ${s.customerNo}, ${report.lines.length} lines, RM ${report.lines.reduce((a, l) => a + l.unitPrice, 0).toFixed(2)} in total`);
        } else {
          note = "No paid transactions on this day, so no draft was needed.";
          await log("Create the NAV draft", note);
        }
      } catch (e) {
        await client.query("rollback").catch(() => {});
        error = e instanceof Error ? e.message : String(e);
        if (!failedStep) await log("Stopped", error, { ok: false }).catch(() => {});
      }

      const errorCode = error ? classify(error) : null;
      const result = error ? "Failed" : "Created";
      await db.query(
        `update parking_runs set result = $2, nav_document_no = $3, error = $4, error_code = $5, note = $6, totals = $7, row_count = $8 where id = $1`,
        [runId, result, navDocument, error, errorCode, note, report && JSON.stringify(report.totals), report?.rows.length ?? null],
      );
      return { result, navDocument, error, errorCode, existing: false, runId };
    } finally {
      await client.query(`select pg_advisory_unlock(7103, $1)`, [lockKey]);
    }
  } finally {
    client.release();
  }
}

// A failed run whose next automatic attempt is due in `minutes`.
export async function markRetry(runId: number, minutes: number) {
  await db.query(`update parking_runs set retry_at = now() + make_interval(mins => $2) where id = $1`, [runId, minutes]);
}

// A run still marked Running when the portal starts was cut off (the portal stopped mid-run).
export async function closeInterruptedRuns() {
  await db.query(
    `update parking_runs set result = 'Failed', error_code = 'PARKING_PORTAL',
       error = 'Parking portal: the portal was stopped while this run was in progress. The next run tries this day again.'
     where result = 'Running'`,
  );
}

// Report dates from `from` to `to` that have no draft yet for this setup, oldest first.
export async function missingParkingDates(setupId: number, from: string, to: string): Promise<string[]> {
  const { rows } = await db.query<{ d: string }>(
    `select to_char(d, 'YYYY-MM-DD') as d from generate_series($2::date, $3::date, interval '1 day') d
     where not exists (select 1 from parking_runs r where r.setup_id = $1 and r.report_date = d::date and r.result = 'Created') order by d`,
    [setupId, from, to],
  );
  return rows.map((r) => r.d);
}

// Checks each file of a run against the fingerprint taken when it was written.
export async function verifyRunFiles(runId: number): Promise<Record<number, "ok" | "changed" | "removed">> {
  const { rows } = await db.query<{ seq: number; file: string; sha256: string; folder: string }>(
    `select s.seq, s.file, s.sha256, r.folder from parking_run_steps s join parking_runs r on r.id = s.run_id where s.run_id = $1 and s.file is not null and s.sha256 is not null`,
    [runId],
  );
  const out: Record<number, "ok" | "changed" | "removed"> = {};
  for (const r of rows) {
    const body = await readFile(path.join(PARKING_DIR, r.folder, r.file)).catch(() => null);
    out[r.seq] = !body ? "removed" : sha256(body) === r.sha256 ? "ok" : "changed";
  }
  return out;
}
