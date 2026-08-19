import type { ManagedAgent, RespondToMode } from "@/shared/api/types";
import type { AirHopLocale } from "@/shared/locale/airhopLocale";

export type AirhopAgentRole =
  | "fizz"
  | "administrator"
  | "analyst"
  | "content_marketer";

export type AirhopAgentDefinition = Readonly<{
  role: AirhopAgentRole;
  personaId: string;
  avatarUrl: string;
  name: Record<AirHopLocale, string>;
  roleLabel: Record<AirHopLocale, string>;
}>;

export const AIRHOP_AGENT_CATALOG = Object.freeze([
  {
    role: "fizz",
    personaId: "builtin:airhop-fizz",
    avatarUrl: "/agents/fizz.png",
    name: {
      "ru-RU": "Физ",
      "en-US": "Fizz",
      "tr-TR": "Fizz",
      "pt-BR": "Fizz",
    },
    roleLabel: {
      "ru-RU": "Руководитель команды",
      "en-US": "Team lead",
      "tr-TR": "Ekip lideri",
      "pt-BR": "Líder da equipe",
    },
  },
  {
    role: "administrator",
    personaId: "builtin:airhop-administrator",
    avatarUrl: "/agents/administrator.png",
    name: {
      "ru-RU": "Администратор",
      "en-US": "Administrator",
      "tr-TR": "Yönetici",
      "pt-BR": "Administrador",
    },
    roleLabel: {
      "ru-RU": "Расписание, дети, родители и оплаты",
      "en-US": "Schedules, children, parents, and payments",
      "tr-TR": "Programlar, çocuklar, veliler ve ödemeler",
      "pt-BR": "Horários, crianças, responsáveis e pagamentos",
    },
  },
  {
    role: "analyst",
    personaId: "builtin:airhop-analyst",
    avatarUrl: "/agents/analyst.png",
    name: {
      "ru-RU": "Аналитик",
      "en-US": "Analyst",
      "tr-TR": "Analist",
      "pt-BR": "Analista",
    },
    roleLabel: {
      "ru-RU": "Данные, показатели и текстовые отчёты",
      "en-US": "Data, metrics, and concise reports",
      "tr-TR": "Veriler, metrikler ve kısa raporlar",
      "pt-BR": "Dados, métricas e relatórios objetivos",
    },
  },
  {
    role: "content_marketer",
    personaId: "builtin:airhop-content-marketer",
    avatarUrl: "/agents/editor.png",
    name: {
      "ru-RU": "Контент-маркетолог",
      "en-US": "Content Marketer",
      "tr-TR": "İçerik Pazarlamacısı",
      "pt-BR": "Especialista de Conteúdo",
    },
    roleLabel: {
      "ru-RU": "Контент центра и материалы для публикации",
      "en-US": "Center content and publication materials",
      "tr-TR": "Merkez içeriği ve yayın materyalleri",
      "pt-BR": "Conteúdo do centro e materiais para publicação",
    },
  },
] as const satisfies readonly AirhopAgentDefinition[]);

export type AirhopAgentState =
  | "running"
  | "stopped"
  | "attention"
  | "unavailable";

export type AirhopAgentCardModel = Readonly<{
  role: AirhopAgentRole;
  personaId: string;
  pubkey: string | null;
  name: string;
  roleLabel: string;
  avatarUrl: string;
  model: string | null;
  state: AirhopAgentState;
  respondTo: RespondToMode | null;
}>;

export function materializeAirhopAgentCards(
  managedAgents: readonly ManagedAgent[],
  locale: AirHopLocale,
): AirhopAgentCardModel[] {
  return AIRHOP_AGENT_CATALOG.map((definition) => {
    const managed = managedAgents.find(
      (agent) => agent.personaId === definition.personaId,
    );
    const state: AirhopAgentState = !managed
      ? "unavailable"
      : managed.lastError
        ? "attention"
        : managed.status === "running" || managed.status === "deployed"
          ? "running"
          : "stopped";

    return {
      role: definition.role,
      personaId: definition.personaId,
      pubkey: managed?.pubkey ?? null,
      name: definition.name[locale],
      roleLabel: definition.roleLabel[locale],
      avatarUrl: definition.avatarUrl,
      model: managed?.model ?? null,
      state,
      respondTo: managed?.respondTo ?? null,
    };
  });
}
