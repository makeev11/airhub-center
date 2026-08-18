export type AirhopWelcomeRole =
  | "fizz"
  | "administrator"
  | "analyst"
  | "content_marketer";

export type WelcomeKickoffStage =
  | "fizz_intro"
  | "administrator_intro"
  | "analyst_intro"
  | "content_marketer_intro"
  | "fizz_first_question";

export type WelcomeRoleDefinition = Readonly<{
  role: AirhopWelcomeRole;
  personaId: string;
  name: string;
  roleLabel: string;
  aliases: readonly string[];
}>;

export type WelcomeLocalePack = Readonly<{
  language: "ru" | "en" | "pt";
  names: Record<AirhopWelcomeRole, string>;
  roleLabels: Record<AirhopWelcomeRole, string>;
  aliases: Record<AirhopWelcomeRole, readonly string[]>;
  providerRequired: string;
  specialistUnavailable: (role: AirhopWelcomeRole) => string;
  kickoffInstruction: (
    stage: WelcomeKickoffStage,
    ownerName?: string,
  ) => string;
}>;

const PERSONA_IDS: Record<AirhopWelcomeRole, string> = {
  fizz: "builtin:airhop-fizz",
  administrator: "builtin:airhop-administrator",
  analyst: "builtin:airhop-analyst",
  content_marketer: "builtin:airhop-content-marketer",
};

const RU_NAMES: Record<AirhopWelcomeRole, string> = {
  fizz: "\u0424\u0438\u0437",
  administrator:
    "\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440",
  analyst: "\u0410\u043d\u0430\u043b\u0438\u0442\u0438\u043a",
  content_marketer:
    "\u041a\u043e\u043d\u0442\u0435\u043d\u0442-\u043c\u0430\u0440\u043a\u0435\u0442\u043e\u043b\u043e\u0433",
};

const EN_NAMES: Record<AirhopWelcomeRole, string> = {
  fizz: "Fizz",
  administrator: "Administrator",
  analyst: "Analyst",
  content_marketer: "Content Marketer",
};

const PT_NAMES: Record<AirhopWelcomeRole, string> = {
  fizz: "Fizz",
  administrator: "Administrador",
  analyst: "Analista",
  content_marketer: "Especialista de Conteudo",
};

const RU: WelcomeLocalePack = {
  language: "ru",
  names: RU_NAMES,
  roleLabels: {
    fizz: "\u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c \u043a\u043e\u043c\u0430\u043d\u0434\u044b",
    administrator:
      "\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440",
    analyst: "\u0430\u043d\u0430\u043b\u0438\u0442\u0438\u043a",
    content_marketer:
      "\u043a\u043e\u043d\u0442\u0435\u043d\u0442-\u043c\u0430\u0440\u043a\u0435\u0442\u043e\u043b\u043e\u0433",
  },
  aliases: {
    fizz: ["\u0424\u0438\u0437", "Fizz"],
    administrator: [
      "\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440",
      "\u0410\u0434\u043c\u0438\u043d",
    ],
    analyst: ["\u0410\u043d\u0430\u043b\u0438\u0442\u0438\u043a"],
    content_marketer: [
      "\u041a\u043e\u043d\u0442\u0435\u043d\u0442-\u043c\u0430\u0440\u043a\u0435\u0442\u043e\u043b\u043e\u0433",
      "\u041a\u043e\u043d\u0442\u0435\u043d\u0442",
    ],
  },
  providerRequired:
    "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u0435 AI-\u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440\u0430 \u0432 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430\u0445. \u041f\u043e\u0441\u043b\u0435 \u044d\u0442\u043e\u0433\u043e \u043a\u043e\u043c\u0430\u043d\u0434\u0430 Airhop \u0441\u043c\u043e\u0436\u0435\u0442 \u043d\u0430\u0447\u0430\u0442\u044c.",
  specialistUnavailable: (role) =>
    RU_NAMES[role] +
    " \u0441\u0435\u0439\u0447\u0430\u0441 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d. \u042f \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u043b \u0437\u0430\u0434\u0430\u0447\u0443 \u2014 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0447\u0443\u0442\u044c \u043f\u043e\u0437\u0436\u0435.",
  kickoffInstruction: (stage, ownerName) => kickoff("ru", stage, ownerName),
};

const EN: WelcomeLocalePack = {
  language: "en",
  names: EN_NAMES,
  roleLabels: {
    fizz: "team lead",
    administrator: "administrator",
    analyst: "analyst",
    content_marketer: "content marketer",
  },
  aliases: {
    fizz: ["Fizz"],
    administrator: ["Administrator", "Admin"],
    analyst: ["Analyst"],
    content_marketer: ["Content Marketer", "Content"],
  },
  providerRequired:
    "Connect an AI provider in Settings first. Then the Airhop team can get started.",
  specialistUnavailable: (role) =>
    EN_NAMES[role] +
    " is unavailable right now. I kept the task; please try again shortly.",
  kickoffInstruction: (stage, ownerName) => kickoff("en", stage, ownerName),
};

const PT: WelcomeLocalePack = {
  language: "pt",
  names: PT_NAMES,
  roleLabels: {
    fizz: "lider da equipe",
    administrator: "administrador",
    analyst: "analista",
    content_marketer: "especialista de conteudo",
  },
  aliases: {
    fizz: ["Fizz"],
    administrator: ["Administrador", "Admin"],
    analyst: ["Analista"],
    content_marketer: ["Especialista de Conteudo", "Conteudo"],
  },
  providerRequired:
    "Conecte primeiro um provedor de IA nas Configuracoes. Depois, a equipe Airhop podera comecar.",
  specialistUnavailable: (role) =>
    PT_NAMES[role] +
    " nao esta disponivel agora. Guardei a tarefa; tente novamente em breve.",
  kickoffInstruction: (stage, ownerName) => kickoff("pt", stage, ownerName),
};

function kickoff(
  language: "ru" | "en" | "pt",
  stage: WelcomeKickoffStage,
  ownerName?: string,
): string {
  const owner = ownerName?.trim();
  const ru: Record<WelcomeKickoffStage, string> = {
    fizz_intro:
      "\u041a\u043e\u0440\u043e\u0442\u043a\u043e \u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u044c\u0441\u044f \u043a\u0430\u043a \u0424\u0438\u0437, \u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c \u043a\u043e\u043c\u0430\u043d\u0434\u044b Airhop. \u041d\u0435 \u0431\u043e\u043b\u0435\u0435 \u0442\u0440\u0451\u0445 \u043a\u043e\u0440\u043e\u0442\u043a\u0438\u0445 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439.",
    administrator_intro:
      "\u041f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u044c\u0441\u044f \u043a\u0430\u043a \u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440. \u041a\u043e\u0440\u043e\u0442\u043a\u043e \u0441\u043a\u0430\u0436\u0438 \u043f\u0440\u043e \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u044f, \u0434\u0435\u0442\u0435\u0439, \u0440\u043e\u0434\u0438\u0442\u0435\u043b\u0435\u0439 \u0438 \u043e\u043f\u043b\u0430\u0442\u044b.",
    analyst_intro:
      "\u041f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u044c\u0441\u044f \u043a\u0430\u043a \u0410\u043d\u0430\u043b\u0438\u0442\u0438\u043a. \u041a\u043e\u0440\u043e\u0442\u043a\u043e \u0441\u043a\u0430\u0436\u0438 \u043f\u0440\u043e \u0432\u043e\u043f\u0440\u043e\u0441\u044b \u043f\u043e \u0434\u0430\u043d\u043d\u044b\u043c \u0438 \u0442\u0435\u043a\u0441\u0442\u043e\u0432\u044b\u0435 \u043e\u0442\u0447\u0451\u0442\u044b.",
    content_marketer_intro:
      "\u041f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u044c\u0441\u044f \u043a\u0430\u043a \u041a\u043e\u043d\u0442\u0435\u043d\u0442-\u043c\u0430\u0440\u043a\u0435\u0442\u043e\u043b\u043e\u0433. \u041a\u043e\u0440\u043e\u0442\u043a\u043e \u0441\u043a\u0430\u0436\u0438, \u0447\u0442\u043e \u043f\u043e\u043c\u043e\u0433\u0430\u0435\u0448\u044c \u0441 \u043a\u043e\u043d\u0442\u0435\u043d\u0442\u043e\u043c, \u043d\u043e \u043f\u043e\u043a\u0430 \u043d\u0435 \u043f\u0443\u0431\u043b\u0438\u043a\u0443\u0435\u0448\u044c \u0435\u0433\u043e.",
    fizz_first_question:
      (owner || "\u0412\u043b\u0430\u0434\u0435\u043b\u0435\u0446") +
      ", \u0437\u0430\u0434\u0430\u0439 \u043e\u0434\u0438\u043d \u043a\u043e\u0440\u043e\u0442\u043a\u0438\u0439 \u043f\u0435\u0440\u0432\u044b\u0439 \u0432\u043e\u043f\u0440\u043e\u0441 \u0434\u043b\u044f \u0436\u0438\u0432\u043e\u0433\u043e \u0431\u0440\u0438\u0444\u0430. \u041d\u0435 \u043e\u0431\u044a\u044f\u0432\u043b\u044f\u0439 \u043e\u043d\u0431\u043e\u0440\u0434\u0438\u043d\u0433 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u044b\u043c.",
  };
  const en: Record<WelcomeKickoffStage, string> = {
    fizz_intro:
      "Briefly introduce yourself as Fizz, the Airhop team lead. Use at most three short messages.",
    administrator_intro:
      "Introduce yourself as the Administrator. Briefly mention schedules, children, parents, and payments.",
    analyst_intro:
      "Introduce yourself as the Analyst. Briefly mention data questions and concise text reports.",
    content_marketer_intro:
      "Introduce yourself as the Content Marketer. You help prepare content, but publishing is not available yet.",
    fizz_first_question:
      (owner || "Owner") +
      ", ask one short first question for the live brief. Do not announce completion.",
  };
  const pt: Record<WelcomeKickoffStage, string> = {
    fizz_intro:
      "Apresente-se brevemente como Fizz, lider da equipe Airhop. Use no maximo tres mensagens curtas.",
    administrator_intro:
      "Apresente-se como administrador. Mencione brevemente horarios, criancas, pais e pagamentos.",
    analyst_intro:
      "Apresente-se como analista. Mencione perguntas sobre dados e relatorios curtos em texto.",
    content_marketer_intro:
      "Apresente-se como especialista de conteudo. Ajude a preparar conteudo; a publicacao ainda nao esta disponivel.",
    fizz_first_question:
      (owner || "Proprietario") +
      ", faca uma primeira pergunta curta para o briefing vivo. Nao anuncie a conclusao.",
  };
  return language === "ru"
    ? ru[stage]
    : language === "pt"
      ? pt[stage]
      : en[stage];
}

export function resolveWelcomeLocale(
  organizationLocale: string | null | undefined,
): WelcomeLocalePack {
  const normalized = organizationLocale?.trim().toLowerCase() ?? "";
  if (normalized === "ru" || normalized.startsWith("ru-")) return RU;
  if (normalized === "pt" || normalized.startsWith("pt-")) return PT;
  return EN;
}

export function welcomeRoleDefinition(
  role: AirhopWelcomeRole,
  organizationLocale: string | null | undefined,
): WelcomeRoleDefinition {
  const locale = resolveWelcomeLocale(organizationLocale);
  return {
    role,
    personaId: PERSONA_IDS[role],
    name: locale.names[role],
    roleLabel: locale.roleLabels[role],
    aliases: locale.aliases[role],
  };
}
