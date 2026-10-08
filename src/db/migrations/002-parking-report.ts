// Migration 002: the daily parking report (WhizzParking export -> one NAV sales invoice draft per day).
export const sql = `
-- One row: where the report comes from, how to read it, and where its money goes in NAV.
-- The portal's sign-in to the parking portal stays in .env (CARPARK_PORTAL_USERNAME / _PASSWORD).
create table parking_settings (
  id            boolean primary key default true check (id),
  portal_url    text not null,
  company_code  text references companies (code),
  customer_no   text not null default '',
  header_row    int  not null default 11 check (header_row between 1 and 100),
  -- Each amount is read from a column letter, and the header text there must match, so a changed export
  -- stops the run instead of reading the wrong numbers.
  net_column    text not null default 'J', net_header  text not null default 'Base Fee C1(RM)',
  sst_column    text not null default 'K', sst_header  text not null default 'SST C2(RM)',
  type_column   text not null default 'O', type_header text not null default 'Payment Type',
  -- NAV lines: [{ label, values: [payment types], glAccount, description, dim1, dim2 }]
  lines         jsonb not null default '[]',
  updated_by    text,
  updated_at    timestamptz not null default now()
);
-- Payment Scheme (column Q) is blank for TNG Seamless, so the lines go by Payment Type (column O).
insert into parking_settings (portal_url, lines) values ('http://palo101.park.whizcity.my:8081', '[
  {"label": "TNG", "values": ["TNG Card"], "glAccount": "", "description": "", "dim1": "", "dim2": ""},
  {"label": "TNG Seamless", "values": ["TNG Seamless"], "glAccount": "", "description": "", "dim1": "", "dim2": ""},
  {"label": "VISA", "values": ["EMV"], "glAccount": "", "description": "", "dim1": "", "dim2": ""}
]');

create table parking_runs (
  id              int generated always as identity primary key,
  report_date     date not null,
  result          text not null check (result in ('Created', 'Failed')),
  nav_document_no text,                  -- null on a Created run when the day had no paid transactions
  error           text,
  error_code      text,                  -- see src/lib/nav-errors.ts
  note            text,
  folder          text,                  -- under STORAGE_DIR: the Excel file (kept) and step screenshots (30 days)
  steps           jsonb not null default '[]',  -- screenshot file names, in order
  totals          jsonb,                 -- [{ label, count, net, sst }] in RM
  row_count       int,
  triggered_by    text not null,
  ran_at          timestamptz not null default now()
);
create unique index parking_runs_one_created on parking_runs (report_date) where result = 'Created';

-- Every row of each day's export as it came, keyed by its header text. Replaced if the day is fetched again
-- (only possible while no draft exists for it).
create table parking_transactions (
  report_date date not null,
  row_no      int  not null,             -- Excel row number
  data        jsonb not null,
  primary key (report_date, row_no)
);

-- Off until the settings above are filled in. Makes up the 2 days before yesterday if they were missed.
insert into scheduled_jobs (key, enabled, catch_up_days) values ('parking-report', false, 2) on conflict do nothing;
`;
