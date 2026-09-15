import { test, expect } from "@playwright/test";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

for (const width of [320, 390]) {
  test(`phone ${width}: visible composer, touch send, compact chrome and draft return`, async ({
    page,
    isMobile,
  }, info) => {
    test.skip(!isMobile, "Phone-only layout and touch contract");
    await page.setViewportSize({ width, height: 720 });
    // Deliberate API simulation, not a claim about a physical software keyboard.
    await page.addInitScript(() => {
      let height: number | null = null;
      let top = 0;
      const viewport = new EventTarget();
      Object.defineProperties(viewport, {
        height: { get: () => height ?? innerHeight },
        width: { get: () => innerWidth },
        offsetTop: { get: () => top },
        offsetLeft: { get: () => 0 },
        scale: { get: () => 1 },
      });
      Object.defineProperty(window, "visualViewport", {
        value: viewport,
        configurable: true,
      });
      (
        window as unknown as {
          setChatTestViewport: (height: number | null, top: number) => void;
        }
      ).setChatTestViewport = (next, offset) => {
        height = next;
        top = offset;
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("scroll"));
      };
    });
    await page.goto("/chat");
    await expect(
      page.getByRole("heading", { name: "# Команда" }),
    ).toBeVisible();
    await expect(
      page.locator(".chat-product img, .chat-sidebar-brand img"),
    ).toHaveCount(0);
    await expect(page.locator(".chat-topbar")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Жирный текст", exact: true }),
    ).toBeHidden();
    for (const name of [
      "← Чаты",
      "Поиск по чату",
      "Прикрепить файл",
      "Форматирование",
      "Отправить",
    ]) {
      const box = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(box?.width, `${name}: width`).toBeGreaterThanOrEqual(44);
      expect(box?.height, `${name}: height`).toBeGreaterThanOrEqual(44);
    }
    const field = page.getByLabel("Сообщение", { exact: true });
    await expect(field).toHaveCSS("font-size", "16px");
    await waitForAnimations(page);
    await page.screenshot({ path: info.outputPath("phone-conversation.png") });
    const body =
      `Телефон ${width} ${info.project.name}\n${"Длинное сообщение\n".repeat(16)}`.trim();
    await field.tap();
    await field.fill(body);
    await page.evaluate(() =>
      (
        window as unknown as {
          setChatTestViewport: (height: number | null, top: number) => void;
        }
      ).setChatTestViewport(300, 40),
    );
    await expect(page.locator(".chat-viewport")).toHaveAttribute(
      "data-keyboard",
      "true",
    );
    const inputBox = await field.boundingBox();
    const send = page.getByRole("button", { name: "Отправить", exact: true });
    const sendBox = await send.boundingBox();
    expect(inputBox?.y).toBeGreaterThanOrEqual(40);
    expect((sendBox?.y ?? 0) + (sendBox?.height ?? 0)).toBeLessThanOrEqual(340);
    await send.tap();
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
    await expect(
      page
        .locator("article")
        .filter({ hasText: `Телефон ${width} ${info.project.name}` }),
    ).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: info.outputPath("phone-visible-area-simulation.png"),
    });
    await page.evaluate(() =>
      (
        window as unknown as {
          setChatTestViewport: (height: number | null, top: number) => void;
        }
      ).setChatTestViewport(null, 0),
    );
    await expect(page.locator(".chat-viewport")).toHaveAttribute(
      "data-keyboard",
      "false",
    );
    await field.fill("Сохранить при возврате");
    await page.getByRole("button", { name: "← Чаты", exact: true }).tap();
    await expect(page.locator(".chat-channel-preview").first()).toBeVisible();
    await page.getByRole("button", { name: "# Команда", exact: true }).tap();
    await expect(field).toHaveValue("Сохранить при возврате");
    await field.fill("");
    await page.getByRole("button", { name: "Поиск по чату" }).tap();
    await expect(page.getByLabel("Поиск в переписке")).toBeFocused();
    await page.getByRole("button", { name: "Закрыть поиск" }).tap();
    await expect(page.locator(".chat-topbar")).toBeHidden();
    await page.setViewportSize({ width: 640, height: 320 });
    await expect(field).toBeVisible();
    await expect(send).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
