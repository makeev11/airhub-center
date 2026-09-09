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

export function knowledgeTopics(ru: boolean) {
  return [
    {
      key: "about",
      title: ru ? "О центре и занятиях" : "About the center",
      questions: ru
        ? ["Что особенного в ваших занятиях?", "Как проходит обычное занятие?"]
        : [
            "What makes your classes special?",
            "What happens during a typical class?",
          ],
    },
    {
      key: "preparation_and_arrival",
      title: ru ? "Первое посещение" : "First visit",
      questions: ru
        ? [
            "Что взять с собой?",
            "Какую одежду и обувь выбрать?",
            "Как найти вход и где оставить коляску или машину?",
          ]
        : [
            "What should families bring?",
            "What clothing and shoes are suitable?",
            "How do families find the entrance and parking?",
          ],
    },
    {
      key: "trial",
      title: ru ? "Пробное занятие" : "Trial class",
      questions: ru
        ? [
            "Как проходит знакомство с преподавателем?",
            "Может ли родитель присутствовать?",
          ]
        : ["How do children meet the teacher?", "Can a parent stay?"],
    },
    {
      key: "attendance",
      title: ru ? "Посещение и отмена" : "Attendance and cancellations",
      questions: ru
        ? [
            "К кому обратиться, если не получается прийти?",
            "Как сообщить об опоздании?",
          ]
        : [
            "Who should families contact to cancel?",
            "How should families report a late arrival?",
          ],
    },
    {
      key: "payment",
      title: ru ? "Вопросы об оплате" : "Payment questions",
      questions: ru
        ? [
            "Какие способы оплаты доступны?",
            "К кому обратиться с вопросом об оплате?",
          ]
        : [
            "Which payment methods are available?",
            "Who can help with a payment question?",
          ],
    },
    {
      key: "safety",
      title: ru ? "Безопасность и родители" : "Safety and parents",
      questions: ru
        ? [
            "Кто может забрать ребёнка?",
            "Как сообщить об особенностях ребёнка?",
            "Какие правила фото и видеосъёмки?",
          ]
        : [
            "Who may collect a child?",
            "How can families share a child's needs?",
            "What are the photo and video rules?",
          ],
    },
    {
      key: "faq",
      title: ru ? "Другие вопросы" : "Other questions",
      questions: ru
        ? ["О чём ещё часто спрашивают родители?"]
        : ["What else do parents often ask?"],
    },
  ];
}
