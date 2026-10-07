// Reads for pages (server only).
import { db } from "./db";
import type { Company, RecurringInvoice, Run } from "./types";

export async function listCompanies(): Promise<Company[]> {
  const { rows } = await db.query(`select code, name, nav_company as "navCompany", active from companies order by code`);
  return rows;
}

export async function listInvoices(): Promise<RecurringInvoice[]> {
  const { rows } = await db.query(`
    select i.id, i.company_code as company, c.name as "companyName", i.type, i.party_no as "partyNo", i.party_name as "partyName",
           i.your_reference as "yourReference", i.frequency, i.weekday, i.month_day as "monthDay",
           to_char(i.start_date, 'YYYY-MM-DD') as "startDate", to_char(i.end_date, 'YYYY-MM-DD') as "endDate",
           to_char(i.next_date, 'YYYY-MM-DD') as "nextDate", i.status,
           coalesce(json_agg(json_build_object(
             'type', l.type, 'no', l.no, 'description', l.description, 'locationCode', l.location_code,
             'quantity', l.quantity, 'unitOfMeasure', l.unit_of_measure, 'unitPrice', l.unit_price,
             'lineDiscountPct', l.line_discount_pct, 'dim1', l.dim1, 'dim2', l.dim2
           ) order by l.line_no) filter (where l.invoice_id is not null), '[]') as lines
    from recurring_invoices i
    join companies c on c.code = i.company_code
    left join recurring_invoice_lines l on l.invoice_id = i.id
    group by i.id, c.name
    order by i.id desc`);
  return rows;
}

export async function listRuns(limit = 200): Promise<Run[]> {
  const { rows } = await db.query(
    `select r.id, to_char(r.ran_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD"T"HH24:MI') as at, r.invoice_id as "invoiceId",
            i.company_code as company, c.name as "companyName", i.party_name as "partyName", to_char(r.period_date, 'YYYY-MM-DD') as "periodDate",
            r.result, r.nav_document_no as "navDocument", r.error, r.error_code as "errorCode", r.note, r.triggered_by as "triggeredBy"
     from invoice_runs r join recurring_invoices i on i.id = r.invoice_id join companies c on c.code = i.company_code
     order by r.ran_at desc limit $1`,
    [limit],
  );
  return rows;
}
