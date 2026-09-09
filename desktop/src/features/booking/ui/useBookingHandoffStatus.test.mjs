import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
before(() =>
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  }),
);
after(() => dom.window.close());

test("returning from Telegram refreshes a restored pending booking without a launch token", async () => {
  const { useState } = await import("react");
  const { act, renderHook, cleanup } = await import("@testing-library/react");
  const { useBookingHandoffStatus } = await import(
    "./useBookingHandoffStatus.ts"
  );
  let calls = 0;
  const service = {
    async getManagementCard(token) {
      assert.equal(token, "booking-token");
      calls += 1;
      return { status: "confirmed", telegramConnected: true };
    },
  };
  const view = renderHook(() => {
    const [success, setSuccess] = useState({
      token: "booking-token",
      card: { status: "pending_confirmation", telegramConnected: true },
    });
    useBookingHandoffStatus(service, success, setSuccess);
    return success;
  });
  try {
    await act(async () => {
      window.dispatchEvent(new window.Event("focus"));
    });
    assert.equal(calls, 1);
    assert.equal(view.result.current.card.status, "confirmed");
    await act(async () => {
      window.dispatchEvent(new window.Event("focus"));
    });
    assert.equal(calls, 1, "confirmed bookings stop refreshing");
  } finally {
    cleanup();
  }
});

test("a response from a previously opened booking cannot replace the current booking", async () => {
  const { useState } = await import("react");
  const { act, renderHook, cleanup } = await import("@testing-library/react");
  const { useBookingHandoffStatus } = await import(
    "./useBookingHandoffStatus.ts"
  );
  let resolve;
  const service = {
    getManagementCard: () =>
      new Promise((done) => {
        resolve = done;
      }),
  };
  const view = renderHook(() => {
    const [success, setSuccess] = useState({
      token: "old",
      card: { status: "pending_confirmation" },
    });
    useBookingHandoffStatus(service, success, setSuccess);
    return { success, setSuccess };
  });
  try {
    await act(async () => {
      window.dispatchEvent(new window.Event("focus"));
    });
    await act(async () => {
      view.result.current.setSuccess({
        token: "new",
        card: { status: "pending_confirmation" },
      });
    });
    await act(async () => {
      resolve({ status: "confirmed", telegramConnected: true });
    });
    assert.equal(view.result.current.success.token, "new");
    assert.equal(
      view.result.current.success.card.status,
      "pending_confirmation",
    );
  } finally {
    cleanup();
  }
});
