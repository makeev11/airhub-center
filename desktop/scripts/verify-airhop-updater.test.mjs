import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { verifyAirhopUpdater } from "./verify-airhop-updater.mjs";

function fixture(prehashed) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const data = Buffer.from("AirHop update test");
  const keyId = Buffer.from("0102030405060708", "hex");
  const key = Buffer.concat([
    Buffer.from("Ed"),
    keyId,
    publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  ]);
  const signature = sign(
    null,
    prehashed ? createHash("blake2b512").update(data).digest() : data,
    privateKey,
  );
  const signed = Buffer.concat([
    Buffer.from(prehashed ? "ED" : "Ed"),
    keyId,
    signature,
  ]);
  const trusted = "timestamp:1\tfile:app.tar.gz";
  const global = sign(
    null,
    Buffer.concat([signature, Buffer.from(trusted)]),
    privateKey,
  );
  const envelope = `untrusted comment: fixture\n${signed.toString("base64")}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`;
  return {
    data,
    signature: Buffer.from(envelope).toString("base64"),
    pubkey: Buffer.from(
      `untrusted comment: fixture\n${key.toString("base64")}\n`,
    ).toString("base64"),
  };
}
for (const prehashed of [false, true]) {
  test(`signature verification accepts valid ${prehashed ? "prehashed" : "legacy"} packages and rejects tampering`, () => {
    const value = fixture(prehashed);
    assert(verifyAirhopUpdater(value.data, value.signature, value.pubkey));
    assert.throws(() =>
      verifyAirhopUpdater(
        Buffer.from("changed"),
        value.signature,
        value.pubkey,
      ),
    );
    assert.throws(() =>
      verifyAirhopUpdater(
        value.data,
        value.signature,
        fixture(prehashed).pubkey,
      ),
    );
    const changed = Buffer.from(
      Buffer.from(value.signature, "base64")
        .toString()
        .replace("timestamp:1", "timestamp:2"),
    ).toString("base64");
    assert.throws(() => verifyAirhopUpdater(value.data, changed, value.pubkey));
  });
}
