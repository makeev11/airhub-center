import type { ThemeRegistrationRaw } from "shiki";
import { hexToHsl } from "./adaptive-theme";

export const OPENAI_LIGHT_THEME_NAME = "openai-light";
export const OPENAI_DARK_THEME_NAME = "openai-dark";

export type OpenAIThemeName =
  | typeof OPENAI_LIGHT_THEME_NAME
  | typeof OPENAI_DARK_THEME_NAME;

type TokenSetting = {
  scope?: string | readonly string[];
  settings: {
    background?: string;
    fontStyle?: string;
    foreground?: string;
  };
};

type OpenAISyntaxPalette = {
  foreground: string;
  comment: string;
  meta: string;
  builtIn: string;
  keyword: string;
  tag: string;
  literal: string;
  string: string;
  variable: string;
  title: string;
};

type OpenAIThemePalette = {
  type: "light" | "dark";
  background: string;
  sidebar: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  elevated: string;
  border: string;
  input: string;
  accent: string;
  destructive: string;
  added: string;
  deleted: string;
  modified: string;
  syntax: OpenAISyntaxPalette;
  terminal: Readonly<Record<string, string>>;
};

export type OpenAIThemeAppearance = {
  accent: string;
  vars: Readonly<Record<string, string>>;
};

const SHARED_BRIGHT_TERMINAL_COLORS = {
  "terminal.ansiBrightBlack": "#000000",
  "terminal.ansiBrightRed": "#f44a4c",
  "terminal.ansiBrightGreen": "#59d24e",
  "terminal.ansiBrightYellow": "#f87915",
  "terminal.ansiBrightBlue": "#006aff",
  "terminal.ansiBrightMagenta": "#9840ff",
  "terminal.ansiBrightCyan": "#20b8ff",
  "terminal.ansiBrightWhite": "#828282",
} as const;

const OPENAI_THEME_PALETTES: Readonly<
  Record<OpenAIThemeName, OpenAIThemePalette>
> = {
  [OPENAI_LIGHT_THEME_NAME]: {
    type: "light",
    background: "#ffffff",
    sidebar: "#f9f9f9",
    foreground: "#1a1c1f",
    muted: "#f3f3f3",
    mutedForeground: "#8d8e8f",
    elevated: "#ffffff",
    border: "#ededed",
    input: "#dfdfdf",
    accent: "#339cff",
    destructive: "#e02e2a",
    added: "#00a240",
    deleted: "#e02e2a",
    modified: "#e25507",
    syntax: {
      foreground: "#383a42",
      comment: "#a0a1a7",
      meta: "#4078f2",
      builtIn: "#c18401",
      keyword: "#a626a4",
      tag: "#e45649",
      literal: "#0184bb",
      string: "#50a14f",
      variable: "#986801",
      title: "#4078f2",
    },
    terminal: {
      "terminal.ansiBlack": "#000000",
      "terminal.ansiRed": "#d53538",
      "terminal.ansiGreen": "#008809",
      "terminal.ansiYellow": "#bd5800",
      "terminal.ansiBlue": "#001bcb",
      "terminal.ansiMagenta": "#751ed9",
      "terminal.ansiCyan": "#0071ea",
      "terminal.ansiWhite": "#666666",
      ...SHARED_BRIGHT_TERMINAL_COLORS,
    },
  },
  [OPENAI_DARK_THEME_NAME]: {
    type: "dark",
    background: "#181818",
    sidebar: "#000000",
    foreground: "#dfdfdf",
    muted: "#212121",
    mutedForeground: "#8f8f8f",
    elevated: "#282828",
    border: "#282828",
    input: "#393939",
    accent: "#99ceff",
    destructive: "#ff6764",
    added: "#40c977",
    deleted: "#ff6764",
    modified: "#ff8549",
    syntax: {
      foreground: "#ffffff",
      comment: "#8f8f8f",
      meta: "#a3a3a3",
      builtIn: "#e9950c",
      keyword: "#2e95d3",
      tag: "#f22c3d",
      literal: "#2e95d3",
      string: "#00a67d",
      variable: "#df3079",
      title: "#f22c3d",
    },
    terminal: {
      "terminal.ansiBlack": "#ffffff",
      "terminal.ansiRed": "#f67576",
      "terminal.ansiGreen": "#85df7b",
      "terminal.ansiYellow": "#fa994c",
      "terminal.ansiBlue": "#3d8dff",
      "terminal.ansiMagenta": "#b06dff",
      "terminal.ansiCyan": "#6dcbf4",
      "terminal.ansiWhite": "#999999",
      ...SHARED_BRIGHT_TERMINAL_COLORS,
    },
  },
};

export function isOpenAITheme(name: string): name is OpenAIThemeName {
  return name === OPENAI_LIGHT_THEME_NAME || name === OPENAI_DARK_THEME_NAME;
}

function createOpenAIThemeVars(
  palette: OpenAIThemePalette,
): Readonly<Record<string, string>> {
  const background = hexToHsl(palette.background);
  const foreground = hexToHsl(palette.foreground);
  const muted = hexToHsl(palette.muted);
  const elevated = hexToHsl(palette.elevated);
  const border = hexToHsl(palette.border);
  const accent = hexToHsl(palette.accent);
  const sidebarInteractionColor =
    palette.type === "light" ? foreground : hexToHsl("#ffffff");
  const sidebarActive = `${sidebarInteractionColor} / 5%`;
  const sidebarHover = `${sidebarInteractionColor} / ${
    palette.type === "light" ? "5%" : "8%"
  }`;

  return {
    "--background": background,
    "--card": background,
    "--popover": elevated,
    "--muted": muted,
    "--accent": muted,
    "--secondary": muted,
    "--primary": foreground,
    "--primary-foreground": background,
    "--foreground": foreground,
    "--card-foreground": foreground,
    "--popover-foreground": foreground,
    "--muted-foreground": hexToHsl(palette.mutedForeground),
    "--accent-foreground": foreground,
    "--secondary-foreground": foreground,
    "--destructive": hexToHsl(palette.destructive),
    "--destructive-foreground": background,
    "--border": border,
    "--input": hexToHsl(palette.input),
    "--ring": accent,
    "--sidebar-background": hexToHsl(palette.sidebar),
    "--sidebar-foreground": foreground,
    "--sidebar-primary": foreground,
    "--sidebar-primary-foreground": background,
    "--sidebar-active": sidebarActive,
    "--sidebar-active-foreground": foreground,
    "--sidebar-accent": sidebarHover,
    "--sidebar-accent-foreground": foreground,
    "--sidebar-border": border,
    "--sidebar-ring": accent,
    "--status-added": palette.added,
    "--status-deleted": palette.deleted,
    "--status-modified": palette.modified,
    "--ui-warning": palette.modified,
    "--ui-warning-bg": `${palette.modified}14`,
  };
}

function createOpenAITokenSettings(
  palette: OpenAIThemePalette,
): TokenSetting[] {
  const syntax = palette.syntax;
  return [
    {
      settings: {
        background: palette.background,
        foreground: syntax.foreground,
      },
    },
    {
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: syntax.comment, fontStyle: "italic" },
    },
    {
      scope: ["meta", "punctuation.definition", "punctuation.separator"],
      settings: { foreground: syntax.meta },
    },
    {
      scope: [
        "support.function",
        "support.class",
        "support.type",
        "entity.name.class",
        "entity.name.type",
      ],
      settings: { foreground: syntax.builtIn },
    },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier"],
      settings: { foreground: syntax.keyword },
    },
    {
      scope: ["entity.name.tag", "entity.name.section", "markup.deleted"],
      settings: { foreground: syntax.tag },
    },
    {
      scope: ["constant.language", "constant.character"],
      settings: { foreground: syntax.literal },
    },
    {
      scope: [
        "string",
        "string.regexp",
        "constant.other.symbol",
        "markup.inserted",
      ],
      settings: { foreground: syntax.string },
    },
    {
      scope: [
        "variable",
        "variable.parameter",
        "constant.numeric",
        "entity.other.attribute-name",
      ],
      settings: { foreground: syntax.variable },
    },
    {
      scope: [
        "entity.name",
        "entity.name.function",
        "markup.heading",
        "markup.underline.link",
      ],
      settings: { foreground: syntax.title },
    },
  ];
}

const OPENAI_THEME_APPEARANCES: Readonly<
  Record<OpenAIThemeName, OpenAIThemeAppearance>
> = {
  [OPENAI_LIGHT_THEME_NAME]: {
    accent: "neutral",
    vars: createOpenAIThemeVars(OPENAI_THEME_PALETTES[OPENAI_LIGHT_THEME_NAME]),
  },
  [OPENAI_DARK_THEME_NAME]: {
    accent: "neutral",
    vars: createOpenAIThemeVars(OPENAI_THEME_PALETTES[OPENAI_DARK_THEME_NAME]),
  },
};

export function getOpenAIThemeAppearance(
  name: string,
): OpenAIThemeAppearance | null {
  return isOpenAITheme(name) ? OPENAI_THEME_APPEARANCES[name] : null;
}

/** Apply the current Codex desktop palette to a bundled syntax theme shell. */
export function createOpenAIThemeData(
  name: OpenAIThemeName,
  baseTheme: ThemeRegistrationRaw,
): ThemeRegistrationRaw {
  const palette = OPENAI_THEME_PALETTES[name];
  const tokenSettings = createOpenAITokenSettings(palette);

  return {
    ...baseTheme,
    name,
    type: palette.type,
    colors: {
      ...baseTheme.colors,
      "editor.background": palette.background,
      "editor.foreground": palette.foreground,
      "editorCursor.foreground": palette.foreground,
      "editorCursor.background": palette.background,
      "gitDecoration.addedResourceForeground": palette.added,
      "gitDecoration.deletedResourceForeground": palette.deleted,
      "gitDecoration.modifiedResourceForeground": palette.modified,
      ...palette.terminal,
    },
    settings: tokenSettings,
    tokenColors: tokenSettings,
  } as ThemeRegistrationRaw;
}
