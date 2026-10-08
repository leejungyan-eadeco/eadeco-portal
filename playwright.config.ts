import { defineConfig } from "@playwright/test";

// Credentials (CARPARK_PORTAL_*) come from .env, never from the test files.
process.loadEnvFile(".env");

export default defineConfig({
  testDir: "e2e",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
