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

test("occurrence actions preserve the localized button and invoke the flow handler once", async () => {
  const { createElement, StrictMode } = await import("react");
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const { PublicBookingOccurrenceActions } = await import(
    "./PublicBookingOccurrenceActions.tsx"
  );
  let continued = 0;
  const view = render(
    createElement(
      StrictMode,
      null,
      createElement(PublicBookingOccurrenceActions, {
        continueLabel: "Продолжить",
        onContinue: () => {
          continued += 1;
        },
      }),
    ),
  );
  try {
    const button = view.getByRole("button", {
      name: "Продолжить",
      exact: true,
    });
    assert.equal(button.type, "button");
    assert.equal(
      view.getByTestId("airhop-public-occurrence-actions").contains(button),
      true,
    );
    fireEvent.click(button);
    assert.equal(continued, 1);
  } finally {
    cleanup();
  }
});

test("plain Enter advances only from safe booking targets", async () => {
  const { shouldActivatePublicBookingPrimaryAction } = await import(
    "./usePublicBookingPrimaryAction.ts"
  );
  const event = (target, overrides = {}) => ({
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    key: "Enter",
    metaKey: false,
    repeat: false,
    shiftKey: false,
    target,
    ...overrides,
  });
  const selectedChoice = document.createElement("button");
  selectedChoice.setAttribute("aria-pressed", "true");
  const unselectedChoice = document.createElement("button");
  unselectedChoice.setAttribute("aria-pressed", "false");
  const textInput = document.createElement("input");
  const textarea = document.createElement("textarea");
  const backButton = document.createElement("button");
  const checkedConsent = document.createElement("button");
  checkedConsent.setAttribute("role", "checkbox");
  checkedConsent.setAttribute("aria-checked", "true");
  const primaryAction = document.createElement("button");
  primaryAction.dataset.airhopPrimaryAction = "true";

  assert.equal(
    shouldActivatePublicBookingPrimaryAction(event(selectedChoice)),
    true,
  );
  assert.equal(
    shouldActivatePublicBookingPrimaryAction(event(unselectedChoice)),
    false,
  );
  assert.equal(
    shouldActivatePublicBookingPrimaryAction(event(textInput)),
    true,
  );
  assert.equal(
    shouldActivatePublicBookingPrimaryAction(event(checkedConsent)),
    true,
  );
  assert.equal(
    shouldActivatePublicBookingPrimaryAction(event(textarea)),
    false,
  );
  assert.equal(
    shouldActivatePublicBookingPrimaryAction(event(backButton)),
    false,
  );
  assert.equal(
    shouldActivatePublicBookingPrimaryAction(event(primaryAction)),
    false,
  );
  for (const overrides of [
    { altKey: true },
    { ctrlKey: true },
    { isComposing: true },
    { metaKey: true },
    { repeat: true },
    { shiftKey: true },
  ]) {
    assert.equal(
      shouldActivatePublicBookingPrimaryAction(event(textInput, overrides)),
      false,
    );
  }
});

test("public flow uses the organization's Portuguese locale after async initialization", async () => {
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
          locale: "pt-BR",
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
    assert.ok(
      view.getByRole("heading", { name: "Escolha a unidade e a idade" }),
    ),
  );
  assert.equal(catalogCalls, 1);
  assert.ok(view.getByRole("button", { name: "Menos de 1 ano" }));
  assert.ok(view.getByRole("button", { name: "5 anos" }));
  assert.match(
    view.getByTestId("airhop-public-header").textContent,
    /Agendamento on-line · Каляка Маляка/,
  );
  assert.doesNotMatch(
    view.getByTestId("airhop-public-header").textContent,
    /Airhop/,
  );
  assert.match(
    view.getByTestId("airhop-public-footer").textContent,
    /Desenvolvido com AirHop/,
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
    "/airhop/mark.png",
  );
  cleanup();
});

test("public flow uses the requested Portuguese locale while the catalog is loading", async () => {
  const { StrictMode, createElement } = await import("react");
  const { cleanup, render, waitFor } = await import("@testing-library/react");
  const { PublicBookingProvider } = await import(
    "../data/PublicBookingProvider.tsx"
  );
  const { PublicBookingFlow } = await import("./PublicBookingFlow.tsx");
  let resolveCatalog;
  const catalogPromise = new Promise((resolve) => {
    resolveCatalog = resolve;
  });
  const service = {
    getCatalog: () => catalogPromise,
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
        createElement(PublicBookingFlow, {
          configuration: { initialLocale: "pt-BR" },
          mode: "standalone",
        }),
      ),
    ),
  );

  assert.ok(view.getByText("Carregando aulas disponíveis…"));
  assert.equal(view.queryByText("Загружаем доступные занятия…"), null);
  assert.equal(document.documentElement.lang, "pt-BR");

  resolveCatalog({
    organization: {
      id: "airhop",
      name: "Hygge",
      locale: "pt-BR",
      timeZone: "America/Sao_Paulo",
      currentDate: "2026-09-15",
      publicBooking: { purpose: "trial", appearance: "automatic" },
    },
    branches: [],
  });
  await waitFor(() =>
    assert.ok(
      view.getByRole("heading", { name: "Escolha a unidade e a idade" }),
    ),
  );
  cleanup();
});
