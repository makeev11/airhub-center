import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const runnerUrl = new URL(
  "./run-airhop-welcome-native-e2e.sh",
  import.meta.url,
);

test("native AirHop runner owns the complete clean-room lifecycle", () => {
  assert.equal(
    existsSync(runnerUrl),
    true,
    "package.json must not point at a missing runner",
  );
  const script = readFileSync(runnerUrl, "utf8");

  assert.match(
    script,
    /start-isolated-test-relay\.sh --prepare-only/,
    "the runner must reset, fully migrate, seed, and build the current relay",
  );
  assert.match(script, /INSERT INTO airhop_organizations/);
  assert.match(script, /INSERT INTO airhop_center_installations/);
  assert.match(script, /INSERT INTO airhop_center_activation_grants/);
  assert.match(script, /airhop-e2e-activation-fixture\.mjs digest/);
  assert.doesNotMatch(
    script,
    /INSERT INTO relay_members/,
    "the owner must be assigned by the atomic activation claim, not pre-seeded",
  );
  assert.match(
    script,
    /e5ebc6cdb579be112e336cc319b5989b4bb6af11786ea90dbe52b5f08d741b34/,
  );
  assert.match(script, /scripts\/airhop-e2e-fake-llm\.mjs/);
  assert.match(script, /target\/\$\{CARGO_TARGET_PROFILE\}\/buzz-relay/);
  assert.match(script, /BUZZ_REQUIRE_RELAY_MEMBERSHIP=true/);
  assert.match(script, /RELAY_OWNER_PUBKEY="\$\{OWNER_PUBKEY\}"/);
  assert.match(script, /BUZZ_RELAY_PRIVATE_KEY="\$\{RELAY_PRIVATE_KEY\}"/);
  assert.match(script, /BUZZ_ALLOW_NIP_OA_AUTH=true/);
  assert.match(script, /AIRHOP_E2E_FAKE_LLM_URL=/);
  assert.match(script, /AIRHOP_E2E_ACTIVATION_CODE=/);
  assert.match(script, /BUZZ_RELAY_URL="ws:\/\/localhost:\$\{RELAY_PORT\}"/);
  assert.match(script, /AIRHOP_E2E_SCREENSHOT_PATH=/);
  assert.match(script, /pnpm exec wdio run wdio\.conf\.ts/);
  assert.match(script, /trap cleanup EXIT INT TERM/);
  assert.doesNotMatch(
    script,
    /pkill|killall/,
    "cleanup must target only processes started by this runner",
  );
});

test("native AirHop runner builds the exact application after backend work", () => {
  const script = readFileSync(runnerUrl, "utf8");
  const prepare = script.indexOf("start-isolated-test-relay.sh --prepare-only");
  const build = script.indexOf("pnpm build:e2e:tauri");
  const run = script.indexOf("pnpm exec wdio run wdio.conf.ts");

  assert.ok(prepare >= 0);
  assert.ok(
    build > prepare,
    "backend builds must not replace the final app artifact",
  );
  assert.ok(run > build, "WDIO must run the just-built AirHop binary");
});

test("native AirHop runner refuses occupied relay ports", () => {
  const script = readFileSync(runnerUrl, "utf8");
  assert.match(script, /refuse_occupied_port "\$\{RELAY_PORT\}"/);
  assert.match(script, /already in use/);
});
