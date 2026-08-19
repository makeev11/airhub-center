import assert from "node:assert/strict";
import test from "node:test";

import * as themeLoader from "./theme-loader.ts";
import { getThemeFallbackPreviewVars } from "./useThemePreviewVars.ts";

const OPENAI_LIGHT = "openai-light";
const OPENAI_DARK = "openai-dark";

test("OpenAI ships as a light and dark pair that follows the system", () => {
  assert.ok(themeLoader.SYNTAX_THEMES.includes(OPENAI_LIGHT));
  assert.ok(themeLoader.SYNTAX_THEMES.includes(OPENAI_DARK));
  assert.equal(themeLoader.isLightTheme(OPENAI_LIGHT), true);
  assert.equal(themeLoader.isLightTheme(OPENAI_DARK), false);
  assert.equal(themeLoader.resolveSystemTheme(OPENAI_LIGHT, true), OPENAI_DARK);
  assert.equal(
    themeLoader.resolveSystemTheme(OPENAI_DARK, false),
    OPENAI_LIGHT,
  );
});

test("OpenAI keeps its brand capitalization in the appearance picker", () => {
  assert.equal(themeLoader.formatThemeLabel?.(OPENAI_LIGHT), "OpenAI Light");
  assert.equal(themeLoader.formatThemeLabel?.(OPENAI_DARK), "OpenAI Dark");
});

test("OpenAI theme data exposes the Codex editor and status palette", async () => {
  assert.ok(themeLoader.SYNTAX_THEMES.includes(OPENAI_LIGHT));
  assert.ok(themeLoader.SYNTAX_THEMES.includes(OPENAI_DARK));

  const light = await themeLoader.loadThemeData(OPENAI_LIGHT);
  const dark = await themeLoader.loadThemeData(OPENAI_DARK);
  const lightInfo = themeLoader.extractThemeInfo(OPENAI_LIGHT, light);
  const darkInfo = themeLoader.extractThemeInfo(OPENAI_DARK, dark);

  assert.deepEqual(
    {
      background: lightInfo.bg,
      foreground: lightInfo.fg,
      comment: lightInfo.comment,
      added: lightInfo.added,
      deleted: lightInfo.deleted,
      modified: lightInfo.modified,
    },
    {
      background: "#ffffff",
      foreground: "#1a1c1f",
      comment: "#a0a1a7",
      added: "#00a240",
      deleted: "#e02e2a",
      modified: "#e25507",
    },
  );
  assert.deepEqual(
    {
      background: darkInfo.bg,
      foreground: darkInfo.fg,
      comment: darkInfo.comment,
      added: darkInfo.added,
      deleted: darkInfo.deleted,
      modified: darkInfo.modified,
    },
    {
      background: "#181818",
      foreground: "#dfdfdf",
      comment: "#8f8f8f",
      added: "#40c977",
      deleted: "#ff6764",
      modified: "#ff8549",
    },
  );
  assert.equal(themeLoader.resolveShikiThemeName(OPENAI_LIGHT), OPENAI_LIGHT);
  assert.equal(themeLoader.resolveShikiThemeName(OPENAI_DARK), OPENAI_DARK);
});

test("OpenAI code highlighting uses the current Codex token palette", async () => {
  const { createHighlighter } = await import("shiki");
  const light = await themeLoader.loadThemeData(OPENAI_LIGHT);
  const dark = await themeLoader.loadThemeData(OPENAI_DARK);
  const highlighter = await createHighlighter({
    langs: ["typescript"],
    themes: [light, dark],
  });

  try {
    const code = 'const answer = "ready";';
    const tokenColors = (theme) =>
      highlighter
        .codeToTokens(code, { lang: "typescript", theme })
        .tokens.flat()
        .map((token) => token.color?.toLowerCase())
        .filter(Boolean);

    const lightColors = tokenColors(OPENAI_LIGHT);
    const darkColors = tokenColors(OPENAI_DARK);

    assert.ok(
      lightColors.includes("#a626a4"),
      `light keywords should be Codex purple: ${lightColors.join(", ")}`,
    );
    assert.ok(
      lightColors.includes("#50a14f"),
      `light strings should be Codex green: ${lightColors.join(", ")}`,
    );
    assert.ok(
      darkColors.includes("#2e95d3"),
      `dark keywords should be Codex blue: ${darkColors.join(", ")}`,
    );
    assert.ok(
      darkColors.includes("#00a67d"),
      `dark strings should be Codex green: ${darkColors.join(", ")}`,
    );
  } finally {
    highlighter.dispose();
  }
});

test("OpenAI preview fallback uses the fixed skin palette", () => {
  const light = getThemeFallbackPreviewVars(OPENAI_LIGHT);
  const dark = getThemeFallbackPreviewVars(OPENAI_DARK);

  assert.equal(light["--sidebar-active"], "216.0 8.77% 11.2% / 5%");
  assert.equal(light["--sidebar-accent"], "216.0 8.77% 11.2% / 5%");
  assert.equal(dark["--sidebar-active"], "0 0% 100.0% / 5%");
  assert.equal(dark["--sidebar-accent"], "0 0% 100.0% / 8%");
});

test("OpenAI appearance keeps Codex navigation neutral", async () => {
  const openAITheme = await import("./openai-theme.ts").catch(() => null);
  assert.ok(openAITheme?.getOpenAIThemeAppearance);

  assert.equal(openAITheme.isOpenAITheme(OPENAI_LIGHT), true);
  assert.equal(openAITheme.isOpenAITheme(OPENAI_DARK), true);
  assert.equal(openAITheme.isOpenAITheme("slack-dark"), false);

  const light = openAITheme.getOpenAIThemeAppearance(OPENAI_LIGHT);
  const dark = openAITheme.getOpenAIThemeAppearance(OPENAI_DARK);

  assert.deepEqual(
    {
      accent: light.accent,
      background: light.vars["--background"],
      foreground: light.vars["--foreground"],
      muted: light.vars["--muted"],
      mutedForeground: light.vars["--muted-foreground"],
      sidebar: light.vars["--sidebar-background"],
      border: light.vars["--border"],
      primary: light.vars["--primary"],
      primaryForeground: light.vars["--primary-foreground"],
      sidebarActive: light.vars["--sidebar-active"],
      sidebarActiveForeground: light.vars["--sidebar-active-foreground"],
      sidebarHover: light.vars["--sidebar-accent"],
    },
    {
      accent: "neutral",
      background: "0 0% 100.0%",
      foreground: "216.0 8.77% 11.2%",
      muted: "0 0% 95.3%",
      mutedForeground: "210.0 0.88% 55.7%",
      sidebar: "0 0% 97.6%",
      border: "0 0% 92.9%",
      primary: "216.0 8.77% 11.2%",
      primaryForeground: "0 0% 100.0%",
      sidebarActive: "216.0 8.77% 11.2% / 5%",
      sidebarActiveForeground: "216.0 8.77% 11.2%",
      sidebarHover: "216.0 8.77% 11.2% / 5%",
    },
  );
  assert.deepEqual(
    {
      accent: dark.accent,
      background: dark.vars["--background"],
      foreground: dark.vars["--foreground"],
      muted: dark.vars["--muted"],
      mutedForeground: dark.vars["--muted-foreground"],
      sidebar: dark.vars["--sidebar-background"],
      border: dark.vars["--border"],
      primary: dark.vars["--primary"],
      primaryForeground: dark.vars["--primary-foreground"],
      sidebarActive: dark.vars["--sidebar-active"],
      sidebarActiveForeground: dark.vars["--sidebar-active-foreground"],
      sidebarHover: dark.vars["--sidebar-accent"],
    },
    {
      accent: "neutral",
      background: "0 0% 9.4%",
      foreground: "0 0% 87.5%",
      muted: "0 0% 12.9%",
      mutedForeground: "0 0% 56.1%",
      sidebar: "0 0% 0.0%",
      border: "0 0% 15.7%",
      primary: "0 0% 87.5%",
      primaryForeground: "0 0% 9.4%",
      sidebarActive: "0 0% 100.0% / 5%",
      sidebarActiveForeground: "0 0% 87.5%",
      sidebarHover: "0 0% 100.0% / 8%",
    },
  );
  assert.equal(openAITheme.getOpenAIThemeAppearance("slack-dark"), null);
});
