import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/chat-app",
  outputDir: "./test-results/chat-app",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4192",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "android",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    { name: "iphone", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command:
      "pnpm exec vite preview --outDir dist-chat-app --host 127.0.0.1 --port 4192 --strictPort",
    url: "http://127.0.0.1:4192/chat",
    reuseExistingServer: false,
  },
});
