/** Build only the approved Hygge example, not the marketing site or its APIs. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const directory = dirname(fileURLToPath(import.meta.url));
const centerRoot = resolve(directory, "../..");
const siteRoot = resolve(centerRoot, "../airhop-site");
const workerRoot = resolve(
  centerRoot,
  "../airhop-hq/services/site-deploy-worker",
);
const destination = process.argv[2];
assert(destination?.startsWith("/private/tmp/airhop-hygge-release."));
const localOrigin = "http://localhost:3000";
const publicOrigin = "https://demo.airhop.ru";
const prefix = "/airhop/hygge";
const pages = [
  ["/examples/hygge", "/"],
  ["/examples/hygge/brief", "/brief/"],
];
const assets = new Map();
const sourceDigests = {};
const hash = (body) => createHash("sha256").update(body).digest("hex");
await mkdir(destination, { recursive: false });

async function asset(path) {
  const url = new URL(path, localOrigin);
  assert(url.origin === localOrigin, `External asset: ${url}`);
  assert(!url.search && !url.hash && !url.pathname.includes(".."));
  if (assets.has(url.pathname)) return assets.get(url.pathname);
  const target = `${prefix}${url.pathname}`;
  assets.set(url.pathname, target);
  const response = await fetch(url, { redirect: "error" });
  assert(response.ok, `Asset HTTP ${response.status}: ${url}`);
  let body = Buffer.from(await response.arrayBuffer());
  assert(body.length < 3 * 1024 * 1024, `Unexpectedly large asset: ${url}`);
  if (url.pathname.endsWith(".css")) {
    body = Buffer.from(await rewriteCss(body.toString("utf8"), url));
  }
  const output = join(destination, url.pathname);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, body, { flag: "wx" });
  return target;
}

async function rewriteCss(css, base) {
  for (const match of css.matchAll(/url\(["']?([^\s"')]+)["']?\)/g)) {
    if (match[1].startsWith("data:")) continue;
    const nested = new URL(match[1], base);
    const rewritten = await asset(nested.href);
    css = css.replaceAll(match[0], `url("${rewritten}")`);
  }
  return css;
}

const [transport, collector, adapter, liveView] = await Promise.all([
  readFile(join(workerRoot, "src/analytics-delivery.mjs"), "utf8"),
  readFile(join(workerRoot, "src/site-analytics-runtime.js"), "utf8"),
  readFile(join(siteRoot, "app/examples/hygge/center-booking.ts"), "utf8"),
  readFile(join(directory, "hygge-pilot-runtime.js"), "utf8"),
]);
const analytics = `(() => {\n${transport.replace("export function", "function")}\n${collector}\n})();\n`;
const live = `(() => {\n${stripTypeScriptTypes(adapter).replace(/^export /gm, "")}\n${liveView}\n})();\n`;
assert(!live.includes("import "));
await writeFile(join(destination, "airhop-analytics.v1.js"), analytics, {
  flag: "wx",
});
await writeFile(join(destination, "center-availability.js"), live, {
  flag: "wx",
});

for (const [sourcePath, targetPath] of pages) {
  const response = await fetch(`${localOrigin}${sourcePath}`, {
    redirect: "error",
  });
  assert(response.ok, `Page HTTP ${response.status}: ${sourcePath}`);
  const html = await response.text();
  sourceDigests[sourcePath] = hash(html);
  const dom = new JSDOM(html);
  const { document } = dom.window;
  assert(document.querySelector(".hygge-theme"));
  assert(
    document.querySelector('meta[name="robots"]')?.content.includes("noindex"),
  );
  // This is a static, noindex pilot export. Native links/details stay functional;
  // no marketing-app hydration, quiz, arbitrary APIs or private state are shipped.
  for (const node of document.querySelectorAll(
    'script:not([type="application/ld+json"]),link[rel="modulepreload"],link[as="script"]',
  ))
    node.remove();
  const example = document.querySelector(".hygge-theme");
  document.body.replaceChildren(example);
  for (const node of document.querySelectorAll(
    "link[rel='icon'],link[rel='shortcut icon']",
  ))
    node.remove();
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.href = "/hygge/icon.svg";
  document.head.append(icon);
  document.querySelector('link[rel="canonical"]').href =
    `${publicOrigin}${prefix}${targetPath}`;
  for (const style of document.querySelectorAll("style")) {
    style.textContent = await rewriteCss(style.textContent, localOrigin);
  }
  for (const node of document.querySelectorAll(
    "img[src],link[rel='stylesheet'],link[rel='preload'],link[rel='icon']",
  )) {
    const attr = node.tagName === "IMG" ? "src" : "href";
    node.setAttribute(attr, await asset(node.getAttribute(attr)));
  }
  for (const link of document.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href");
    if (href.startsWith("#")) continue;
    const url = new URL(href, localOrigin);
    const localPage = pages.find(([path]) => path === url.pathname);
    if (localPage) link.href = `${prefix}${localPage[1]}${url.hash}`;
    else if (url.origin === publicOrigin && url.pathname === "/booking")
      // Same-origin storage already preserves acquisition. The cross-domain
      // demo's fixed UTM values would overwrite the real campaign here.
      link.href = url.pathname;
    else if (url.origin === localOrigin)
      link.href = `https://airhop.ru${url.pathname}${url.search}${url.hash}`;
  }
  const bookingLink = document.querySelector("a[href^='/booking']");
  if (bookingLink) {
    const panel = bookingLink.parentElement;
    const notice = panel.querySelector("p:last-of-type");
    const heading = panel.querySelector("h3");
    const status = document.createElement("p");
    status.dataset.hyggeStatus = "";
    status.setAttribute("role", "status");
    status.textContent =
      "Актуальное расписание загружается из Center. Если JavaScript отключён, откройте форму записи.";
    const list = document.createElement("ul");
    list.dataset.hyggeLessons = "";
    list.hidden = true;
    list.className = panel.querySelector("ul")?.className || "";
    panel.dataset.hyggeCenter = "";
    panel.replaceChildren(heading, status, list, notice, bookingLink);
    // Never freeze a server price into the exported pilot; live prices are above.
    const price = document.querySelector('[class*="trialPrice"] strong');
    if (price) price.textContent = "В Center";
    const diagnostic = document.createElement("p");
    diagnostic.style.cssText =
      "padding:1rem;text-align:center;font-size:.875rem";
    const contact = document.createElement("a");
    contact.href = "#hygge-top";
    contact.dataset.airhopContact = "other";
    contact.textContent =
      "Проверить тестовый клик по контакту — без звонка и сообщения";
    diagnostic.append(contact);
    document.body.append(diagnostic);
    const availabilityScript = document.createElement("script");
    availabilityScript.defer = true;
    availabilityScript.src = `${prefix}/center-availability.js?v=${hash(live).slice(0, 16)}`;
    document.body.append(availabilityScript);
  }
  const script = document.createElement("script");
  script.defer = true;
  script.src = `${prefix}/airhop-analytics.v1.js?v=${hash(analytics).slice(0, 16)}`;
  script.dataset.airhopAnalytics = "v1";
  document.body.append(script);
  assert(
    !document.querySelector("form"),
    "Pilot must not export marketing forms",
  );
  const output = join(destination, targetPath, "index.html");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, dom.serialize(), { flag: "wx" });
}
await writeFile(
  join(destination, "pilot-release.json"),
  JSON.stringify(
    {
      schema: "airhop.hygge-pilot.v1",
      builtAt: new Date().toISOString(),
      origin: publicOrigin,
      path: `${prefix}/`,
      sourceDigests,
      collectorSha256: hash(analytics),
      availabilitySha256: hash(live),
      note: "Noindex static export of the existing Hygge example with a live public Center catalog; not a production marketing-site deployment.",
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    destination,
    pages: pages.length,
    assets: assets.size,
    collectorBytes: Buffer.byteLength(analytics),
  }),
);
