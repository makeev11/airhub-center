import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

before(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: dom.window.localStorage,
    Node: dom.window.Node,
    window: dom.window,
  });
});

after(() => dom.window.close());

test("fresh owner sees the recovered AirHop language and one-code flow", async () => {
  const { createElement } = await import("react");
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const { AirHopOwnerSetup } = await import("./AirHopOwnerSetup.tsx");
  localStorage.clear();
  const starts = [];
  const view = render(
    createElement(AirHopOwnerSetup, {
      defaultRelayUrl: "wss://center.example",
      onStart(relayUrl, code) {
        starts.push({ relayUrl, code });
      },
    }),
  );

  assert.ok(view.getByRole("heading", { name: "Set up your center" }));
  assert.deepEqual(
    view.getAllByRole("button").map((button) => button.textContent),
    ["English", "Русский"],
  );
  assert.equal(
    view.getByTestId("airhop-owner-background").getAttribute("src"),
    "/airhop/owner-background.jpg",
  );
  assert.equal(
    view.getByRole("img", { name: "Airhop" }).getAttribute("src"),
    "/airhop/mark.png",
  );
  assert.equal(view.queryByText("Join or create a community"), null);
  assert.equal(view.queryByTestId("community-choice-create"), null);

  fireEvent.click(view.getByRole("button", { name: "Русский" }));
  assert.ok(view.getByRole("heading", { name: "Подключите ваш центр" }));
  const code = view.getByLabelText("Код организации");
  fireEvent.change(code, { target: { value: "  OWNER-2026  " } });
  fireEvent.click(view.getByRole("button", { name: "Подключить центр" }));
  assert.deepEqual(starts, [
    { relayUrl: "wss://center.example", code: "OWNER-2026" },
  ]);
  cleanup();
});

test("a full invite keeps its signed Center destination", async () => {
  const { createElement } = await import("react");
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const { AirHopOwnerSetup } = await import("./AirHopOwnerSetup.tsx");
  localStorage.clear();
  const starts = [];
  const view = render(
    createElement(AirHopOwnerSetup, {
      defaultRelayUrl: "wss://default.example",
      onStart: (relayUrl, code) => starts.push({ relayUrl, code }),
    }),
  );
  fireEvent.click(view.getByRole("button", { name: "English" }));
  fireEvent.change(view.getByLabelText("Organization code"), {
    target: { value: "https://actual.example/invite/signed-code" },
  });
  fireEvent.click(view.getByRole("button", { name: "Connect center" }));
  assert.deepEqual(starts, [
    { relayUrl: "wss://actual.example", code: "signed-code" },
  ]);
  cleanup();
});
