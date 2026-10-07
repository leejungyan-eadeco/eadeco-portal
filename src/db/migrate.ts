// Applies the migrations that have not run yet. Called when the server starts and by `pnpm db:migrate`.
import type { Pool } from "pg";
import { migrations } from "./migrations";

export async function migrate(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    // One server at a time: a second one waits here, then finds nothing left to do.
    await client.query(`select pg_advisory_lock(7102)`);
    await client.query(`create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())`);
    const { rows } = await client.query<{ id: string }>(`select id from schema_migrations`);
    const done = new Set(rows.map((r) => r.id));
    const applied: string[] = [];
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      try {
        await client.query("begin");
        await client.query(m.sql);
        await client.query(`insert into schema_migrations (id) values ($1)`, [m.id]);
        await client.query("commit");
        applied.push(m.id);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`Database migration ${m.id} failed and was rolled back: ${e instanceof Error ? e.message : e}`);
      }
    }
    return applied;
  } finally {
    await client.query(`select pg_advisory_unlock(7102)`).catch(() => {});
    client.release();
  }
}
