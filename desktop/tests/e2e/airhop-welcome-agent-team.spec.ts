import assert from "node:assert/strict";

import { browser } from "@wdio/globals";

const selectorForTestId = (testId: string) => `[data-testid="${testId}"]`;
const activationCode = process.env.AIRHOP_E2E_ACTIVATION_CODE;
if (!activationCode) throw new Error("AIRHOP_E2E_ACTIVATION_CODE is required");
const screenshotPath = process.env.AIRHOP_E2E_SCREENSHOT_PATH;
type ManagedAgentVisual = Readonly<{
  avatar_url: string | null;
  persona_id: string | null;
  pubkey: string;
}>;

type RuntimeStatus = Readonly<{
  lifecycle: string;
  pubkey: string;
  relayUrl: string;
  error?: string | null;
}>;

async function bodyText() {
  return await browser.execute(() => document.body.innerText);
}

async function isVisible(selector: string) {
  return await browser.execute((candidate) => {
    const element = document.querySelector(candidate);
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      bounds.width > 0 &&
      bounds.height > 0
    );
  }, selector);
}

async function waitForVisible(selector: string, timeout = 120_000) {
  await browser.waitUntil(async () => await isVisible(selector), {
    interval: 250,
    timeout,
    timeoutMsg: `Expected ${selector} to be visible. Body: ${await bodyText()}`,
  });
}

async function waitForHidden(selector: string, timeout = 120_000) {
  await browser.waitUntil(async () => !(await isVisible(selector)), {
    interval: 250,
    timeout,
    timeoutMsg: `Expected ${selector} to be hidden. Body: ${await bodyText()}`,
  });
}

async function click(selector: string) {
  await browser.waitUntil(
    async () =>
      await browser.execute((candidate) => {
        const element = Array.from(document.querySelectorAll(candidate)).find(
          (node) =>
            node instanceof HTMLElement &&
            node.getBoundingClientRect().height > 0,
        );
        return Boolean(
          element &&
            (!(element instanceof HTMLButtonElement) || !element.disabled),
        );
      }, selector),
    {
      interval: 250,
      timeout: 120_000,
      timeoutMsg: `Expected ${selector} to become clickable. Body: ${await bodyText()}`,
    },
  );
  const clicked = await browser.execute((candidate) => {
    const elements = Array.from(document.querySelectorAll(candidate));
    const element = elements.find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const bounds = node.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!(element instanceof HTMLElement)) return false;
    if (element instanceof HTMLButtonElement && element.disabled) return false;
    element.click();
    return true;
  }, selector);
  assert.equal(clicked, true, `Could not click ${selector}`);
}

async function clickButtonWithText(text: string) {
  const clicked = await browser.execute((expected) => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) =>
        candidate.textContent?.trim() === expected &&
        !candidate.disabled &&
        candidate.getBoundingClientRect().height > 0,
    );
    if (!button) return false;
    button.click();
    return true;
  }, text);
  assert.equal(clicked, true, `Could not click button ${JSON.stringify(text)}`);
}

async function setInputValue(testId: string, value: string) {
  await waitForVisible(selectorForTestId(testId));
  const changed = await browser.execute(
    (selector, nextValue) => {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    selectorForTestId(testId),
    value,
  );
  assert.equal(changed, true, `Could not fill ${testId}`);
}

async function waitForText(text: string, timeout = 120_000) {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (expected) => document.body.innerText.includes(expected),
        text,
      ),
    {
      interval: 500,
      timeout,
      timeoutMsg: `Expected body to contain ${JSON.stringify(text)}. Body: ${await bodyText()}`,
    },
  );
}

async function onboardingDiagnostics() {
  return await browser.execute(async () => {
    const internals = (
      window as typeof window & {
        __TAURI_INTERNALS__: {
          invoke: (command: string) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const [relayHttpUrl, identity] = await Promise.allSettled([
      internals.invoke("get_relay_http_url"),
      internals.invoke("get_identity"),
    ]);
    return {
      hash: window.location.hash,
      identity,
      localStorage: Object.fromEntries(
        Array.from({ length: window.localStorage.length }, (_, index) => {
          const key = window.localStorage.key(index) ?? "";
          return [key, window.localStorage.getItem(key)];
        }),
      ),
      relayHttpUrl,
      sessionStorage: Object.fromEntries(
        Array.from({ length: window.sessionStorage.length }, (_, index) => {
          const key = window.sessionStorage.key(index) ?? "";
          return [key, window.sessionStorage.getItem(key)];
        }),
      ),
    };
  });
}

async function listManagedAgents() {
  return (await browser.execute(async () => {
    const internals = (
      window as typeof window & {
        __TAURI_INTERNALS__: {
          invoke: (command: string) => Promise<ManagedAgentVisual[]>;
        };
      }
    ).__TAURI_INTERNALS__;
    return await internals.invoke("list_managed_agents");
  })) as ManagedAgentVisual[];
}

async function listManagedAgentRuntimes() {
  return (await browser.execute(async () => {
    const internals = (
      window as typeof window & {
        __TAURI_INTERNALS__: {
          invoke: (command: string) => Promise<RuntimeStatus[]>;
        };
      }
    ).__TAURI_INTERNALS__;
    return await internals.invoke("list_managed_agent_runtimes");
  })) as RuntimeStatus[];
}

async function waitForWelcomeRuntimesReady(timeout = 30_000) {
  let lastStatuses: RuntimeStatus[] = [];
  try {
    await browser.waitUntil(
      async () => {
        lastStatuses = await listManagedAgentRuntimes();
        return (
          lastStatuses.length === 4 &&
          lastStatuses.every((status) =>
            ["listening", "ready"].includes(status.lifecycle),
          )
        );
      },
      { interval: 500, timeout },
    );
  } catch {
    throw new Error(
      `Expected four ready Welcome runtimes, got ${JSON.stringify(lastStatuses)}`,
    );
  }
}

describe("Airhop Welcome agent team", () => {
  it("activates the first owner and runs the flat Welcome kickoff in native Tauri", async () => {
    const nativeTauri = await browser.execute(
      () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window,
    );
    assert.equal(nativeTauri, true, "test must run inside the Tauri webview");

    await waitForVisible(selectorForTestId("airhop-owner-setup"));
    assert.equal(
      await isVisible(selectorForTestId("machine-onboarding-gate")),
      false,
      "fresh AirHop owners must not see inherited Buzz machine onboarding",
    );
    if (screenshotPath) {
      await browser.saveScreenshot(
        screenshotPath.replace(/\.png$/i, "-first-run.png"),
      );
    }

    await clickButtonWithText("Русский");
    await setInputValue("airhop-owner-code", activationCode);
    await click(selectorForTestId("airhop-owner-connect"));

    try {
      await waitForVisible(
        selectorForTestId("community-profile-name-key"),
        20_000,
      );
    } catch (error) {
      throw new Error(
        `${String(error)} Diagnostics: ${JSON.stringify(await onboardingDiagnostics())}`,
      );
    }
    assert.equal(
      await browser.execute(
        () =>
          document
            .querySelector('[data-testid="airhop-owner-profile-background"]')
            ?.getAttribute("src") ?? null,
      ),
      "/airhop/owner-background.jpg",
    );
    if (screenshotPath) {
      await browser.saveScreenshot(
        screenshotPath.replace(/\.png$/i, "-profile.png"),
      );
    }
    await setInputValue("community-profile-name-key", "Андрей E2E");
    await click(selectorForTestId("community-profile-next"));

    try {
      await waitForVisible(selectorForTestId("channel-Welcome"));
    } catch (error) {
      throw new Error(
        `${String(error)} Diagnostics: ${JSON.stringify(await onboardingDiagnostics())}`,
      );
    }
    assert.equal(
      await browser.execute(
        () =>
          document.querySelectorAll('[data-testid^="starter-persona-"]').length,
      ),
      0,
      "first owner must enter Welcome without the inherited animated team screen",
    );
    await click(selectorForTestId("channel-Welcome"));
    await waitForHidden(selectorForTestId("community-onboarding-flow"));
    await waitForText("Это начало закрытого приветственного канала.");
    await waitForText("или другого коллегу, когда понадобится помощь.");

    const brand = await browser.execute(() => ({
      markCount: document.querySelectorAll(
        '[data-testid="sidebar-airhop-wordmark"] img[src="/airhop/mark.png"]',
      ).length,
      title: document.title,
    }));
    assert.equal(
      brand.title,
      "Airhop",
      "native test must use the AirHop shell",
    );
    assert.ok(
      brand.markCount > 0,
      "native test must render the canonical AirHop mark",
    );

    await waitForText("Welcome");
    await waitForWelcomeRuntimesReady();

    const welcomeAgents = (await listManagedAgents()).filter((agent) =>
      agent.persona_id?.startsWith("builtin:airhop-"),
    );
    assert.equal(
      welcomeAgents.length,
      4,
      "native test must provision the four-role Airhop product team",
    );
    const avatars = Object.fromEntries(
      welcomeAgents.map((agent) => [agent.persona_id, agent.avatar_url]),
    );
    for (const personaId of [
      "builtin:airhop-fizz",
      "builtin:airhop-administrator",
      "builtin:airhop-analyst",
      "builtin:airhop-content-marketer",
    ]) {
      assert.ok(
        avatars[personaId],
        `${personaId} must have its assigned avatar`,
      );
    }
    assert.notEqual(
      avatars["builtin:airhop-fizz"],
      avatars["builtin:airhop-administrator"],
    );
    assert.notEqual(
      avatars["builtin:airhop-analyst"],
      avatars["builtin:airhop-administrator"],
    );
    assert.equal(
      avatars["builtin:airhop-administrator"],
      avatars["builtin:airhop-content-marketer"],
      "Administrator and Content Marketer intentionally share Honey",
    );

    if (screenshotPath) {
      await browser.saveScreenshot(screenshotPath);
    }

    await waitForText("Привет! Я Физ, руководитель вашей команды Airhop.");
    await waitForText(
      "Я Администратор. Помогаю с расписанием, детьми, родителями и оплатами.",
    );
    await waitForText("Я Аналитик. Готовлю короткие отчёты по данным центра.");
    await waitForText(
      "Я Контент-маркетолог. Помогаю готовить публичные материалы.",
    );
    await waitForText("Как называется ваш центр?");

    assert.equal(
      await browser.execute(
        () => document.querySelector("[data-testid='thread-pane']") !== null,
      ),
      false,
      "Welcome kickoff must stay in the flat channel timeline",
    );
  });
});
