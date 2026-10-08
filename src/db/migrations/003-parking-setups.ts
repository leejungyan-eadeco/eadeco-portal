// Migration 003: parking reports become setups that users manage themselves (one per carpark / portal account),
// each with its own schedule, plus an evidence log of every run and a log of every settings change.
export const sql = `
create table parking_setups (
  id            int generated always as identity primary key,
  name          text not null unique,
  portal_url    text not null,
  username      text not null default '',
  password_enc  text,                       -- AES-256-GCM with CREDENTIALS_KEY (.env); never sent to the browser
  company_code  text references companies (code),
  customer_no   text not null default '',
  start_date    date not null default current_date - 1,  -- no report before this day is fetched
  header_row    int  not null default 11 check (header_row between 1 and 100),
  columns       jsonb not null,             -- { net, sst, type }: the header text of each column, found by name
  lines         jsonb not null default '[]',-- [{ label, values: [payment types], glAccount, description, dim1, dim2 }]
  status        text not null default 'Paused' check (status in ('Active', 'Paused')),
  schedule      text not null default '0 7 * * *',      -- 5-field cron, Malaysia time
  catch_up_days int  not null default 2 check (catch_up_days between 0 and 31),
  created_by    text not null,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now()
);
insert into parking_setups (name, portal_url, company_code, customer_no, header_row, columns, lines, created_by)
select 'PALO 101 Ipoh', portal_url, company_code, customer_no, header_row,
       jsonb_build_object('net', net_header, 'sst', sst_header, 'type', type_header), lines, 'migration'
from parking_settings;

alter table parking_runs add column setup_id int references parking_setups (id);
alter table parking_runs add column settings jsonb;   -- the setup as it was when this run used it (evidence)
update parking_runs set setup_id = (select min(id) from parking_setups);
alter table parking_runs alter column setup_id set not null;
drop index parking_runs_one_created;
create unique index parking_runs_one_created on parking_runs (setup_id, report_date) where result = 'Created';

-- Evidence: every step of a run, in order. Files are on the server's disk under STORAGE_DIR/parking/<folder>/;
-- sha256 proves a file is the one the run wrote.
create table parking_run_steps (
  run_id  int  not null references parking_runs (id) on delete cascade,
  seq     int  not null,
  at      timestamptz not null,
  step    text not null,
  detail  text not null default '',
  ok      boolean not null default true,
  file    text,
  sha256  text,
  primary key (run_id, seq)
);
insert into parking_run_steps (run_id, seq, at, step, file)
select r.id, s.n, r.ran_at, replace(regexp_replace(s.f, '^\\d+-|\\.png$', '', 'g'), '-', ' '), s.f
from parking_runs r, jsonb_array_elements_text(r.steps) with ordinality s(f, n);
alter table parking_runs drop column steps;

alter table parking_transactions add column setup_id int references parking_setups (id);
update parking_transactions set setup_id = (select min(id) from parking_setups);
alter table parking_transactions alter column setup_id set not null;
alter table parking_transactions drop constraint parking_transactions_pkey;
alter table parking_transactions add primary key (setup_id, report_date, row_no);

-- Who changed which setup, when, and what: { field: { before, after } }. Kept after a setup is deleted.
create table parking_setup_changes (
  id          int generated always as identity primary key,
  setup_id    int not null,
  setup_name  text not null,
  at          timestamptz not null default now(),
  changed_by  text not null,
  action      text not null check (action in ('Created', 'Changed', 'Paused', 'Resumed', 'Deleted')),
  changes     jsonb not null default '{}'
);
create index on parking_setup_changes (setup_id, at desc);
insert into parking_setup_changes (setup_id, setup_name, changed_by, action) select id, name, 'migration', 'Created' from parking_setups;

drop table parking_settings;
delete from scheduled_jobs where key = 'parking-report';   -- each setup has its own schedule now
`;
