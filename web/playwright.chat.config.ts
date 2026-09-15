import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/chat",
  outputDir: "./test-results/chat",
  timeout: 30_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4187",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
  webServer: {
    command:
      "pnpm exec vite preview --outDir dist-chat --host 127.0.0.1 --port 4187 --strictPort",
    url: "http://127.0.0.1:4187/chat",
    reuseExistingServer: false,
  },
});
