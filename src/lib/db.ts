import { Pool } from "pg";

// One pool per process, cached on globalThis so dev reloads don't leak connections.
const g = globalThis as unknown as { pool?: Pool };
export const db = (g.pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));
