import assert from "node:assert/strict";
import test from "node:test";
import {
  BRANCH_MAP_PROVIDERS,
  buildBranchMapLinks,
} from "./branchLocationLinks.ts";

test("branch map links keep one normalized address across all providers", () => {
  const links = buildBranchMapLinks("  Москва, ул. Земляной Вал, 9  ");

  assert.deepEqual(
    links.map(({ provider }) => provider),
    [...BRANCH_MAP_PROVIDERS],
  );
  for (const link of links) {
    assert.match(link.url, /^https:\/\//);
    assert.ok(link.url.includes("%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0"));
    assert.ok(!link.url.includes("  "));
  }
});

test("branch map links stay empty until an address is entered", () => {
  assert.deepEqual(buildBranchMapLinks("   "), []);
});
