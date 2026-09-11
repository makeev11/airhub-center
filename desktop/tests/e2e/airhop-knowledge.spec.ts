import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { knowledgeDocx, knowledgePdf } from "../helpers/knowledgeDocuments";

const communityId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
type Material = {
  id: string;
  version: number;
  publishedVersion: number | null;
  archived: boolean;
  updatedAt: string;
  draft: {
    title: string;
    topic: string;
    locale: string;
    audience: string;
    questions: { question: string; answer: string }[];
    markdown: string;
    scopeType: string;
    scopeId: string | null;
  };
  history: {
    version: number;
    operation: string;
    actor: null;
    createdAt: string;
  }[];
};
async function fixture(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem("airhop.locale.v1", "ru-RU"),
  );
  await installMockBridge(page);
  const docs = new Map<string, Material>();
  const published = new Map<string, unknown>();
  let unavailable = false;
  let conflicts = false;
  await page.route("**/api/airhop/knowledge/v1/**", async (route) => {
    if (unavailable) {
      await route.fulfill({
        status: 503,
        json: { error: "Test service unavailable" },
      });
      return;
    }
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/sources")) {
      await route.fulfill({
        json: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "guide.txt" },
      });
      return;
    }
    if (url.searchParams.get("view") === "parent_preview") {
      await route.fulfill({
        json: {
          documents: [...published.values()].filter((value) => {
            const d = value as { audience: string; markdown: string };
            return (
              d.audience === "parent" &&
              d.markdown
                .toLowerCase()
                .includes((url.searchParams.get("query") ?? "").toLowerCase())
            );
          }),
          isModelAnswer: false,
        },
      });
      return;
    }
    const id = url.searchParams.get("id");
    if (id) {
      await route.fulfill({ json: docs.get(id) });
      return;
    }
    await route.fulfill({
      json: {
        communityId,
        organizationId: communityId,
        locale: "ru-RU",
        nextCursor: null,
        items: [...docs.values()].map((d) => ({ ...d, ...d.draft })),
      },
    });
  });
  await page.route("**/events", async (route) => {
    const event = route.request().postDataJSON();
    if (event.kind !== 9050) {
      await route.fallback();
      return;
    }
    const input = JSON.parse(event.content),
      old = docs.get(input.id);
    if (conflicts || input.expectedVersion !== (old?.version ?? 0)) {
      await route.fulfill({
        status: 400,
        json: { error: "conflict: knowledge changed; reload before saving" },
      });
      return;
    }
    const version = (old?.version ?? 0) + 1,
      updatedAt = new Date().toISOString();
    const draft = input.draft ?? old?.draft;
    const material = {
      id: input.id,
      version,
      updatedAt,
      draft,
      archived: input.operation === "archive",
      publishedVersion:
        input.operation === "publish"
          ? version
          : input.operation === "archive"
            ? null
            : (old?.publishedVersion ?? null),
      history: [
        {
          version,
          operation: input.operation,
          actor: null,
          createdAt: updatedAt,
        },
        ...(old?.history ?? []),
      ],
    };
    docs.set(input.id, material);
    if (input.operation === "publish")
      published.set(input.id, {
        ...material,
        ...draft,
        markdown: [
          ...draft.questions
            .filter((q: { answer: string }) => q.answer.trim())
            .map(
              (q: { question: string; answer: string }) =>
                `## ${q.question}\n\n${q.answer}`,
            ),
          draft.markdown,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
    if (input.operation === "archive") published.delete(input.id);
    await route.fulfill({
      json: {
        accepted: true,
        message: JSON.stringify({ id: input.id, version }),
      },
    });
  });
  await page.goto("/#/booking/knowledge");
  return {
    docs,
    published,
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
    setConflicts: (value: boolean) => {
      conflicts = value;
    },
  };
}

test("knowledge onboarding, optional answers, draft isolation, publication and withdrawal", async ({
  page,
}) => {
  const state = await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Расскажите агентам о вашем центре" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Вы решаете, что знают агенты" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await page
    .getByRole("button", { name: "Ответить на вопросы", exact: true })
    .click();
  await page.getByRole("button", { name: /Первое посещение/ }).click();
  await page
    .getByRole("textbox", { name: "Ответ 1", exact: true })
    .fill("Возьмите воду и сменную обувь.");
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "К публикации", exact: true }),
  ).toBeEnabled();
  expect(state.published.size).toBe(0);
  await page.getByRole("button", { name: "К публикации", exact: true }).click();
  await expect(
    page.getByText("Какую одежду и обувь выбрать?", { exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", {
      name: "Опубликовать проверенный материал",
      exact: true,
    })
    .click();
  await expect(page.getByText(/Агенты используют версию 2/)).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/knowledge-published.png" });
  await page
    .getByRole("button", { name: "Что увидит Гермес", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Проверочный вопрос", exact: true })
    .fill("обувь");
  await page
    .getByRole("button", { name: "Проверить источники", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Первое посещение", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Возьмите воду и сменную обувь.", { exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/knowledge-parent-preview.png" });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /Первое посещение.*Опубликовано/ })
    .click();
  await page.getByText("История и архив", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Убрать в архив", exact: true })
    .click();
  await expect.poll(() => state.published.size).toBe(0);
});

test("document import runs on demand, remains private and does not auto-publish", async ({
  page,
}) => {
  const parsers: string[] = [];
  page.on("request", (req) => {
    if (/knowledgeImport.worker|pdf.worker/.test(req.url()))
      parsers.push(req.url());
  });
  const state = await fixture(page);
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  expect(parsers).toEqual([]);
  await page
    .getByLabel("Документ для базы знаний", { exact: true })
    .setInputFiles({
      name: "Подготовка.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("На первое занятие возьмите воду."),
    });
  await expect(
    page.getByRole("textbox", { name: "Текст материала", exact: true }),
  ).toHaveValue("На первое занятие возьмите воду.");
  expect(parsers.length).toBeGreaterThan(0);
  await page
    .getByLabel("Доступ к материалу", { exact: true })
    .selectOption("staff");
  await expect(
    page.getByRole("checkbox", {
      name: /Можно использовать для подготовки сайта/,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect.poll(() => state.docs.size).toBe(1);
  expect(state.published.size).toBe(0);
});

test("conflicts preserve the editor and server failures do not show a fake empty success", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page
    .getByRole("button", { name: "Написать свой текст", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Название материала", exact: true })
    .fill("Правила");
  await page
    .getByRole("textbox", { name: "Текст материала", exact: true })
    .fill("Мой несохранённый текст");
  state.setConflicts(true);
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("conflict");
  await expect(
    page.getByRole("textbox", { name: "Текст материала", exact: true }),
  ).toHaveValue("Мой несохранённый текст");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  state.setUnavailable(true);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Test service unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Ответить на вопросы", exact: true }),
  ).not.toBeVisible();
});

for (const extension of ["pdf", "docx"] as const) {
  test(`real ${extension} worker imports text into a persisted private draft`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page.getByRole("button", { name: "Пропустить", exact: true }).click();
    await page
      .getByLabel("Документ для базы знаний", { exact: true })
      .setInputFiles({
        name: `Guide.${extension}`,
        mimeType: "application/octet-stream",
        buffer:
          extension === "pdf"
            ? knowledgePdf("Bring water to the first lesson.")
            : knowledgeDocx(),
      });
    const expected =
      extension === "pdf"
        ? "Bring water to the first lesson."
        : "Возьмите воду и сменную обувь.";
    await expect(
      page.getByRole("textbox", { name: "Текст материала", exact: true }),
    ).toHaveValue(new RegExp(expected));
    expect([...state.docs.values()][0].draft.markdown).toContain(expected);
    expect(state.published.size).toBe(0);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Guide.*Черновик/ }),
    ).toBeVisible();
  });
}

test("unreadable PDF preserves the original-linked draft and explains manual recovery", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page
    .getByLabel("Документ для базы знаний", { exact: true })
    .setInputFiles({
      name: "Scan.pdf",
      mimeType: "application/pdf",
      buffer: knowledgePdf(""),
    });
  await expect(
    page.getByRole("textbox", { name: "Текст материала", exact: true }),
  ).toHaveValue("");
  expect(state.docs.size).toBe(1);
  expect(state.published.size).toBe(0);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(
    page.getByText(/Оригинал сохранён. Добавьте текст вручную/),
  ).toBeVisible();
});

test("public booking does not download the private knowledge screen or document parsers", async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /KnowledgeBaseScreen|knowledgeImport.worker|pdf.worker/.test(
        request.url(),
      )
    )
      privateRequests.push(request.url());
  });
  await page.clock.setFixedTime(new Date("2026-08-04T09:00:00.000Z"));
  await installMockBridge(page);
  await page.goto("/#/booking");
  await expect(page.getByTestId("airhop-public-standalone")).toBeVisible();
  expect(privateRequests).toEqual([]);
});

test("upload errors stay visible after the material list refresh", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.route("**/api/airhop/knowledge/v1/sources", (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Test upload failed" },
    }),
  );
  await page
    .getByLabel("Документ для базы знаний", { exact: true })
    .setInputFiles({
      name: "Guide.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Bring water."),
    });
  await expect(page.getByRole("alert")).toContainText("Test upload failed");
  await expect(
    page.getByRole("button", { name: "Добавить документ", exact: true }),
  ).toBeEnabled();
  expect(state.docs.size).toBe(0);
});
