import { defineConfig, devices } from "@playwright/test";

// Exercise the same browser-only bundle shipped by the AirHop relay image.
export default defineConfig({
  testDir: "./tests/public-web",
  workers: 1,
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4186" },
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port 4186 --strictPort --outDir ${process.env.AIRHOP_PUBLIC_TEST_DIST ?? "dist-public"}`,
    url: "http://127.0.0.1:4186",
    reuseExistingServer: false,
  },
});
