export type AirhopWelcomeRole =
  | "fizz"
  | "administrator"
  | "analyst"
  | "content_marketer";

export type WelcomeKickoffStage =
  | "fizz_intro"
  | "fizz_invite_administrator"
  | "administrator_intro"
  | "fizz_invite_analyst"
  | "analyst_intro"
  | "fizz_invite_content_marketer"
  | "content_marketer_intro"
  | "fizz_explain_team"
  | "fizz_first_question";

export type WelcomeRoleDefinition = Readonly<{
  role: AirhopWelcomeRole;
  personaId: string;
  name: string;
  roleLabel: string;
  aliases: readonly string[];
}>;

type WelcomeLanguage = "ru" | "en" | "tr" | "pt";

export type WelcomeLocalePack = Readonly<{
  language: WelcomeLanguage;
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

const NAMES: Record<WelcomeLanguage, Record<AirhopWelcomeRole, string>> = {
  ru: {
    fizz: "Физ",
    administrator: "Администратор",
    analyst: "Аналитик",
    content_marketer: "Контент-маркетолог",
  },
  en: {
    fizz: "Fizz",
    administrator: "Administrator",
    analyst: "Analyst",
    content_marketer: "Content Marketer",
  },
  tr: {
    fizz: "Fizz",
    administrator: "Yönetici",
    analyst: "Analist",
    content_marketer: "İçerik Pazarlamacısı",
  },
  pt: {
    fizz: "Fizz",
    administrator: "Administrador",
    analyst: "Analista",
    content_marketer: "Especialista de Conteúdo",
  },
};

const INSTRUCTIONS: Record<
  WelcomeLanguage,
  Record<WelcomeKickoffStage, (ownerName?: string) => string>
> = {
  ru: {
    fizz_intro: () =>
      "Поздоровайся и коротко представься как Физ, руководитель команды Airhop. Скажи, что сейчас познакомишь владельца с командой и вместе начнёте настройку.",
    fizz_invite_administrator: () =>
      "Одним коротким сообщением пригласи Администратора представиться. Обратись к нему по имени.",
    administrator_intro: () =>
      "Коротко представься как Администратор. Скажи, что помогаешь с расписанием, детьми, родителями и оплатами, и приведи один пример запроса.",
    fizz_invite_analyst: () =>
      "Одним коротким сообщением пригласи Аналитика представиться. Обратись к нему по имени.",
    analyst_intro: () =>
      "Коротко представься как Аналитик. Скажи про данные, показатели и текстовые отчёты и приведи один пример запроса.",
    fizz_invite_content_marketer: () =>
      "Одним коротким сообщением пригласи Контент-маркетолога представиться. Обратись к нему по имени.",
    content_marketer_intro: () =>
      "Коротко представься как Контент-маркетолог. Скажи, что помогаешь готовить контент, но пока не публикуешь его, и приведи один пример запроса.",
    fizz_explain_team: () =>
      "Коротко объясни: владелец может обращаться к Физу, а может напрямую к любому специалисту; доступ сотрудникам можно настроить отдельно.",
    fizz_first_question: (ownerName) =>
      `${ownerName?.trim() || "Владелец"}, задай один короткий первый вопрос живого организационного брифа. Не объявляй онбординг завершённым.`,
  },
  en: {
    fizz_intro: () =>
      "Greet the owner and briefly introduce yourself as Fizz, the Airhop team lead. Say you will introduce the team and start setting things up together.",
    fizz_invite_administrator: () =>
      "In one short message, invite the Administrator to introduce themselves. Address them by name.",
    administrator_intro: () =>
      "Briefly introduce yourself as the Administrator. Mention schedules, children, parents, and payments, with one example request.",
    fizz_invite_analyst: () =>
      "In one short message, invite the Analyst to introduce themselves. Address them by name.",
    analyst_intro: () =>
      "Briefly introduce yourself as the Analyst. Mention data, metrics, and concise reports, with one example request.",
    fizz_invite_content_marketer: () =>
      "In one short message, invite the Content Marketer to introduce themselves. Address them by name.",
    content_marketer_intro: () =>
      "Briefly introduce yourself as the Content Marketer. You prepare content but do not publish it yet. Include one example request.",
    fizz_explain_team: () =>
      "Briefly explain that the owner can ask Fizz or address any specialist directly, and can configure employee access separately.",
    fizz_first_question: (ownerName) =>
      `${ownerName?.trim() || "Owner"}, ask one short first question for the live organizational brief. Do not announce completion.`,
  },
  tr: {
    fizz_intro: () =>
      "İşletme sahibini selamla ve Airhop ekip lideri Fizz olarak kısaca kendini tanıt. Ekibi tanıtacağını ve kuruluma birlikte başlayacağınızı söyle.",
    fizz_invite_administrator: () =>
      "Tek kısa mesajla Yönetici'yi kendini tanıtmaya davet et. Ona adıyla hitap et.",
    administrator_intro: () =>
      "Yönetici olarak kısaca kendini tanıt. Programlar, çocuklar, veliler ve ödemelerden söz et ve bir örnek istek ver.",
    fizz_invite_analyst: () =>
      "Tek kısa mesajla Analist'i kendini tanıtmaya davet et. Ona adıyla hitap et.",
    analyst_intro: () =>
      "Analist olarak kısaca kendini tanıt. Veriler, metrikler ve kısa raporlardan söz et ve bir örnek istek ver.",
    fizz_invite_content_marketer: () =>
      "Tek kısa mesajla İçerik Pazarlamacısı'nı kendini tanıtmaya davet et. Ona adıyla hitap et.",
    content_marketer_intro: () =>
      "İçerik Pazarlamacısı olarak kısaca kendini tanıt. İçerik hazırladığını ancak henüz yayınlamadığını söyle ve bir örnek istek ver.",
    fizz_explain_team: () =>
      "İşletme sahibinin Fizz'e veya doğrudan bir uzmana yazabileceğini ve çalışan erişimini ayrıca ayarlayabileceğini kısaca açıkla.",
    fizz_first_question: (ownerName) =>
      `${ownerName?.trim() || "İşletme sahibi"}, canlı organizasyon özeti için ilk kısa soruyu sor. Kurulumun tamamlandığını söyleme.`,
  },
  pt: {
    fizz_intro: () =>
      "Cumprimente o proprietário e apresente-se brevemente como Fizz, líder da equipe Airhop. Diga que apresentará a equipe e que começarão a configuração juntos.",
    fizz_invite_administrator: () =>
      "Em uma mensagem curta, convide o Administrador a se apresentar. Chame-o pelo nome.",
    administrator_intro: () =>
      "Apresente-se brevemente como Administrador. Mencione horários, crianças, responsáveis e pagamentos, com um exemplo de pedido.",
    fizz_invite_analyst: () =>
      "Em uma mensagem curta, convide o Analista a se apresentar. Chame-o pelo nome.",
    analyst_intro: () =>
      "Apresente-se brevemente como Analista. Mencione dados, métricas e relatórios objetivos, com um exemplo de pedido.",
    fizz_invite_content_marketer: () =>
      "Em uma mensagem curta, convide o Especialista de Conteúdo a se apresentar. Chame-o pelo nome.",
    content_marketer_intro: () =>
      "Apresente-se brevemente como Especialista de Conteúdo. Você prepara conteúdo, mas ainda não publica. Inclua um exemplo de pedido.",
    fizz_explain_team: () =>
      "Explique brevemente que o proprietário pode falar com Fizz ou diretamente com qualquer especialista e configurar o acesso da equipe separadamente.",
    fizz_first_question: (ownerName) =>
      `${ownerName?.trim() || "Proprietário"}, faça uma primeira pergunta curta para o briefing organizacional vivo. Não anuncie a conclusão.`,
  },
};

function kickoffInstruction(
  language: WelcomeLanguage,
  stage: WelcomeKickoffStage,
  ownerName?: string,
): string {
  return INSTRUCTIONS[language][stage](ownerName);
}

const PACKS: Record<WelcomeLanguage, WelcomeLocalePack> = {
  ru: {
    language: "ru",
    names: NAMES.ru,
    roleLabels: {
      fizz: "руководитель команды",
      administrator: "администратор",
      analyst: "аналитик",
      content_marketer: "контент-маркетолог",
    },
    aliases: {
      fizz: ["Физ", "Fizz"],
      administrator: ["Администратор", "Админ"],
      analyst: ["Аналитик"],
      content_marketer: ["Контент-маркетолог", "Контент"],
    },
    providerRequired:
      "Сначала подключите AI-провайдера в настройках. После этого команда Airhop сможет начать.",
    specialistUnavailable: (role) =>
      `${NAMES.ru[role]} сейчас недоступен. Я сохранил задачу — попробуйте чуть позже.`,
    kickoffInstruction: (stage, ownerName) =>
      kickoffInstruction("ru", stage, ownerName),
  },
  en: {
    language: "en",
    names: NAMES.en,
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
      `${NAMES.en[role]} is unavailable right now. I kept the task; please try again shortly.`,
    kickoffInstruction: (stage, ownerName) =>
      kickoffInstruction("en", stage, ownerName),
  },
  tr: {
    language: "tr",
    names: NAMES.tr,
    roleLabels: {
      fizz: "ekip lideri",
      administrator: "yönetici",
      analyst: "analist",
      content_marketer: "içerik pazarlamacısı",
    },
    aliases: {
      fizz: ["Fizz"],
      administrator: ["Yönetici", "Admin"],
      analyst: ["Analist"],
      content_marketer: ["İçerik Pazarlamacısı", "İçerik"],
    },
    providerRequired:
      "Önce Ayarlar'dan bir AI sağlayıcısı bağlayın. Ardından Airhop ekibi başlayabilir.",
    specialistUnavailable: (role) =>
      `${NAMES.tr[role]} şu anda kullanılamıyor. Görevi sakladım; lütfen biraz sonra tekrar deneyin.`,
    kickoffInstruction: (stage, ownerName) =>
      kickoffInstruction("tr", stage, ownerName),
  },
  pt: {
    language: "pt",
    names: NAMES.pt,
    roleLabels: {
      fizz: "líder da equipe",
      administrator: "administrador",
      analyst: "analista",
      content_marketer: "especialista de conteúdo",
    },
    aliases: {
      fizz: ["Fizz"],
      administrator: ["Administrador", "Admin"],
      analyst: ["Analista"],
      content_marketer: ["Especialista de Conteúdo", "Conteúdo"],
    },
    providerRequired:
      "Conecte primeiro um provedor de IA nas Configurações. Depois, a equipe Airhop poderá começar.",
    specialistUnavailable: (role) =>
      `${NAMES.pt[role]} não está disponível agora. Guardei a tarefa; tente novamente em breve.`,
    kickoffInstruction: (stage, ownerName) =>
      kickoffInstruction("pt", stage, ownerName),
  },
};

export function resolveWelcomeLocale(
  organizationLocale: string | null | undefined,
): WelcomeLocalePack {
  const normalized = organizationLocale?.trim().toLowerCase() ?? "";
  if (normalized === "ru" || normalized.startsWith("ru-")) return PACKS.ru;
  if (normalized === "tr" || normalized.startsWith("tr-")) return PACKS.tr;
  if (normalized === "pt" || normalized.startsWith("pt-")) return PACKS.pt;
  return PACKS.en;
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
