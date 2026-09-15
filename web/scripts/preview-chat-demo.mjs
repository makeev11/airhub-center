// Local demonstration ONLY. No database, credentials, proxy or external Center.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { matchFilter } from "nostr-tools/filter";
import { sign } from "../src/features/chat/lib/identity.ts";

const port = Number(process.env.CHAT_DEMO_PORT || 4188);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid CHAT_DEMO_PORT");
const authority = `127.0.0.1:${port}`;
const origin = `http://${authority}`;
const directory = fileURLToPath(new URL("../dist-chat-demo/", import.meta.url));
await readFile(resolve(directory, "index.html"));
const actor = () => {
  const secret = generateSecretKey();
  return { secret, pubkey: getPublicKey(secret), origin };
};
const employee = actor(),
  anna = actor(),
  relay = actor();
const events = new Map();
const media = new Map();
let mediaBytes = 0;
const connections = new Set();
const channels = ["demo-team", "demo-shift", "demo-direct"];
const time = Math.floor(Date.now() / 1000);
const store = (event) => {
  if (event.kind === 30078) {
    const coordinate = event.tags.find((tag) => tag[0] === "d")?.[1];
    for (const [id, old] of events)
      if (
        old.kind === event.kind &&
        old.pubkey === event.pubkey &&
        old.tags.some((tag) => tag[0] === "d" && tag[1] === coordinate)
      )
        events.delete(id);
  }
  events.set(event.id, event);
  for (const connection of connections) {
    if (
      !connection.authenticated ||
      connection.ws.readyState !== WebSocket.OPEN
    )
      continue;
    for (const [id, filters] of connection.subscriptions)
      if (filters.some((filter) => matchFilter(filter, event)))
        connection.ws.send(JSON.stringify(["EVENT", id, event]));
  }
};
for (const [index, channel] of channels.entries()) {
  store(
    sign(relay, {
      kind: 39000,
      content: "",
      tags: [
        ["d", channel],
        ["name", ["Команда", "Смена", ""][index]],
        ...(index === 2 ? [["t", "dm"], ["hidden"]] : []),
      ],
    }),
  );
  store(
    sign(relay, {
      kind: 39002,
      content: "",
      tags: [
        ["d", channel],
        ["p", employee.pubkey],
        ["p", anna.pubkey],
      ],
    }),
  );
}
for (const [identity, name] of [
  [employee, "Вы"],
  [anna, "Анна · демо"],
])
  store(
    sign(identity, { kind: 0, content: JSON.stringify({ name }), tags: [] }),
  );
const root = sign(anna, {
  kind: 9,
  content:
    "Привет! Это пробный чат команды 👋\n\nНапишите что-нибудь внизу. Я пришлю автоматический демо-ответ — так можно попробовать переписку без подключения к вашему Center.",
  tags: [["h", "demo-team"]],
  created_at: time - 120,
});
store(root);
store(
  sign(employee, {
    kind: 9,
    content: "А обсуждение конкретного сообщения — вот здесь, в ветке.",
    tags: [
      ["h", "demo-team"],
      ["e", root.id, "", "reply"],
    ],
    created_at: time - 100,
  }),
);
store(
  sign(anna, {
    kind: 9,
    content:
      "Здесь можно обсуждать расписание и передачу смены. Это вымышленный пример, не реальные задачи сотрудников.",
    tags: [["h", "demo-shift"]],
    created_at: time - 80,
  }),
);
store(
  sign(anna, {
    kind: 9,
    content:
      "А это личная переписка. Можете ответить — сообщение увидите только вы в этой локальной демонстрации.",
    tags: [["h", "demo-direct"]],
    created_at: time - 60,
  }),
);

const sameOrigin = (req) =>
  req.headers.host === authority &&
  (!req.headers.origin || req.headers.origin === origin);
const tag = (event, name) => event.tags.find((entry) => entry[0] === name)?.[1];
function authorizedMedia(req, action) {
  try {
    if (!req.headers.authorization?.startsWith("Nostr ")) return null;
    const event = JSON.parse(
      Buffer.from(req.headers.authorization.slice(6), "base64url").toString(),
    );
    return verifyEvent(event) &&
      event.pubkey === employee.pubkey &&
      event.kind === 24242 &&
      tag(event, "t") === action &&
      tag(event, "server") === authority &&
      Number(tag(event, "expiration")) > Date.now() / 1000
      ? event
      : null;
  } catch {
    return null;
  }
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
const server = createServer(async (req, res) => {
  const reply = (status, body, type = "application/json") => {
    res.writeHead(status, { "Content-Type": type });
    res.end(body);
  };
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://${authority}; img-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`,
  );
  if (!sameOrigin(req)) return reply(403, "{}");
  try {
    const path = new URL(req.url, origin).pathname;
    if (req.method === "GET" && path === "/__demo__/session")
      return reply(
        200,
        JSON.stringify({
          nsec: nsecEncode(employee.secret),
          pubkey: employee.pubkey,
          relayUrl: `ws://${authority}`,
        }),
      );
    if (
      req.method === "GET" &&
      path === "/" &&
      req.headers.accept?.includes("application/nostr+json")
    )
      return reply(
        200,
        JSON.stringify({ self: relay.pubkey, name: "AirHop · Демонстрация" }),
      );
    if (req.method === "PUT" && path === "/upload") {
      const auth = authorizedMedia(req, "upload");
      if (!auth) return reply(401, "{}");
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) return reply(413, "{}");
        chunks.push(chunk);
      }
      if (mediaBytes + size > 50 * 1024 * 1024) return reply(507, "{}");
      const bytes = Buffer.concat(chunks);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (tag(auth, "x") !== hash || req.headers["x-sha-256"] !== hash)
        return reply(400, "{}");
      if (!media.has(hash)) {
        media.set(hash, {
          bytes,
          type: req.headers["content-type"] || "application/octet-stream",
        });
        mediaBytes += size;
      }
      return reply(
        200,
        JSON.stringify({ url: `${origin}/media/${hash}`, sha256: hash, size }),
      );
    }
    if (req.method === "GET" && /^\/media\/[a-f0-9]{64}$/.test(path)) {
      if (!authorizedMedia(req, "get")) return reply(401, "{}");
      const blob = media.get(path.slice(7));
      return blob ? reply(200, blob.bytes, blob.type) : reply(404, "{}");
    }
    if (req.method !== "GET") return reply(405, "{}");
    const asset = ["/", "/chat", "/chat/"].includes(path)
      ? "index.html"
      : path.slice(1);
    if (
      asset !== "index.html" &&
      !asset.startsWith("chat-assets/") &&
      !["chat-icon.svg", "chat-touch-icon.png"].includes(asset)
    )
      return reply(404, "{}");
    const file = resolve(directory, asset);
    if (!file.startsWith(directory.endsWith(sep) ? directory : directory + sep))
      return reply(404, "{}");
    return reply(
      200,
      await readFile(file),
      mime[extname(file)] || "application/octet-stream",
    );
  } catch {
    if (!res.headersSent) reply(404, "{}");
    else res.end();
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on("upgrade", (req, socket, head) => {
  if (!sameOrigin(req) || req.headers.origin !== origin || req.url !== "/") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});
wss.on("connection", (ws) => {
  const connection = { ws, subscriptions: new Map(), authenticated: false };
  connections.add(connection);
  const challenge = randomUUID();
  const send = (frame) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };
  send(["AUTH", challenge]);
  ws.on("error", () => {});
  ws.on("close", () => connections.delete(connection));
  ws.on("message", (data) => {
    try {
      const frame = JSON.parse(data.toString());
      if (!Array.isArray(frame)) return;
      if (frame[0] === "AUTH") {
        const event = frame[1];
        connection.authenticated =
          verifyEvent(event) &&
          event.pubkey === employee.pubkey &&
          event.kind === 22242 &&
          tag(event, "challenge") === challenge &&
          tag(event, "relay") === `ws://${authority}`;
        send(["OK", event.id, connection.authenticated, "demo authentication"]);
        return;
      }
      if (!connection.authenticated) {
        ws.close();
        return;
      }
      if (frame[0] === "CLOSE") {
        connection.subscriptions.delete(frame[1]);
        return;
      }
      if (frame[0] === "REQ") {
        const filters = frame.slice(2);
        if (
          filters.length > 10 ||
          filters.some((filter) => !filter.kinds?.length)
        )
          return;
        connection.subscriptions.set(frame[1], filters);
        const result = new Map();
        for (const filter of filters) {
          const found = [...events.values()]
            .filter(
              (event) =>
                matchFilter(filter, event) &&
                (!filter.search ||
                  event.content
                    .toLowerCase()
                    .includes(filter.search.toLowerCase())),
            )
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, Math.min(filter.limit ?? 500, 1000));
          for (const event of found) result.set(event.id, event);
        }
        for (const event of result.values()) send(["EVENT", frame[1], event]);
        send(["EOSE", frame[1]]);
        return;
      }
      if (frame[0] !== "EVENT") return;
      const event = frame[1];
      if (
        !verifyEvent(event) ||
        event.pubkey !== employee.pubkey ||
        ![9, 5, 7, 40003, 30078].includes(event.kind)
      )
        return send(["OK", event.id, false, "demo event rejected"]);
      if (events.size > 3000)
        return send(["OK", event.id, false, "restart demo to reset messages"]);
      if (event.kind === 9 && !channels.includes(tag(event, "h")))
        return send(["OK", event.id, false, "unknown demo channel"]);
      const duplicate = events.has(event.id);
      if (!duplicate) store(event);
      send(["OK", event.id, true, "demo accepted"]);
      if (event.kind === 9 && !duplicate)
        setTimeout(() => {
          const rootId =
            event.tags.find(
              (entry) => entry[0] === "e" && entry[3] === "root",
            )?.[1] ||
            event.tags.find(
              (entry) => entry[0] === "e" && entry[3] === "reply",
            )?.[1];
          store(
            sign(anna, {
              kind: 9,
              content:
                "Демо-ответ: сообщение получено 👋 Это автоматический собеседник, не реальный сотрудник. Попробуйте ответить в ветке или открыть другой чат.",
              tags: [
                ["h", tag(event, "h")],
                ["client-message-id", randomUUID()],
                ...(rootId
                  ? [
                      ["e", rootId, "", "root"],
                      ["e", event.id, "", "reply"],
                    ]
                  : []),
              ],
            }),
          );
        }, 700);
    } catch {
      send(["NOTICE", "invalid demo frame"]);
    }
  });
});
server.on("error", (error) => {
  console.error(
    `Не удалось открыть локальное демо: ${error.code}. Выберите свободный CHAT_DEMO_PORT.`,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Демо чата: ${origin}/chat\nТолько этот компьютер. Вымышленные данные, без подключения к рабочему Center.`,
  ),
);
const stop = () => {
  for (const { ws } of connections) ws.terminate();
  wss.close();
  server.close();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
