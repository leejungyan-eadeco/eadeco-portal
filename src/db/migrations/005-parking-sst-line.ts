// Migration 005: optional SST line on parking drafts. Finance puts the day's SST from the report on its own line
// (e.g. 211-600000 SST payable) instead of NAV's VAT, so the invoice total equals the report's.
// null = no SST line. { glAccount, description, dim1, dim2 }
export const sql = `
alter table parking_setups add column sst_line jsonb;
`;
