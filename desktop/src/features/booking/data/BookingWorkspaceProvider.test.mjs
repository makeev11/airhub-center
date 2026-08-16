import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

import { DEMO_BOOKING_WORKSPACE } from "../model/demoSchedule.ts";
import { parseBookingWorkspace } from "../model/bookingCore.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
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

test("BookingWorkspaceProvider loads once and publishes saved revisions", async () => {
  const { StrictMode, createElement } = await import("react");
  const { cleanup, fireEvent, render, waitFor } = await import(
    "@testing-library/react"
  );
  const { BookingWorkspaceProvider, useBookingWorkspace } = await import(
    "./BookingWorkspaceProvider.tsx"
  );
  const { BookingWorkspaceGate } = await import(
    "../ui/BookingWorkspaceState.tsx"
  );
  let stored = parseBookingWorkspace(structuredClone(DEMO_BOOKING_WORKSPACE));
  let loadCalls = 0;
  const repository = {
    async load() {
      loadCalls += 1;
      return structuredClone(stored);
    },
    async save(draft, expectedRevision) {
      assert.equal(expectedRevision, stored.revision);
      stored = parseBookingWorkspace({
        ...structuredClone(draft),
        revision: expectedRevision + 1,
      });
      return structuredClone(stored);
    },
  };

  function Consumer() {
    const booking = useBookingWorkspace();
    return createElement(
      "div",
      null,
      createElement(
        "span",
        { "data-testid": "workspace-state" },
        `${booking.status}:${booking.workspace?.revision ?? "none"}:${booking.workspace?.organization.name ?? "none"}`,
      ),
      createElement(
        "button",
        {
          onClick: () =>
            void booking.save((current) => {
              const { revision: _revision, ...draft } = current;
              return {
                ...draft,
                organization: {
                  ...current.organization,
                  name: "Provider Updated",
                },
              };
            }),
        },
        "save",
      ),
    );
  }

  const view = render(
    createElement(
      StrictMode,
      null,
      createElement(
        BookingWorkspaceProvider,
        { repository },
        createElement(BookingWorkspaceGate, null, () =>
          createElement(Consumer),
        ),
      ),
    ),
  );
  await waitFor(() =>
    assert.equal(
      view.getByTestId("workspace-state").textContent,
      "ready:0:Каляка Маляка",
    ),
  );
  assert.equal(loadCalls, 1);

  fireEvent.click(view.getByRole("button", { name: "save" }));
  await waitFor(() =>
    assert.equal(
      view.getByTestId("workspace-state").textContent,
      "ready:1:Provider Updated",
    ),
  );
  cleanup();
});

test("a synchronous updater failure releases saving state and permits the next save", async () => {
  const { StrictMode, createElement, useState } = await import("react");
  const { cleanup, fireEvent, render, waitFor } = await import(
    "@testing-library/react"
  );
  const { BookingWorkspaceProvider, useBookingWorkspace } = await import(
    "./BookingWorkspaceProvider.tsx"
  );
  let stored = parseBookingWorkspace(structuredClone(DEMO_BOOKING_WORKSPACE));
  let repositorySaveCalls = 0;
  const repository = {
    async load() {
      return structuredClone(stored);
    },
    async save(draft, expectedRevision) {
      repositorySaveCalls += 1;
      stored = parseBookingWorkspace({
        ...structuredClone(draft),
        revision: expectedRevision + 1,
      });
      return structuredClone(stored);
    },
  };

  function Consumer() {
    const booking = useBookingWorkspace();
    const [caught, setCaught] = useState("none");
    return createElement(
      "div",
      null,
      createElement(
        "span",
        { "data-testid": "save-boundary-state" },
        `${booking.workspace?.revision ?? "none"}:${booking.isSaving}:${booking.error?.message ?? "none"}:${caught}`,
      ),
      createElement(
        "button",
        {
          onClick: () =>
            void booking
              .save(() => {
                throw new Error("synchronous updater failure");
              })
              .catch((error) => setCaught(error.message)),
        },
        "throw synchronously",
      ),
      createElement(
        "button",
        {
          onClick: () =>
            void booking.save((current) => {
              const { revision: _revision, ...draft } = current;
              return {
                ...draft,
                organization: { ...current.organization, name: "Recovered" },
              };
            }),
        },
        "save after failure",
      ),
    );
  }

  const view = render(
    createElement(
      StrictMode,
      null,
      createElement(
        BookingWorkspaceProvider,
        { repository },
        createElement(Consumer),
      ),
    ),
  );
  await waitFor(() =>
    assert.match(
      view.getByTestId("save-boundary-state").textContent,
      /^0:false:/,
    ),
  );

  fireEvent.click(view.getByRole("button", { name: "throw synchronously" }));
  await waitFor(() =>
    assert.equal(
      view.getByTestId("save-boundary-state").textContent,
      "0:false:synchronous updater failure:synchronous updater failure",
    ),
  );
  assert.equal(repositorySaveCalls, 0);

  fireEvent.click(view.getByRole("button", { name: "save after failure" }));
  await waitFor(() =>
    assert.equal(
      view.getByTestId("save-boundary-state").textContent,
      "1:false:none:synchronous updater failure",
    ),
  );
  assert.equal(repositorySaveCalls, 1);
  cleanup();
});
