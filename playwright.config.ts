import { defineConfig, devices } from "@playwright/test";

process.env.PW_TEST_PORT_OFFSET ??= String(Math.floor(Math.random() * 400));
const testRunOffset = Number(process.env.PW_TEST_PORT_OFFSET);
const testWebPort = Number(process.env.PW_WEB_PORT ?? 5174 + testRunOffset);
const testWebBase = `http://127.0.0.1:${testWebPort}`;
const testDatabasePath = process.env.PW_DATABASE_PATH ?? `data/e2e-${process.pid}-${testRunOffset}.sqlite`;
const aiMock = process.env.AI_TEST_MOCK === "1";

process.env.TEST_API_BASE ??= testWebBase;

export default defineConfig({
  testDir: "./tests",
  timeout: aiMock ? 8_000 : 60_000,
  expect: {
    timeout: aiMock ? 2_000 : 30_000
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: testWebBase,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "android-tablet",
      use: {
        ...devices["Galaxy Tab S4"],
        viewport: { width: 1000, height: 720 }
      }
    }
  ],
  webServer: {
    command: "bun scripts/dev.ts",
    url: `${testWebBase}/api/health`,
    reuseExistingServer: false,
    timeout: 5_000,
    env: {
      PORT: String(testWebPort),
      DATABASE_PATH: testDatabasePath,
      RESET_DB_ON_START: "1",
      ALLOW_TEST_DOCUMENT_CREATE: "1",
      ...(aiMock ? { AI_TEST_MOCK: "1" } : {}),
      NODE_ENV: "test"
    }
  }
});
