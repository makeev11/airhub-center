import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/chat-demo",
  outputDir: "./test-results/chat-demo",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4191",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
    {
      name: "android",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "node --experimental-strip-types scripts/preview-chat-demo.mjs",
    env: { CHAT_DEMO_PORT: "4191" },
    url: "http://127.0.0.1:4191/chat",
    reuseExistingServer: false,
  },
});
