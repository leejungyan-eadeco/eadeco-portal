// Migration 006: count only paid rows. The report also lists tickets that were never paid (Payment Method "Unpaid",
// Status "not process"); their amounts must not reach the invoice. null = count every row.
// { column, values }: a row counts when its value in `column` is one of `values`.
export const sql = `
alter table parking_setups add column count_only jsonb;
update parking_setups set count_only = '{"column": "Status", "values": ["pay succeed"]}';
`;
