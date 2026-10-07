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

## Database changes (migrations)

Migrations live in `src/db/migrations/`, oldest first. Each runs once, in its own transaction, and is recorded in the `schema_migrations` table. They run automatically when the portal starts, or by hand:

```bash
pnpm db:migrate
```

To change the database, add a new file such as `002-add-invoice-notes.ts` exporting `sql`, and add it to the end of the list in `src/db/migrations/index.ts`. Never edit or reorder a migration that has already run; fix mistakes with a new one.

Next.js 16, React 19, Tailwind 4, Phosphor icons. Parking reports is disabled until its approach is decided.

## Login and access

1. Staff sign in through EADECO's central login, **Keycloak** (OpenID Connect; `src/lib/oidc.ts`, `src/app/auth/`).
   Keycloak checks the Windows password against AD, so the portal never sees it. People already signed in to
   another EADECO app go straight in.
2. Keycloak also decides who gets in and their role, through the client `eadepro-portal` and its client roles:
   **user** (recurring invoices, run history) or **admin** (also companies, NAV connection, scheduler). Keycloak
   blocks people with neither.
3. At each sign-in the portal copies name, email and role into its `users` table (Settings > Users is a read-only
   view of it). A signed token in an httpOnly cookie keeps people signed in for a working day (8 hours).
   `src/proxy.ts` checks the token *and* the table on every request; `/settings` is admin-only, and every server action
   checks again. Changes made in Keycloak apply at the person's next sign-in.

Settings: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (see `.env.example`). For a local Keycloak to test
against, see `C:\Dev\work\keycloak-playground`. Set `COOKIE_SECURE=true` once the portal is served over HTTPS.
