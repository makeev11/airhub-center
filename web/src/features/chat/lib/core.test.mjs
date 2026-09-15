import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, hkdfSync } from "node:crypto";
import { getPublicKey, verifyEvent } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  importIdentity,
  openIdentity,
  relayOrigin,
  sealIdentity,
  sign,
} from "./identity.ts";
import { pairingKeys, parsePairing } from "./pairing.ts";
import {
  channelsFromEvents,
  messagesFromEvents,
  replyTags,
  threadReference,
} from "./model.ts";
import {
  makeReadState,
  readContexts,
  newReadStateId,
  effectiveReadAt,
} from "./read-state.ts";
import {
  isValidBlob,
  isValidReadStateDTag,
} from "../../../../../desktop/src/features/channels/readState/readStateFormat.ts";
import { fetchMedia, mediaUrl } from "./media.ts";
import { ChatSession } from "./session.ts";

const origin = "https://center.example";
const identity = (n) => {
  const secret = new Uint8Array(32);
  secret[31] = n;
  return { secret, pubkey: getPublicKey(secret), origin };
};
const alice = identity(1),
  bob = identity(2),
  server = identity(3);
const event = (actor, kind, content, tags, created_at = 100) =>
  sign(actor, { kind, content, tags, created_at });

test("credentials are pinned to the Center and public key", () => {
  const payload = {
    relayUrl: origin,
    pubkey: alice.pubkey,
    nsec: nsecEncode(alice.secret),
  };
  assert.deepEqual(importIdentity(JSON.stringify(payload), origin), alice);
  assert.throws(() =>
    importIdentity(JSON.stringify(payload), "https://different.example"),
  );
  assert.throws(() =>
    importIdentity(JSON.stringify({ ...payload, pubkey: bob.pubkey }), origin),
  );
  assert.equal(relayOrigin("wss://center.example/"), origin);
  for (const url of [
    "http://center.example",
    "https://u:p@center.example",
    `${origin}/elsewhere`,
    `${origin}/?key=secret`,
  ])
    assert.throws(() => relayOrigin(url));
});

test("vault round trips, contains no raw private key and rejects tampering/wrong password/origin", async () => {
  const password = "long local test passphrase";
  const vault = await sealIdentity(alice, password);
  const raw = JSON.stringify(vault);
  assert.equal(raw.includes(nsecEncode(alice.secret)), false);
  assert.equal(raw.includes(Buffer.from(alice.secret).toString("hex")), false);
  assert.deepEqual(await openIdentity(raw, password, origin), alice);
  await assert.rejects(openIdentity(raw, "wrong password", origin));
  await assert.rejects(
    openIdentity(raw, password, "https://elsewhere.example"),
  );
  await assert.rejects(
    openIdentity(
      JSON.stringify({ ...vault, pubkey: bob.pubkey }),
      password,
      origin,
    ),
  );
  const ciphertext = Buffer.from(vault.ciphertext, "base64");
  ciphertext[0] ^= 1;
  await assert.rejects(
    openIdentity(
      JSON.stringify({ ...vault, ciphertext: ciphertext.toString("base64") }),
      password,
      origin,
    ),
  );
  await assert.rejects(sealIdentity(alice, "short"));
});

test("pairing only accepts this Center and supported paths/version", () => {
  const make = (relay, suffix = "") =>
    `nostrpair://${alice.pubkey}?secret=${"12".repeat(32)}&relay=${encodeURIComponent(relay)}&v=1${suffix}`;
  assert.equal(
    parsePairing(make("wss://center.example/pair"), origin).pubkey,
    alice.pubkey,
  );
  assert.equal(
    parsePairing(make("wss://center.example/"), origin).relay,
    "wss://center.example/",
  );
  for (const relay of [
    "wss://evil.example/pair",
    "ws://center.example/pair",
    "wss://u:p@center.example/pair",
    "wss://center.example/other",
  ])
    assert.throws(() => parsePairing(make(relay), origin));
  assert.throws(() =>
    parsePairing(
      make("wss://center.example/pair", `&secret=${"34".repeat(32)}`),
      origin,
    ),
  );
  assert.throws(() =>
    parsePairing(
      make("wss://center.example/pair").replace("v=1", "v=2"),
      origin,
    ),
  );
});

test("pairing SAS and transcript match independent OpenSSL ECDH/HKDF derivation", () => {
  const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const result = pairingKeys(secret, alice.pubkey, bob.secret);
  const hkdf = (key, salt, info) =>
    Buffer.from(hkdfSync("sha256", key, salt, info, 32));
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(bob.secret);
  const shared = ecdh.computeSecret(Buffer.from(`02${alice.pubkey}`, "hex"));
  const sessionId = hkdf(secret, Buffer.alloc(0), "nostr-pair-session-id");
  const sas = hkdf(shared, secret, "nostr-pair-sas-v1");
  const transcript = Buffer.concat([
    sessionId,
    Buffer.from(alice.pubkey, "hex"),
    Buffer.from(bob.pubkey, "hex"),
    sas,
  ]);
  assert.equal(result.sessionId, sessionId.toString("hex"));
  assert.equal(
    result.code,
    (sas.readUInt32BE() % 1_000_000).toString().padStart(6, "0"),
  );
  assert.equal(
    result.transcriptHash,
    hkdf(transcript, secret, "nostr-pair-transcript-v1").toString("hex"),
  );
  const encrypted = nip44.encrypt(
    "desktop-to-browser",
    nip44.utils.getConversationKey(alice.secret, bob.pubkey),
  );
  assert.equal(
    nip44.decrypt(encrypted, result.conversation),
    "desktop-to-browser",
  );
});

test("channels require server-signed membership, use d tags, and honor removal", () => {
  const meta = event(server, 39000, "", [
    ["d", "team"],
    ["name", "Команда"],
  ]);
  const member = event(server, 39002, "", [
    ["d", "team"],
    ["p", alice.pubkey],
  ]);
  const forged = event(bob, 39000, "", [
    ["d", "forged"],
    ["name", "Поддельный"],
  ]);
  assert.equal(
    channelsFromEvents([meta, member, forged], alice.pubkey, server.pubkey)[0]
      .name,
    "Команда",
  );
  const removed = event(server, 39002, "", [["d", "team"]], 101);
  assert.deepEqual(
    channelsFromEvents([meta, member, removed], alice.pubkey, server.pubkey),
    [],
  );
});

test("threads use marked references; nested reply preserves the root", () => {
  const root = event(alice, 9, "root", [["h", "team"]]);
  const reply = event(bob, 9, "reply", replyTags("team", root));
  const nested = replyTags("team", reply);
  assert.deepEqual(threadReference(reply.tags), {
    root: root.id,
    parent: root.id,
  });
  assert.deepEqual(threadReference(nested), {
    root: root.id,
    parent: reply.id,
  });
  assert.deepEqual(threadReference([["e", root.id]]), {
    root: null,
    parent: null,
  });
});

test("edits/deletions cannot impersonate another author or channel; reactions deduplicate", () => {
  const root = event(alice, 9, "original", [["h", "team"]]);
  const maliciousEdit = event(
    bob,
    40003,
    "forged",
    [
      ["h", "team"],
      ["e", root.id],
    ],
    105,
  );
  const wrongChannel = event(
    alice,
    40003,
    "wrong channel",
    [
      ["h", "elsewhere"],
      ["e", root.id],
    ],
    106,
  );
  const edit = event(
    alice,
    40003,
    "edited",
    [
      ["h", "team"],
      ["e", root.id],
    ],
    102,
  );
  const maliciousDelete = event(bob, 5, "", [["e", root.id]], 107);
  const reaction = event(bob, 7, "👍", [["e", root.id]], 108);
  const duplicate = event(bob, 7, "👍", [["e", root.id]], 109);
  const all = [
    root,
    maliciousEdit,
    wrongChannel,
    edit,
    maliciousDelete,
    reaction,
    duplicate,
  ];
  const [row] = messagesFromEvents(all, "team", bob.pubkey, server.pubkey);
  assert.equal(row.content, "edited");
  assert.equal(row.deleted, false);
  assert.equal(row.reactions[0].count, 1);
  const deletion = event(alice, 5, "", [["e", root.id]], 110);
  assert.equal(
    messagesFromEvents([...all, deletion], "team", bob.pubkey, server.pubkey)[0]
      .deleted,
    true,
  );
});

test("read state interoperates through signed NIP-44 self-encryption", () => {
  const contexts = { [`msg:${"ab".repeat(32)}`]: 100, team: 95 };
  const slot = newReadStateId();
  const clientId = newReadStateId();
  const record = makeReadState(alice, slot, clientId, contexts, 120);
  assert.match(slot, /^[a-f0-9]{32}$/);
  assert.notEqual(slot, clientId);
  assert.equal(verifyEvent(record), true);
  assert.deepEqual(readContexts(record, alice), contexts);
  assert.deepEqual(readContexts(record, bob), {});
  assert.equal(record.content.includes("team"), false);
  const plaintext = JSON.parse(
    nip44.decrypt(
      record.content,
      nip44.utils.getConversationKey(alice.secret, alice.pubkey),
    ),
  );
  assert.equal(
    isValidBlob(plaintext),
    true,
    "existing desktop accepts this blob",
  );
  assert.equal(isValidReadStateDTag(record.tags[0][1]), true);
  assert.equal(plaintext.client_id, clientId);
  assert.throws(() =>
    makeReadState(alice, crypto.randomUUID(), clientId, contexts, 120),
  );
  assert.deepEqual(
    readContexts({ ...record, tags: [...record.tags, record.tags[0]] }, alice),
    {},
  );
  const oversized = makeReadState(
    alice,
    slot,
    clientId,
    { ["я".repeat(129)]: 1, valid: 2 },
    120,
  );
  assert.deepEqual(readContexts(oversized, alice), { valid: 2 });
  const message = sign(alice, {
    kind: 9,
    content: "reply",
    tags: [
      ["h", "team"],
      ["e", "ab".repeat(32), "", "reply"],
    ],
  });
  assert.equal(
    effectiveReadAt(message, { [`thread:${"ab".repeat(32)}`]: 110, team: 95 }),
    110,
  );
  assert.equal(
    effectiveReadAt(message, contexts),
    95,
    "reading the parent alone does not read a reply",
  );
});

test("intentional identical sends in one second remain different events", () => {
  const session = new ChatSession(alice);
  const channels = session.getSnapshot().channels;
  channels.push({
    id: "team",
    name: "Team",
    members: [alice.pubkey],
    archived: false,
    dm: false,
  });
  const originalNow = Date.now;
  try {
    Date.now = () => 1_700_000_000_000;
    const first = session.prepareMessage("team", "Да");
    const second = session.prepareMessage("team", "Да");
    assert.equal(first.created_at, second.created_at);
    assert.notEqual(first.id, second.id);
    assert.equal(verifyEvent(first) && verifyEvent(second), true);
  } finally {
    Date.now = originalNow;
    session.dispose();
  }
});

test("media authorization never leaves the pinned Center", async () => {
  assert.equal(
    mediaUrl(`${origin}/media/${"ab".repeat(32)}.png`, origin)?.origin,
    origin,
  );
  for (const value of [
    "https://evil.example/media/abc",
    `${origin}/admin`,
    `${origin}/media/${"ab".repeat(32)}?redirect=evil`,
    `https://u:p@center.example/media/${"ab".repeat(32)}`,
  ]) {
    assert.equal(mediaUrl(value, origin), null);
    await assert.rejects(fetchMedia(alice, value));
  }
});
