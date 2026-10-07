// Creating a recurring invoice's draft in NAV. Used by Run now and the daily scheduler.
import type { PoolClient } from "pg";
import { db } from "./db";
import { createNavDraft } from "./nav";
import { classify } from "./nav-errors";
import { nextRun } from "./schedule";
import type { Frequency, InvoiceType, Line } from "./types";

export type RunOutcome = { result: "Created" | "Failed"; navDocument: string | null; error: string | null; errorCode: string | null; note: string | null; existing: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
const navUser = (username: string) => `EADECO\\${username.toUpperCase()}`;
const userSetupError = (m: string) => /assigned user id|user setup/i.test(m);

// A draft on the scheduled date counts as that run, so the schedule moves on to the next date.
async function moveOn(client: PoolClient, invoiceId: number, periodDate: string) {
  const { rows } = await client.query(
    `select frequency, weekday, month_day as "monthDay", to_char(start_date, 'YYYY-MM-DD') as "startDate", to_char(end_date, 'YYYY-MM-DD') as "endDate"
     from recurring_invoices where id = $1 and status = 'Active' and next_date = $2`,
    [invoiceId, periodDate],
  );
  if (!rows[0]) return;
  const next = nextRun(rows[0], addDay(periodDate));
  await client.query(`update recurring_invoices set next_date = $2, status = case when $2::date is null then 'Ended' else status end, updated_at = now() where id = $1`, [invoiceId, next]);
}

// One draft per invoice per date: a second run for the same date returns the first draft instead of making another.
// patient: wait and retry NAV outages and busy errors twice (30 s, 90 s) before recording a failure, so a short
// hiccup never shows up. The scheduler is patient; Run now is not, because someone is waiting for the answer.
export async function runInvoice(invoiceId: number, periodDate: string, assignTo: string, trigger: string, patient = false): Promise<RunOutcome> {
  const client = await db.connect();
  try {
    // Two clicks at once must not both reach NAV.
    const { rows: lock } = await client.query<{ ok: boolean }>(`select pg_try_advisory_lock(7101, $1) as ok`, [invoiceId]);
    if (!lock[0].ok) throw new Error("This invoice is already being created in NAV. Wait a moment and refresh.");
    try {
      const { rows: done } = await client.query(
        `select nav_document_no as "navDocument" from invoice_runs where invoice_id = $1 and period_date = $2 and result = 'Created'`,
        [invoiceId, periodDate],
      );
      if (done[0]) {
        await moveOn(client, invoiceId, periodDate);
        return { result: "Created", navDocument: done[0].navDocument, error: null, errorCode: null, note: null, existing: true };
      }

      const { rows } = await client.query<{
        navCompany: string; type: InvoiceType; partyNo: string; yourReference: string; frequency: Frequency; weekday: number; monthDay: number;
        startDate: string; endDate: string | null; nextDate: string | null; status: string; lines: Line[];
      }>(
        `select c.nav_company as "navCompany", i.type, i.party_no as "partyNo", i.your_reference as "yourReference",
                i.frequency, i.weekday, i.month_day as "monthDay", to_char(i.start_date, 'YYYY-MM-DD') as "startDate",
                to_char(i.end_date, 'YYYY-MM-DD') as "endDate", to_char(i.next_date, 'YYYY-MM-DD') as "nextDate", i.status,
                (select json_agg(json_build_object('type', l.type, 'no', l.no, 'description', l.description, 'locationCode', l.location_code,
                   'quantity', l.quantity::float, 'unitOfMeasure', l.unit_of_measure, 'unitPrice', l.unit_price::float,
                   'lineDiscountPct', l.line_discount_pct::float, 'dim1', l.dim1, 'dim2', l.dim2) order by l.line_no)
                 from recurring_invoice_lines l where l.invoice_id = i.id) as lines
         from recurring_invoices i join companies c on c.code = i.company_code where i.id = $1`,
        [invoiceId],
      );
      const inv = rows[0];
      if (!inv) throw new Error("This recurring invoice no longer exists.");

      const draft = { type: inv.type, partyNo: inv.partyNo, yourReference: inv.yourReference, postingDate: periodDate, lines: inv.lines ?? [] };
      let navDocument: string | null = null;
      let error: string | null = null;
      let note: string | null = null;
      const waits = patient ? [30_000, 90_000] : [];
      for (let attempt = 0; ; attempt++) {
        try {
          try {
            navDocument = await createNavDraft(inv.navCompany, { ...draft, assignedUserId: assignTo ? navUser(assignTo) : "" });
          } catch (e) {
            // NAV only accepts users in its User Setup; still create the draft, and NAV assigns it to the portal account.
            if (!(e instanceof Error) || !userSetupError(e.message)) throw e;
            navDocument = await createNavDraft(inv.navCompany, { ...draft, assignedUserId: "" });
            note = `${navUser(assignTo)} is not in NAV's User Setup for this company, so NAV assigned the draft to the portal's own NAV account.`;
          }
          error = null;
          break;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          const code = classify(error);
          if (attempt >= waits.length || !(code === "NAV_UNREACHABLE" || code === "NAV_BUSY")) break;
          await sleep(waits[attempt]);
        }
      }
      const errorCode = error ? classify(error) : null;

      const result = navDocument ? "Created" : "Failed";
      await client.query(
        `insert into invoice_runs (invoice_id, period_date, result, nav_document_no, error, error_code, note, triggered_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [invoiceId, periodDate, result, navDocument, error, errorCode, note, trigger],
      );
      if (navDocument) await moveOn(client, invoiceId, periodDate);
      return { result, navDocument, error, errorCode, note, existing: false };
    } finally {
      await client.query(`select pg_advisory_unlock(7101, $1)`, [invoiceId]);
    }
  } finally {
    client.release();
  }
}
