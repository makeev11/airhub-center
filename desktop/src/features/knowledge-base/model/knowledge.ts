import { z } from "zod";

export const draftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  topic: z.string().regex(/^[a-z0-9_]{1,80}$/),
  locale: z.string().min(2).max(35),
  audience: z.enum(["parent", "staff"]),
  websiteAllowed: z.boolean(),
  scopeType: z.enum(["organization", "branch", "group"]),
  scopeId: z.uuid().nullable(),
  questions: z
    .array(
      z.object({
        question: z.string().min(1).max(300),
        answer: z.string().max(10000),
      }),
    )
    .max(30),
  markdown: z.string().max(50000),
  sourceId: z.uuid().nullable(),
});
export type KnowledgeDraft = z.infer<typeof draftSchema>;
export const summarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  topic: z.string(),
  audience: z.string(),
  locale: z.string(),
  version: z.number().int().positive(),
  publishedVersion: z.number().int().positive().nullable(),
  archived: z.boolean(),
  updatedAt: z.string(),
});
export type KnowledgeSummary = z.infer<typeof summarySchema>;
export const manifestSchema = z.object({
  communityId: z.uuid(),
  organizationId: z.uuid(),
  locale: z.string(),
  items: z.array(summarySchema),
  nextCursor: z.uuid().nullable(),
});
export const materialSchema = summarySchema
  .omit({ title: true, topic: true, audience: true, locale: true })
  .extend({
    draft: draftSchema,
    history: z.array(
      z.object({
        version: z.number(),
        operation: z.string(),
        actor: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  });
export type KnowledgeMaterial = z.infer<typeof materialSchema>;
export const artifactSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  markdown: z.string(),
  version: z.number(),
  locale: z.string(),
  scopeType: z.string(),
  scopeId: z.uuid().nullable(),
});
export type KnowledgeArtifact = z.infer<typeof artifactSchema>;
export type KnowledgeCommand =
  | {
      operation: "save";
      id: string;
      expectedVersion: number;
      draft: KnowledgeDraft;
    }
  | { operation: "publish" | "archive"; id: string; expectedVersion: number }
  | {
      operation: "restore";
      id: string;
      expectedVersion: number;
      revision: number;
    };

export function knowledgeMarkdown(draft: KnowledgeDraft): string {
  return [
    ...draft.questions
      .filter((q) => q.answer.trim())
      .map(
        (q) =>
          `## ${q.question.trim().replace(/[\r\n]/g, " ")}\n\n${q.answer.trim()}`,
      ),
    draft.markdown.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function newKnowledgeDraft(locale: string): KnowledgeDraft {
  return {
    title: "",
    topic: "custom",
    locale,
    audience: "parent",
    websiteAllowed: false,
    scopeType: "organization",
    scopeId: null,
    questions: [],
    markdown: "",
    sourceId: null,
  };
}

export function knowledgeTopics(locale: boolean | string) {
  const language =
    typeof locale === "boolean"
      ? locale
        ? "ru"
        : "en"
      : locale.toLowerCase().startsWith("pt")
        ? "pt"
        : locale.toLowerCase().startsWith("ru")
          ? "ru"
          : "en";
  const text = (ru: string, en: string, pt: string) =>
    language === "ru" ? ru : language === "pt" ? pt : en;
  const list = (ru: string[], en: string[], pt: string[]) =>
    language === "ru" ? ru : language === "pt" ? pt : en;
  return [
    {
      key: "about",
      title: text(
        "О центре и занятиях",
        "About the center",
        "Sobre o centro e as aulas",
      ),
      questions: list(
        ["Что особенного в ваших занятиях?", "Как проходит обычное занятие?"],
        [
          "What makes your classes special?",
          "What happens during a typical class?",
        ],
        ["O que torna suas aulas especiais?", "Como é uma aula típica?"],
      ),
    },
    {
      key: "preparation_and_arrival",
      title: text("Первое посещение", "First visit", "Primeira visita"),
      questions: list(
        [
          "Что взять с собой?",
          "Какую одежду и обувь выбрать?",
          "Как найти вход и где оставить коляску или машину?",
        ],
        [
          "What should families bring?",
          "What clothing and shoes are suitable?",
          "How do families find the entrance and parking?",
        ],
        [
          "O que as famílias devem levar?",
          "Quais roupas e calçados são adequados?",
          "Como encontrar a entrada e o estacionamento?",
        ],
      ),
    },
    {
      key: "trial",
      title: text("Пробное занятие", "Trial class", "Aula experimental"),
      questions: list(
        [
          "Как проходит знакомство с преподавателем?",
          "Может ли родитель присутствовать?",
        ],
        ["How do children meet the teacher?", "Can a parent stay?"],
        [
          "Como a criança conhece o professor?",
          "O responsável pode acompanhar?",
        ],
      ),
    },
    {
      key: "attendance",
      title: text(
        "Посещение и отмена",
        "Attendance and cancellations",
        "Presença e cancelamentos",
      ),
      questions: list(
        [
          "К кому обратиться, если не получается прийти?",
          "Как сообщить об опоздании?",
        ],
        [
          "Who should families contact to cancel?",
          "How should families report a late arrival?",
        ],
        [
          "Com quem a família deve falar para cancelar?",
          "Como avisar sobre um atraso?",
        ],
      ),
    },
    {
      key: "payment",
      title: text(
        "Вопросы об оплате",
        "Payment questions",
        "Dúvidas sobre pagamentos",
      ),
      questions: list(
        [
          "Какие способы оплаты доступны?",
          "К кому обратиться с вопросом об оплате?",
        ],
        [
          "Which payment methods are available?",
          "Who can help with a payment question?",
        ],
        [
          "Quais formas de pagamento estão disponíveis?",
          "Quem pode ajudar com uma dúvida sobre pagamento?",
        ],
      ),
    },
    {
      key: "safety",
      title: text(
        "Безопасность и родители",
        "Safety and parents",
        "Segurança e responsáveis",
      ),
      questions: list(
        [
          "Кто может забрать ребёнка?",
          "Как сообщить об особенностях ребёнка?",
          "Какие правила фото и видеосъёмки?",
        ],
        [
          "Who may collect a child?",
          "How can families share a child's needs?",
          "What are the photo and video rules?",
        ],
        [
          "Quem pode buscar a criança?",
          "Como a família pode informar as necessidades da criança?",
          "Quais são as regras para fotos e vídeos?",
        ],
      ),
    },
    {
      key: "faq",
      title: text("Другие вопросы", "Other questions", "Outras perguntas"),
      questions: list(
        ["О чём ещё часто спрашивают родители?"],
        ["What else do parents often ask?"],
        ["O que mais os responsáveis costumam perguntar?"],
      ),
    },
  ];
}
