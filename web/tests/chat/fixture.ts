import type { Page, WebSocketRoute } from "@playwright/test";
import { getPublicKey, type Event, verifyEvent } from "nostr-tools/pure";
import { matchFilter, type Filter } from "nostr-tools/filter";
import { nsecEncode } from "nostr-tools/nip19";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  sealIdentity,
  sign,
  VAULT_KEY,
} from "../../src/features/chat/lib/identity";
import { pairingKeys } from "../../src/features/chat/lib/pairing";

export const origin = "http://127.0.0.1:4187";
export const password = "test-only passphrase 1234";
const actor = (last: number) => {
  const secret = new Uint8Array(32);
  secret[31] = last;
  return { secret, pubkey: getPublicKey(secret), origin };
};
export const employee = actor(21),
  colleague = actor(22),
  relayIdentity = actor(23),
  source = actor(24);
export const now = Math.floor(Date.now() / 1000);
export const message = (
  content: string,
  channel = "team",
  author = colleague,
  timestamp = now - 10,
  extra: string[][] = [],
) =>
  sign(author, {
    kind: 9,
    content,
    tags: [["h", channel], ...extra],
    created_at: timestamp,
  });

export class RelayFixture {
  events: Event[] = [];
  sent: Event[] = [];
  connections: { ws: WebSocketRoute; subscriptions: Map<string, Filter[]> }[] =
    [];
  rejectNextMessage = false;
  dropNextMessageAck = false;
  denyAuth = false;
  sas = "";
  pairingSecret = new Uint8Array(32).fill(18);

  constructor() {
    for (const [id, name, dm] of [
      ["team", "Команда", false],
      ["operations", "Смена", false],
      ["direct", "", true],
      ["hidden", "", true],
    ] as const) {
      this.events.push(
        sign(relayIdentity, {
          kind: 39000,
          content: "",
          created_at: now - 100,
          tags: [
            ["d", id],
            ["name", name],
            ...(dm ? [["t", "dm"], ["hidden"]] : []),
          ],
        }),
      );
      this.events.push(
        sign(relayIdentity, {
          kind: 39002,
          content: "",
          created_at: now - 100,
          tags: [
            ["d", id],
            ["p", employee.pubkey],
            ["p", colleague.pubkey],
          ],
        }),
      );
    }
    this.events.push(
      sign(relayIdentity, {
        kind: 30622,
        content: "",
        tags: [
          ["d", employee.pubkey],
          ["p", employee.pubkey],
          ["h", "hidden"],
        ],
      }),
    );
    this.events.push(
      sign(employee, {
        kind: 0,
        content: JSON.stringify({ name: "Андрей" }),
        tags: [],
      }),
      sign(colleague, {
        kind: 0,
        content: JSON.stringify({ name: "Мария" }),
        tags: [],
      }),
    );
    const root = message("Коллеги, завтра открываемся в 10:00. Всё готово?");
    this.events.push(
      root,
      message("Да, оборудование проверено.", "team", employee, now - 8, [
        ["e", root.id, "", "reply"],
      ]),
      message("Доброе утро!", "operations"),
      message("Привет! Можешь подменить меня в пятницу?", "direct"),
    );
  }

  add(event: Event) {
    this.events.push(event);
    for (const { ws, subscriptions } of this.connections)
      for (const [id, filters] of subscriptions)
        if (filters.some((filter) => matchFilter(filter, event)))
          ws.send(JSON.stringify(["EVENT", id, event]));
  }

  async install(
    page: Page,
    unlocked = true,
    options?: { origin: string; httpBase: string; vaultKey: string },
  ) {
    const centerOrigin = options?.origin ?? origin;
    await page.route(`${options?.httpBase ?? origin}/`, (route) =>
      route.request().headers().accept?.includes("application/nostr+json")
        ? route.fulfill({
            json: {
              self: relayIdentity.pubkey,
              name: "AirHop · Тестовый центр",
            },
          })
        : route.continue(),
    );
    if (unlocked) {
      const vault = await sealIdentity(
        { ...employee, origin: centerOrigin },
        password,
      );
      await page.addInitScript(
        ({ key, raw }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
        },
        { key: options?.vaultKey ?? VAULT_KEY, raw: JSON.stringify(vault) },
      );
    }
    await page.routeWebSocket(
      `${centerOrigin.replace(/^http/, "ws")}/**`,
      (ws) => {
        const pairing = new URL(ws.url()).pathname === "/pair";
        const connection = { ws, subscriptions: new Map<string, Filter[]>() };
        this.connections.push(connection);
        const send = (frame: unknown[]) => ws.send(JSON.stringify(frame));
        ws.onMessage((data) => {
          const frame = JSON.parse(String(data));
          if (frame[0] === "AUTH") {
            send([
              "OK",
              frame[1].id,
              !this.denyAuth && verifyEvent(frame[1]),
              "",
            ]);
            return;
          }
          if (frame[0] === "REQ") {
            const filters = frame.slice(2) as Filter[];
            connection.subscriptions.set(frame[1], filters);
            if (!pairing) {
              const events = new Map<string, Event>();
              for (const filter of filters) {
                const matches = this.events
                  .filter(
                    (event) =>
                      matchFilter(filter, event) &&
                      (!filter.search ||
                        event.content
                          .toLowerCase()
                          .includes(filter.search.toLowerCase())),
                  )
                  .sort((a, b) => b.created_at - a.created_at)
                  .slice(0, filter.limit ?? 1000);
                for (const event of matches) events.set(event.id, event);
              }
              for (const event of events.values())
                send(["EVENT", frame[1], event]);
            }
            send(["EOSE", frame[1]]);
            return;
          }
          if (frame[0] === "CLOSE") {
            connection.subscriptions.delete(frame[1]);
            return;
          }
          if (frame[0] !== "EVENT") return;
          const event = frame[1] as Event;
          if (!verifyEvent(event)) {
            send(["OK", event.id, false, "invalid signature"]);
            return;
          }
          this.sent.push(event);
          if (pairing && event.kind === 24134) {
            const key = nip44.utils.getConversationKey(
              source.secret,
              event.pubkey,
            );
            const body = JSON.parse(nip44.decrypt(event.content, key));
            send(["OK", event.id, true, ""]);
            if (body.type === "offer") {
              // Source-side ECDH is symmetric, but transcript order is source then target.
              const derived = pairingKeys(
                this.pairingSecret,
                event.pubkey,
                source.secret,
              );
              this.sas = derived.code;
              // Rebuild the transcript in its protocol ordering using the Node crypto reference.
              void import("node:crypto").then(({ hkdfSync, createECDH }) => {
                const hkdf = (
                  key: Uint8Array,
                  salt: Uint8Array,
                  info: string,
                ) => Buffer.from(hkdfSync("sha256", key, salt, info, 32));
                const ecdh = createECDH("secp256k1");
                ecdh.setPrivateKey(source.secret);
                const sas = hkdf(
                  ecdh.computeSecret(Buffer.from(`02${event.pubkey}`, "hex")),
                  this.pairingSecret,
                  "nostr-pair-sas-v1",
                );
                const session = hkdf(
                  this.pairingSecret,
                  new Uint8Array(),
                  "nostr-pair-session-id",
                );
                const transcript = hkdf(
                  Buffer.concat([
                    session,
                    Buffer.from(source.pubkey, "hex"),
                    Buffer.from(event.pubkey, "hex"),
                    sas,
                  ]),
                  this.pairingSecret,
                  "nostr-pair-transcript-v1",
                ).toString("hex");
                for (const payload of [
                  { type: "sas-confirm", transcript_hash: transcript },
                  {
                    type: "payload",
                    payload_type: "custom",
                    payload: JSON.stringify({
                      relayUrl: centerOrigin,
                      pubkey: employee.pubkey,
                      nsec: nsecEncode(employee.secret),
                    }),
                  },
                ]) {
                  const response = sign(source, {
                    kind: 24134,
                    content: nip44.encrypt(JSON.stringify(payload), key),
                    tags: [["p", event.pubkey]],
                  });
                  for (const id of connection.subscriptions.keys())
                    send(["EVENT", id, response]);
                }
              });
            }
            return;
          }
          if (event.kind === 9 && this.rejectNextMessage) {
            this.rejectNextMessage = false;
            send(["OK", event.id, false, "permission denied"]);
            return;
          }
          if (!this.events.some((entry) => entry.id === event.id))
            this.add(event);
          if (event.kind === 9 && this.dropNextMessageAck) {
            this.dropNextMessageAck = false;
            ws.close({ code: 1012, reason: "test reconnect" });
            return;
          }
          send(["OK", event.id, true, ""]);
        });
        ws.onClose(() => {
          this.connections = this.connections.filter(
            (entry) => entry !== connection,
          );
        });
        send(["AUTH", "fixture-challenge"]);
      },
    );
  }

  pairingCode() {
    return `nostrpair://${source.pubkey}?secret=${Buffer.from(this.pairingSecret).toString("hex")}&relay=${encodeURIComponent("ws://127.0.0.1:4187/pair")}&v=1`;
  }
}

export async function unlock(page: Page) {
  await page.goto("/chat");
  await page.getByLabel("Пароль этого браузера").fill(password);
  await page.getByRole("button", { name: "Открыть чат", exact: true }).click();
  await page.getByRole("button", { name: "# Команда" }).waitFor();
}
