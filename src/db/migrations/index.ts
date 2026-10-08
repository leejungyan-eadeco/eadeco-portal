// Database changes, oldest first. Each runs once, in its own transaction, and is recorded in schema_migrations.
//
// To change the database: add a file 011-what-it-does.ts exporting `sql`, and add it to the end of this list.
// Never edit or reorder a migration that has already run anywhere; fix things with a new one.
import { sql as baseline } from "./001-baseline";
import { sql as parkingReport } from "./002-parking-report";
import { sql as parkingSetups } from "./003-parking-setups";
import { sql as lightPages } from "./004-light-customer-vendor-pages";
import { sql as sstLine } from "./005-parking-sst-line";
import { sql as countOnly } from "./006-parking-count-only";
import { sql as running } from "./007-parking-running";
import { sql as videoStart } from "./008-parking-video-start";
import { sql as dropVideo } from "./009-drop-parking-video";
import { sql as deleted } from "./010-parking-deleted";

export const migrations: { id: string; sql: string }[] = [
  { id: "001-baseline", sql: baseline },
  { id: "002-parking-report", sql: parkingReport },
  { id: "003-parking-setups", sql: parkingSetups },
  { id: "004-light-customer-vendor-pages", sql: lightPages },
  { id: "005-parking-sst-line", sql: sstLine },
  { id: "006-parking-count-only", sql: countOnly },
  { id: "007-parking-running", sql: running },
  { id: "008-parking-video-start", sql: videoStart },
  { id: "009-drop-parking-video", sql: dropVideo },
  { id: "010-parking-deleted", sql: deleted },
];
