import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
test("CI relay artifacts contain the matching embedded migrator", () => {
  const ci = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
  assert.equal((ci.match(/^            target\/ci\/buzz-admin$/gm) ?? []).length, 3);
  assert.match(ci, /cargo build --profile ci -p buzz-relay -p buzz-admin/);
  assert.equal((ci.match(/\.\/target\/ci\/buzz-admin migrate/g) ?? []).length, 2);
  assert.doesNotMatch(ci, /pgschema apply --file schema\/schema\.sql/);
  assert.match(ci, /airhop::external_conversation::integration_tests/);
});

test("shared test relay applies migrations instead of the incomplete snapshot", () => {
  const script = readFileSync(new URL("scripts/start-relay-for-tests.sh", root), "utf8");
  assert.match(script, /buzz-admin" migrate/);
  assert.doesNotMatch(script, /pgschema apply/);
  assert.ok(script.indexOf('buzz-admin" migrate') < script.indexOf("INSERT INTO communities"));
});
