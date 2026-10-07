// `pnpm db:migrate`: apply pending migrations without starting the portal (e.g. before a deploy).
import { Pool } from "pg";
import { migrate } from "./migrate";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
migrate(pool)
  .then((applied) => console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date."))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
