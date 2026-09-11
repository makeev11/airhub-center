import { createAnalyticsDelivery } from "./analyticsDelivery.mjs";

declare global {
  interface Window {
    __AIRHOP_ANALYTICS_DELIVERY__?: ReturnType<typeof createAnalyticsDelivery>;
    __AIRHOP_ANALYTICS_MEMORY__?: Record<string, string>;
    __AIRHOP_SITE_ANALYTICS_V1__?: boolean;
  }
}

export type PublicSiteAnalyticsStep =
  | "basics"
  | "groups"
  | "occurrences"
  | "contact"
  | "preview";

export type PublicSiteAnalyticsEvent = {
  eventType:
    | "site_page_view"
    | "contact_click"
    | "booking_opened"
    | "booking_step_viewed"
    | "booking_step_completed"
    | "booking_submit";
  journeyId?: string;
  branchId?: string;
  path?: string;
  step?: PublicSiteAnalyticsStep;
  target?: "phone" | "email" | "telegram" | "whatsapp" | "max" | "other";
};

export type PublicBookingAnalyticsContext = {
  visitorId: string;
  sessionId: string;
  journeyId: string;
  source?: string;
  campaign?: string;
  referrerHost?: string;
};

const VISITOR_KEY = "airhop.analytics.visitor.v1";
const SESSION_KEY = "airhop.analytics.session.v1";
const SESSION_IDLE_MS = 30 * 60 * 1_000;

type AnalyticsAttribution = Pick<
  PublicBookingAnalyticsContext,
  "source" | "campaign" | "referrerHost"
>;

type StoredSession = AnalyticsAttribution & { id: string; expiresAt: number };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function randomId(): string {
  return crypto.randomUUID();
}

function safeStorage(
  storage: "localStorage" | "sessionStorage",
  key: string,
): string | null {
  try {
    return (
      window[storage].getItem(key) ??
      window.__AIRHOP_ANALYTICS_MEMORY__?.[key] ??
      null
    );
  } catch {
    return window.__AIRHOP_ANALYTICS_MEMORY__?.[key] ?? null;
  }
}

function persist(
  storage: "localStorage" | "sessionStorage",
  key: string,
  value: string,
) {
  window.__AIRHOP_ANALYTICS_MEMORY__ ??= {};
  window.__AIRHOP_ANALYTICS_MEMORY__[key] = value;
  try {
    window[storage].setItem(key, value);
  } catch {
    // Tracking must never interfere with the public booking experience.
  }
}

function visitorId(): string {
  if (typeof window === "undefined") return randomId();
  const existing = safeStorage("localStorage", VISITOR_KEY);
  if (existing && UUID_PATTERN.test(existing)) return existing;
  const created = randomId();
  persist("localStorage", VISITOR_KEY, created);
  return created;
}

function sessionContext(now = Date.now()): {
  sessionId: string;
  attribution: AnalyticsAttribution;
} {
  if (typeof window === "undefined") {
    return { sessionId: randomId(), attribution: {} };
  }
  const landingAttribution = pageAttribution();
  const existing = safeStorage("sessionStorage", SESSION_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as StoredSession;
      if (
        UUID_PATTERN.test(parsed.id) &&
        Number.isFinite(parsed.expiresAt) &&
        parsed.expiresAt > now
      ) {
        const attribution = {
          ...(label(parsed.source, 80)
            ? { source: label(parsed.source, 80) }
            : {}),
          ...(label(parsed.campaign, 160)
            ? { campaign: label(parsed.campaign, 160) }
            : {}),
          ...(label(parsed.referrerHost, 253)
            ? { referrerHost: label(parsed.referrerHost, 253) }
            : {}),
          ...landingAttribution,
        };
        persist(
          "sessionStorage",
          SESSION_KEY,
          JSON.stringify({
            id: parsed.id,
            expiresAt: now + SESSION_IDLE_MS,
            ...attribution,
          }),
        );
        return { sessionId: parsed.id, attribution };
      }
    } catch {
      // Replace malformed first-party state below.
    }
  }
  const created = randomId();
  persist(
    "sessionStorage",
    SESSION_KEY,
    JSON.stringify({
      id: created,
      expiresAt: now + SESSION_IDLE_MS,
      ...landingAttribution,
    }),
  );
  return { sessionId: created, attribution: landingAttribution };
}

function label(value: unknown, max: number): string | undefined {
  return typeof value === "string"
    ? value
        .replace(/\p{Cc}/gu, "")
        .trim()
        .slice(0, max) || undefined
    : undefined;
}

function pageAttribution(): Pick<
  PublicBookingAnalyticsContext,
  "source" | "campaign" | "referrerHost"
> {
  if (typeof window === "undefined") return {};
  const hashSearch = window.location.hash.split("?", 2)[1]?.split("#", 1)[0];
  const search = new URLSearchParams(window.location.search || hashSearch);
  const source = label(search.get("utm_source") ?? search.get("source"), 80);
  const campaign = label(search.get("utm_campaign"), 160);
  let referrerHost: string | undefined;
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    if (host && host !== window.location.hostname) referrerHost = host;
  } catch {
    referrerHost = undefined;
  }
  return {
    ...(source ? { source: source.slice(0, 80) } : {}),
    ...(campaign ? { campaign: campaign.slice(0, 160) } : {}),
    ...(referrerHost ? { referrerHost } : {}),
  };
}

function currentPath(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const hashPath = window.location.hash.match(/^#(\/[^?#]*)/)?.[1];
  const path = hashPath || window.location.pathname || "/";
  return path.startsWith("/booking/manage")
    ? "/booking/manage"
    : path.slice(0, 512);
}

export function createPublicBookingAnalyticsContext(): PublicBookingAnalyticsContext {
  const session = sessionContext();
  return {
    visitorId: visitorId(),
    // A long-lived form may outlive the idle window; keep its journey but
    // resolve the current session whenever telemetry or a booking is sent.
    get sessionId() {
      return typeof window === "undefined"
        ? session.sessionId
        : sessionContext().sessionId;
    },
    journeyId: randomId(),
    ...session.attribution,
  };
}

export function trackPublicSiteAnalytics(
  context: PublicBookingAnalyticsContext,
  events: PublicSiteAnalyticsEvent[],
) {
  if (
    typeof window === "undefined" ||
    typeof fetch !== "function" ||
    events.length === 0
  )
    return;
  try {
    const occurredAt = new Date().toISOString();
    const path = currentPath();
    const payload = events.map((event) => ({
      eventId: randomId(),
      eventType: event.eventType,
      occurredAt,
      visitorId: context.visitorId,
      sessionId: context.sessionId,
      ...(event.journeyId ? { journeyId: event.journeyId } : {}),
      ...(event.branchId ? { branchId: event.branchId } : {}),
      ...((event.path ?? path) ? { path: event.path ?? path } : {}),
      ...(context.referrerHost ? { referrerHost: context.referrerHost } : {}),
      ...(context.source ? { source: context.source } : {}),
      ...(context.campaign ? { campaign: context.campaign } : {}),
      ...(event.step ? { step: event.step } : {}),
      ...(event.target ? { target: event.target } : {}),
    }));
    window.__AIRHOP_ANALYTICS_DELIVERY__ ??= createAnalyticsDelivery(window);
    window.__AIRHOP_ANALYTICS_DELIVERY__.capture(payload);
  } catch {
    // Telemetry failures must never affect booking actions.
  }
}

/** Clears public telemetry state at a desktop community boundary. */
export function resetPublicSiteAnalytics() {
  if (typeof window === "undefined") return;
  window.__AIRHOP_ANALYTICS_DELIVERY__?.dispose();
  delete window.__AIRHOP_ANALYTICS_DELIVERY__;
  delete window.__AIRHOP_ANALYTICS_MEMORY__;
  try {
    window.sessionStorage.removeItem("airhop.analytics.outbox.v1");
  } catch {
    /* unavailable */
  }
}
