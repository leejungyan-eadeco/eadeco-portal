// Migration 001: every table as of 7 Oct 2026. Written to be safe on a database that already has some or all
// of it (the portal ran this as a startup script before migrations existed), so it applies cleanly everywhere.
// Do not edit: add a new migration instead (see src/db/migrations/index.ts).
export const sql = `
-- Who may use the portal. AD checks the password; this list decides access and role.
create table if not exists users (
  username      text primary key check (username ~ '^[a-z0-9._-]{1,64}$'),  -- AD sAMAccountName, lowercase
  display_name  text,                                                       -- filled from AD at sign-in
  email         text,
  role          text not null check (role in ('admin', 'user')),
  active        boolean not null default true,
  invited_by    text not null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists companies (
  code        text primary key,
  name        text not null,
  nav_company text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- NAV web service names, editable in Settings > NAV connection (missing rows fall back to standard names).
-- The NAV server address (one row). Sign-in stays in .env so no password is ever in the database.
create table if not exists nav_settings (
  id          boolean primary key default true check (id),
  base_url    text not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create table if not exists nav_services (
  key          text primary key,
  service_name text not null,
  updated_at   timestamptz not null default now()
);

create table if not exists recurring_invoices (
  id             int generated always as identity primary key,
  company_code   text not null references companies (code),
  type           text not null check (type in ('Sales', 'Purchase')),
  party_no       text not null,
  party_name     text not null,
  your_reference text not null default '',
  frequency      text not null check (frequency in ('Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly')),
  weekday        int  not null default 0 check (weekday between 0 and 6),
  month_day      int  not null default 1 check (month_day between 0 and 28),
  start_date     date not null,
  end_date       date check (end_date is null or end_date >= start_date),
  next_date      date,
  status         text not null default 'Active' check (status in ('Active', 'Paused', 'Ended')),
  created_by     text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists recurring_invoice_lines (
  invoice_id        int not null references recurring_invoices (id) on delete cascade,
  line_no           int not null,
  type              text not null check (type in ('', 'G/L Account', 'Item', 'Resource', 'Fixed Asset', 'Charge (Item)')),
  no                text not null default '',
  description       text not null default '',
  location_code     text not null default '',
  quantity          numeric(18, 5) not null default 0 check (quantity >= 0),
  unit_of_measure   text not null default '',
  unit_price        numeric(18, 5) not null default 0 check (unit_price >= 0),
  line_discount_pct numeric(5, 2)  not null default 0 check (line_discount_pct between 0 and 100),
  dim1              text not null default '',
  dim2              text not null default '',
  primary key (invoice_id, line_no)
);

-- Scheduled jobs, one row each (today: recurring invoice drafts; later: parking reports).
-- schedule is 5-field cron in Malaysia time. The live schedules are in DBOS's tables (schema "dbos").
create table if not exists scheduled_jobs (
  key            text primary key,
  enabled        boolean not null default true,
  schedule       text not null default '0 7 * * *',
  catch_up_days  int not null default 7 check (catch_up_days between 0 and 31),
  updated_by     text,
  updated_at     timestamptz not null default now()
);
-- One-off move from the earlier single-scheduler table.
do $$ begin
  if to_regclass('scheduler_settings') is not null then
    insert into scheduled_jobs (key, enabled, schedule, catch_up_days, updated_by)
    select 'recurring-invoices', enabled, split_part(run_at, ':', 2)::int || ' ' || split_part(run_at, ':', 1)::int || ' * * *', catch_up_days, updated_by
    from scheduler_settings
    on conflict (key) do nothing;
    drop table scheduler_settings;
  end if;
end $$;
insert into scheduled_jobs (key) values ('recurring-invoices') on conflict do nothing;

create table if not exists invoice_runs (
  id              int generated always as identity primary key,
  invoice_id      int not null references recurring_invoices (id),
  period_date     date not null,
  result          text not null check (result in ('Created', 'Failed')),
  nav_document_no text,
  error           text,
  ran_at          timestamptz not null default now()
);
alter table invoice_runs add column if not exists note text;             -- e.g. why Assigned User ID was left blank
alter table invoice_runs add column if not exists triggered_by text;
alter table invoice_runs add column if not exists error_code text;       -- see src/lib/nav-errors.ts     -- "Run now by <name>" or "Scheduler"
-- One draft per invoice per period; failed attempts may repeat.
create unique index if not exists invoice_runs_one_created on invoice_runs (invoice_id, period_date) where result = 'Created';
`;
