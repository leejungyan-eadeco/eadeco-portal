import { mkdir } from "node:fs/promises";
import { test } from "@playwright/test";
import { exportReport, sampleFromFile, signIn, type StepLog } from "../src/lib/parking";

// Runs the portal's own parking portal steps in a visible browser: pnpm.cmd test:e2e --headed
// Doesn't touch the database or NAV; the file goes to downloads/. Uses CARPARK_PORTAL_USERNAME / _PASSWORD from .env.
const portalUrl = "http://palo101.park.whizcity.my:8081";

test("downloads and reads yesterday's parking report", async ({ page }) => {
  const { CARPARK_PORTAL_USERNAME: username, CARPARK_PORTAL_PASSWORD: password } = process.env;
  test.skip(!username || !password, "Set CARPARK_PORTAL_USERNAME and CARPARK_PORTAL_PASSWORD in .env");
  test.setTimeout(240_000);
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  await mkdir("downloads", { recursive: true });
  const log: StepLog = async (step, detail) => console.log(`${step}: ${detail}`);

  await signIn(page, { portalUrl, username: username!, password: password! }, log);
  const file = await exportReport(page, portalUrl, yesterday, "downloads", log);
  const sample = await sampleFromFile(file, yesterday, 11, { net: "Base Fee C1(RM)", sst: "SST C2(RM)", type: "Payment Type" });
  console.table(sample.types);
});
