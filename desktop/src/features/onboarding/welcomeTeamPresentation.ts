import type { AirhopWelcomeRole } from "./welcomeTeamLocale";

export type WelcomeTeamPresentation = Readonly<{
  role: AirhopWelcomeRole;
  animationUrl: string;
}>;

/**
 * Product-role presentation used while the registered Welcome team starts.
 * The character assignment mirrors the built-in persona avatars in Tauri.
 */
export const WELCOME_TEAM_PRESENTATIONS = [
  {
    role: "fizz",
    animationUrl: "/agents/fizz.png",
  },
  {
    role: "administrator",
    animationUrl: "/agents/administrator.png",
  },
  {
    role: "analyst",
    animationUrl: "/agents/analyst.png",
  },
  {
    role: "content_marketer",
    animationUrl: "/agents/editor.png",
  },
] as const satisfies readonly WelcomeTeamPresentation[];
