// Runs once when the Next.js server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { db } = await import("./lib/db");
  const { migrate } = await import("./db/migrate");
  try {
    const applied = await migrate(db);
    if (applied.length) console.log(`Database migrations applied: ${applied.join(", ")}`);
    // Seed values (not schema): the NAV address from .env the first time, and every web service name.
    const { navServiceDefs } = await import("./lib/nav");
    if (process.env.NAV_BASE_URL) await db.query(`insert into nav_settings (base_url) values ($1) on conflict do nothing`, [process.env.NAV_BASE_URL.replace(/\/+$/, "")]);
    await db.query(`insert into nav_services (key, service_name) select * from unnest($1::text[], $2::text[]) on conflict do nothing`, [
      navServiceDefs.map((d) => d.key),
      navServiceDefs.map((d) => d.fallback),
    ]);
  } catch (e) {
    console.error("Could not set up the portal database. Is it running (docker compose up -d db)?", e);
    return;
  }
  const { startScheduler } = await import("./lib/scheduler");
  try {
    await startScheduler();
  } catch (e) {
    console.error("Could not start the scheduler (DBOS). Recurring invoices will not run on their own until it starts.", e);
  }
}
