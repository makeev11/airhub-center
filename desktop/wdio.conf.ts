import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { Options } from "@wdio/types";

const appIdentifier = "ru.airhop.centers.e2e.task12";
const userHome = homedir();
const builtAppBinary = resolve("src-tauri/target/debug/buzz-desktop");
// Keep a recognised executable basename. The managed-agent orphan reaper
// deliberately recognises `buzz_desktop` as a live owner process; giving the
// copied WebDriver binary an arbitrary name made another open AirHop instance
// classify this perfectly healthy E2E app as dead and terminate all four
// Welcome runtimes.
// A per-run directory still gives WebDriver its own immutable binary copy.
const e2eAppDirectory = resolve(
  `src-tauri/target/debug/airhop-e2e-task12-${process.pid}`,
);
mkdirSync(e2eAppDirectory, { recursive: true });
const e2eExecutableName = "buzz_desktop";
const e2eAppBinary = join(e2eAppDirectory, e2eExecutableName);
copyFileSync(builtAppBinary, e2eAppBinary);
// Mirror the release layout: native command resolution intentionally looks
// beside the desktop executable for bundled sidecars. Without these copies the
// Welcome agents can connect to the relay but cannot load airhop-agent-mcp and
// therefore cannot publish their stage messages.
for (const sidecar of ["airhop-agent-mcp", "buzz", "buzz-acp", "buzz-agent"]) {
  copyFileSync(
    resolve(`src-tauri/target/debug/${sidecar}`),
    join(e2eAppDirectory, sidecar),
  );
}
const appDataDir = join(
  userHome,
  "Library",
  "Application Support",
  appIdentifier,
);
const appStatePaths = [
  appDataDir,
  join(userHome, "Library", "Caches", appIdentifier),
  // WKWebView keys these stores by executable name rather than the Tauri
  // identifier. Keep them E2E-only and reset the exact paths this binary uses.
  join(userHome, "Library", "Caches", e2eExecutableName),
  join(userHome, "Library", "WebKit", e2eExecutableName),
  join(userHome, "Library", "HTTPStorages", appIdentifier),
  join(
    userHome,
    "Library",
    "Saved Application State",
    `${appIdentifier}.savedState`,
  ),
  join(userHome, "Library", "Preferences", `${appIdentifier}.plist`),
];

function resetE2eAppState() {
  for (const statePath of appStatePaths) {
    rmSync(statePath, { force: true, recursive: true });
  }
}

const fakeLlmUrl = process.env.AIRHOP_E2E_FAKE_LLM_URL;
if (!fakeLlmUrl) {
  throw new Error("AIRHOP_E2E_FAKE_LLM_URL is required");
}

export const config: Options.Testrunner = {
  runner: "local",
  specs: ["./tests/e2e/airhop-welcome-agent-team.spec.ts"],
  maxInstances: 1,
  logLevel: "error",
  capabilities: [{ browserName: "tauri" }],
  services: [
    [
      "tauri",
      {
        // The orphan reaper verifies a foreign desktop owner by finding its
        // bundle identifier in argv/env. Production launchers already expose
        // that metadata; the embedded WebDriver launcher needs it explicitly.
        appArgs: [appIdentifier],
        appBinaryPath: e2eAppBinary,
        driverProvider: "embedded",
        embeddedPort: 4445,
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 300_000 },
  waitforTimeout: 120_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  onPrepare() {
    resetE2eAppState();
    const agentsDir = join(appDataDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, "global-agent-config.json"),
      `${JSON.stringify(
        {
          env_vars: {
            BUZZ_AGENT_LLM_TIMEOUT_SECS: "10",
            BUZZ_AGENT_MAX_ROUNDS: "3",
            BUZZ_AGENT_TOOL_TIMEOUT_SECS: "10",
            OPENAI_COMPAT_API: "chat",
            OPENAI_COMPAT_API_KEY: "airhop-e2e",
            OPENAI_COMPAT_BASE_URL: fakeLlmUrl,
          },
          model: "fake-airhop-e2e",
          preferred_runtime: "buzz-agent",
          provider: "openai",
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  },
};
