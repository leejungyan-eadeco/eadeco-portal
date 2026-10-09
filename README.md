# EADEPRO Business Portal

Recurring NAV invoices for every company EADEPRO handles. Invoices are only ever created as drafts in NAV; people review and post them there.

```
pnpm install
cp .env.example .env      # then fill in the NAV_ web service settings
pnpm db:up                # portal's own Postgres in Docker, port 23021
pnpm dev                  # http://localhost:23020 (creates the tables on start)
pnpm check                # schedule date logic self-check
```

## How it fits together

- **Portal database (Postgres):** companies, users, recurring invoices and their lines, run history, the NAV server address and web service names, and the scheduler's settings.
- **NAV 2018, read:** dropdown lists (customers, vendors, G/L accounts, dimensions…) read live from NAV web services. `src/lib/nav.ts`.
- **NAV 2018, write:** drafts are created through NAV's custom invoice services (`ws_WS_SalesInvoice`, `ws_VMS_PurchInv`), never posted. NAV errors are sorted into fixed codes in `src/lib/nav-errors.ts`.
- **Scheduler:** DBOS inside the portal (`src/lib/scheduler.ts`), configured in Settings > Scheduler.
- **Parking report:** each day, Playwright signs in to the parking portal, exports the day's Excel file, and one sales invoice draft is created with a line per payment type group (`src/lib/parking.ts`, Settings > Parking report). Every row is kept in `parking_transactions`; the file and step screenshots go to `STORAGE_DIR` (screenshots kept 30 days). Needs Chromium once per machine: `pnpm exec playwright install chromium`. `pnpm.cmd test:e2e --headed` runs just the download in a visible browser.

## Database changes (migrations)

Migrations live in `src/db/migrations/`, oldest first. Each runs once, in its own transaction, and is recorded in the `schema_migrations` table. They run automatically when the portal starts, or by hand:

```bash
pnpm db:migrate
```

To change the database, add a new file such as `011-add-invoice-notes.ts` exporting `sql`, and add it to the end of the list in `src/db/migrations/index.ts`. Never edit or reorder a migration that has already run; fix mistakes with a new one.

Next.js 16, React 19, Tailwind 4, Phosphor icons.

## Deploy with Docker

The image is built on Playwright's own image, so Chromium for the parking report is included. On the server:

1. Copy `.env.example` to `.env` and fill it in. In Docker, NAV signs in with `NAV_AUTH=windows` and the `NAV_DOMAIN` / `NAV_USERNAME` / `NAV_PASSWORD` account (NTLM). AD needs `AD_TLS_CA` (the CA certificate) and `AD_BIND_DN` / `AD_BIND_PASSWORD` for the user list. Generate `CREDENTIALS_KEY` and keep it backed up. Never set `DEV_SKIP_LOGIN` here.
2. Start the database and the portal:

```bash
docker compose up -d --build
```

The portal listens on `PORTAL_PORT` (23020). Migrations run on start.

**Staging and production** run the same image with different settings: one folder per environment (e.g. `eadepro-staging/` with NAV TEST and `PORTAL_PORT=23030`, `eadepro-production/` with live NAV and 23020), each with its own `.env`, and `docker compose up -d --build` in each. Compose names containers and volumes after the folder, so they never share a database or files. What users test on staging is exactly what goes live. Report files and screenshots are in the `storage` volume, and the database in `pgdata`; back up both. The server must resolve `*.eadeco.local` (NAV, the domain controllers), as the host does.

## Login and access

1. Staff sign in with their Windows (EADECO) account. AD checks the password over LDAPS (`AD_URLS`; the internal CA is
   trusted through the Windows certificate store). Passwords are never stored.
2. The portal's own user list (Settings > Users) then decides who gets in and their role:
   **User** (recurring invoices, run history) or **Admin** (also companies, NAV connection, users).
3. A signed token in an httpOnly cookie keeps people signed in for 1 day. `src/proxy.ts` checks the token *and* the
   user list on every request, so removing someone or changing a role takes effect immediately; `/settings` is admin-only,
   and every server action checks again.

`BOOTSTRAP_ADMINS` (comma-separated AD usernames) are always admins, so there is a way in on a fresh install.
Set `COOKIE_SECURE=true` once the portal is served over HTTPS.
