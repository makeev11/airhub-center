import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/#/booking",
});

before(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    window: dom.window,
  });
});

after(() => dom.window.close());

test("public flow finishes its async initialization under React StrictMode", async () => {
  const { StrictMode, createElement } = await import("react");
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const { PublicBookingProvider } = await import(
    "../data/PublicBookingProvider.tsx"
  );
  const { PublicBookingFlow } = await import("./PublicBookingFlow.tsx");
  let catalogCalls = 0;
  const service = {
    async getCatalog() {
      catalogCalls += 1;
      await Promise.resolve();
      return {
        organization: {
          id: "airhop",
          name: "Каляка Маляка",
          locale: "ru-RU",
          timeZone: "Europe/Moscow",
          currentDate: "2026-08-04",
          publicBooking: { purpose: "trial", appearance: "automatic" },
        },
        branches: [],
      };
    },
    async findOccurrences() {
      return [];
    },
    async createBooking() {
      throw new Error("not used");
    },
    async getManagementCard() {
      return null;
    },
    async cancelByParent() {
      return null;
    },
    async requestTransfer() {
      return null;
    },
    async setPreferredContactChannel() {
      return null;
    },
  };

  const view = render(
    createElement(
      StrictMode,
      null,
      createElement(
        PublicBookingProvider,
        { service },
        createElement(PublicBookingFlow, { mode: "standalone" }),
      ),
    ),
  );

  await waitFor(() =>
    assert.ok(view.getByRole("heading", { name: "Выберите филиал и возраст" })),
  );
  assert.equal(catalogCalls, 1);
  assert.ok(view.getByRole("button", { name: "Меньше года" }));
  assert.ok(view.getByRole("button", { name: "5 лет" }));
  assert.match(
    view.getByTestId("airhop-public-header").textContent,
    /Онлайн-запись · Каляка Маляка/,
  );
  assert.doesNotMatch(
    view.getByTestId("airhop-public-header").textContent,
    /AirHop/,
  );
  assert.match(
    view.getByTestId("airhop-public-footer").textContent,
    /Работает на AirHop/,
  );
  assert.equal(
    view
      .getByTestId("airhop-public-flow")
      .contains(view.getByTestId("airhop-public-footer")),
    true,
    "branding must be the final item in the scrollable flow",
  );
  assert.equal(
    view.getByTestId("airhop-public-flow").lastElementChild,
    view.getByTestId("airhop-public-footer"),
  );
  assert.doesNotMatch(
    view.getByTestId("airhop-public-footer").textContent,
    /Каляка Маляка/,
  );
  assert.equal(
    view.queryByText(
      "Точную дату рождения спросим только перед отправкой заявки.",
    ),
    null,
  );
  assert.equal(
    view.getByTestId("airhop-public-brand-mark").getAttribute("src"),
    "/airhop/mark.svg",
  );
  cleanup();
});
