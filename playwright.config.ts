import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const testDatabase = `work/e2e-${process.pid}-${Date.now()}.sqlite`;
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3001",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `TAXIDTA_LOAD_LOCAL_ENV=false PORT=3001 TAXIDTA_DB_PATH=${testDatabase} NODE_ENV=production npx tsx server/index.ts`,
    url: "http://127.0.0.1:3001/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
