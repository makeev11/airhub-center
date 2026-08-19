import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(
  new URL("./start-isolated-test-relay.sh", import.meta.url),
  "utf8",
);

test("isolated relay starts from the complete checked-in migration chain", () => {
  assert.match(
    script,
    /cargo run -p buzz-admin -- migrate/,
    "the harness must apply every additive AirHop migration",
  );
  assert.doesNotMatch(
    script,
    /pgschema apply --file schema\/schema\.sql/,
    "the base desired-state schema alone omits additive AirHop tables",
  );
});

test("isolated relay keeps all backing and relay ports overridable", () => {
  for (const name of ["PG", "REDIS", "MINIO", "RELAY", "HEALTH", "METRICS"]) {
    assert.match(script, new RegExp(`AIRHOP_HARNESS_${name}_PORT`));
  }
});

test("isolated relay can prepare a clean database without requiring tmux", () => {
  assert.match(script, /--prepare-only/);
  assert.match(script, /PREPARE_ONLY=true/);
  assert.match(
    script,
    /if \[\[ "\$\{PREPARE_ONLY\}" == "true" \]\]/,
  );
});
