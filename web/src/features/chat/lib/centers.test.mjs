import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCenters,
  centerVaultKey,
  centerIdentity,
  centerHttpUrl,
} from "./centers.ts";
import { sealIdentity, openIdentity } from "./identity.ts";
import { getPublicKey } from "nostr-tools/pure";

test("registered Centers reject duplicate, insecure and injected routes", () => {
  const entry = {
    id: "demo",
    name: "Center",
    origin: "https://demo.airhop.ru",
  };
  assert.deepEqual(parseCenters([entry]), [entry]);
  for (const entries of [
    [],
    [entry, entry],
    [{ ...entry, id: "../admin" }],
    [{ ...entry, origin: "http://demo.airhop.ru" }],
    [{ ...entry, origin: "https://demo.airhop.ru/admin" }],
  ])
    assert.throws(() => parseCenters(entries));
});

test("Center vaults and signed identities stay isolated from app transport", async () => {
  const secret = new Uint8Array(32).fill(26);
  const a = { id: "first", name: "First", origin: "https://first.example" };
  const b = { id: "second", name: "Second", origin: "https://second.example" };
  const identity = { origin: a.origin, secret, pubkey: getPublicKey(secret) };
  assert.notEqual(centerVaultKey(a.origin), centerVaultKey(b.origin));
  assert.throws(() => centerIdentity(identity, b));
  const routed = centerIdentity(identity, a);
  assert.equal(centerHttpUrl(routed, "/media/abc"), "/centers/first/media/abc");
  assert.equal(centerHttpUrl(identity, "/"), "https://first.example/");
  assert.throws(() => centerHttpUrl(routed, "//foreign.example/"));
  const vault = await sealIdentity(routed, "test password long enough");
  assert.equal(vault.httpBase, undefined);
  assert.equal(vault.origin, a.origin);
  await assert.rejects(
    openIdentity(JSON.stringify(vault), "test password long enough", b.origin),
  );
  const opened = await openIdentity(
    JSON.stringify(vault),
    "test password long enough",
    a.origin,
  );
  assert.equal(opened.httpBase, undefined);
});
