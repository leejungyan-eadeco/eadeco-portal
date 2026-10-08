// Reads for pages (server only).
import { db } from "./db";
import { setupSelect } from "./parking";
import type { Company, ParkingRun, ParkingSetupRow, RecurringInvoice, Run } from "./types";

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

export async function listParkingSetups(): Promise<ParkingSetupRow[]> {
  const { rows } = await db.query(
    `select s.*, c.name as "companyName", s2.updated_by as "updatedBy", to_char(s2.updated_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD"T"HH24:MI') as "updatedAt",
            to_char(r.report_date, 'YYYY-MM-DD') as "lastRunDate", r.result as "lastResult"
     from (${setupSelect}) s
     join parking_setups s2 on s2.id = s.id
     left join companies c on c.code = s."companyCode"
     left join lateral (select report_date, result from parking_runs where setup_id = s.id order by ran_at desc limit 1) r on true
     order by s.name`,
  );
  return rows;
}

export async function listParkingRuns(limit = 400): Promise<ParkingRun[]> {
  const { rows } = await db.query(
    `select r.id, r.setup_id as "setupId", coalesce(s.name, r.settings->>'name') as "setupName",
            to_char(r.ran_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD"T"HH24:MI') as at, to_char(r.report_date, 'YYYY-MM-DD') as "reportDate",
            r.result, r.nav_document_no as "navDocument", r.error, r.error_code as "errorCode", r.note, r.folder, r.totals,
            r.row_count as "rowCount", r.triggered_by as "triggeredBy", r.settings, c.name as "companyName",
            coalesce((select json_agg(json_build_object('seq', x.seq, 'at', to_char(x.at at time zone 'Asia/Kuala_Lumpur', 'HH24:MI:SS'), 'step', x.step,
                        'detail', x.detail, 'ok', x.ok, 'file', x.file, 'sha256', x.sha256) order by x.seq)
                      from parking_run_steps x where x.run_id = r.id), '[]') as steps
     from parking_runs r left join parking_setups s on s.id = r.setup_id left join companies c on c.code = r.settings->>'companyCode'
     order by r.ran_at desc limit $1`,
    [limit],
  );
  return rows;
}
