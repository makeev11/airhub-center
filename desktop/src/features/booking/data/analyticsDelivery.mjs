// Small, dependency-free outbox. The deploy worker vendors this same module.
export function createAnalyticsDelivery(env) {
  const key = "airhop.analytics.outbox.v1";
  const ttl = 23 * 60 * 60 * 1000;
  let queue = [];
  let timer;
  let busy = false;
  let stopped = false;
  let disposed = false;
  let activeController;
  let failures = 0;
  let retryAt = 0;
  let batchLimit = 6;
  const size = (event) =>
    new TextEncoder().encode(JSON.stringify(event)).length;
  const now = () => env.Date.now();
  const persist = () => {
    if (disposed) return;
    try {
      env.sessionStorage.setItem(
        key,
        JSON.stringify({ queue, failures, retryAt }),
      );
    } catch {
      /* Storage may be disabled or full; keep the in-memory queue. */
    }
  };
  const prune = () => {
    queue = queue
      .filter((event) => {
        const age = now() - Date.parse(event.occurredAt);
        return age >= -300000 && age < ttl;
      })
      .slice(-40);
  };
  try {
    const saved = JSON.parse(env.sessionStorage.getItem(key));
    if (Array.isArray(saved?.queue)) {
      queue = saved.queue.filter(
        (event) =>
          event && typeof event.eventId === "string" && size(event) <= 2048,
      );
      failures = Math.min(5, Math.max(0, Number(saved.failures) || 0));
      retryAt = Math.min(now() + 300000, Number(saved.retryAt) || 0);
      prune();
    }
  } catch {
    /* Ignore malformed or inaccessible storage. */
  }
  function schedule(delay = 250) {
    if (stopped || busy || timer || !queue.length || failures >= 6) return;
    timer = env.setTimeout(
      () => {
        timer = undefined;
        void flush();
      },
      Math.max(delay, retryAt - now()),
    );
  }
  async function flush() {
    if (stopped || busy || env.navigator?.onLine === false) return;
    prune();
    if (!queue.length || failures >= 6) return;
    if (retryAt > now()) {
      schedule();
      return;
    }
    const batch = queue.slice(0, batchLimit);
    const ids = new Set(batch.map((event) => event.eventId));
    const controller = new env.AbortController();
    activeController = controller;
    const timeout = env.setTimeout(() => controller.abort(), 5000);
    busy = true;
    try {
      const response = await env.fetch(
        "/api/airhop/public/v1/analytics/events",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ events: batch }),
          credentials: "same-origin",
          keepalive: true,
          signal: controller.signal,
        },
      );
      const ack = response.ok ? await response.json() : null;
      if (
        response.ok &&
        ack?.accepted === batch.length &&
        Number.isInteger(ack.recorded)
      ) {
        queue = queue.filter((event) => !ids.has(event.eventId));
        failures = 0;
        retryAt = 0;
      } else if ([400, 413, 422].includes(response.status)) {
        // Isolate a rejected event so it cannot poison valid neighbours.
        if (batch.length > 1) batchLimit = 1;
        else queue = queue.filter((event) => !ids.has(event.eventId));
      } else if (
        response.status >= 400 &&
        response.status < 500 &&
        ![408, 429].includes(response.status)
      ) {
        queue = [];
        stopped = true; // No collector configured, or access denied.
      } else {
        const header = response.headers?.get("retry-after");
        const delay = /^\d+$/.test(header || "")
          ? Number(header) * 1000
          : Date.parse(header) - now();
        retryAt = now() + Math.min(300000, Math.max(0, delay || 0));
        throw new Error("Analytics not acknowledged");
      }
    } catch {
      failures += 1;
      retryAt = Math.max(
        retryAt,
        now() + Math.min(30000, 1000 * 2 ** (failures - 1)),
      );
    } finally {
      env.clearTimeout(timeout);
      activeController = undefined;
      busy = false;
      persist();
      schedule();
    }
  }
  function urgent() {
    prune();
    // A beacon is not an acknowledgement: keep the ids for replay on next load.
    if (!stopped && !busy && failures < 6 && queue.length && retryAt <= now()) {
      try {
        env.navigator?.sendBeacon?.(
          "/api/airhop/public/v1/analytics/events",
          new env.Blob(
            [JSON.stringify({ events: queue.slice(0, batchLimit) })],
            { type: "application/json" },
          ),
        );
      } catch {
        /* Navigation always proceeds. */
      }
    }
    persist();
  }
  const visibility = () => {
    if (env.document?.visibilityState === "hidden") urgent();
  };
  const online = () => {
    failures = 0;
    retryAt = 0;
    schedule();
  };
  env.addEventListener?.("pagehide", urgent);
  env.addEventListener?.("online", online);
  env.document?.addEventListener("visibilitychange", visibility);
  schedule();
  return {
    capture(events) {
      if (stopped) return;
      for (const event of events) {
        if (size(event) <= 2048) queue.push(event);
      }
      prune();
      persist();
      schedule();
    },
    flush,
    dispose() {
      disposed = true;
      stopped = true;
      activeController?.abort();
      env.clearTimeout(timer);
      env.removeEventListener?.("pagehide", urgent);
      env.removeEventListener?.("online", online);
      env.document?.removeEventListener("visibilitychange", visibility);
    },
  };
}
