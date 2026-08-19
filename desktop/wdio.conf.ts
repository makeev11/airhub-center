import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { Options } from "@wdio/types";

const appIdentifier = "ru.airhop.centers.e2e.task12";
const userHome = homedir();
const builtAppBinary = resolve("src-tauri/target/debug/buzz-desktop");
const e2eAppBinary = resolve(
  `src-tauri/target/debug/buzz-desktop-e2e-task12-${process.pid}`,
);
copyFileSync(builtAppBinary, e2eAppBinary);
const appDataDir = join(
  userHome,
  "Library",
  "Application Support",
  appIdentifier,
);
const appStatePaths = [
  appDataDir,
  join(userHome, "Library", "Caches", appIdentifier),
  join(userHome, "Library", "WebKit", "buzz-desktop-e2e-task12"),
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
