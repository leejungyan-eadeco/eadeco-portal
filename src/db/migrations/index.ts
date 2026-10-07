// Database changes, oldest first. Each runs once, in its own transaction, and is recorded in schema_migrations.
//
// To change the database: add a file 002-what-it-does.ts exporting `sql`, and add it to the end of this list.
// Never edit or reorder a migration that has already run anywhere; fix things with a new one.
import { sql as baseline } from "./001-baseline";

export const migrations: { id: string; sql: string }[] = [{ id: "001-baseline", sql: baseline }];
