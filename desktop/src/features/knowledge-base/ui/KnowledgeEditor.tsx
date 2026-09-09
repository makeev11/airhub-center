import * as React from "react";
import { ArrowDown, ArrowUp, FileDown, Plus, Trash2 } from "lucide-react";
import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { useBookingUnsavedChangesGuard } from "@/features/booking/ui/useBookingUnsavedChangesGuard";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  draftSchema,
  knowledgeMarkdown,
  type KnowledgeCommand,
  type KnowledgeDraft,
  type KnowledgeMaterial,
} from "../model/knowledge";
import { KnowledgeMarkdown } from "./KnowledgeMarkdown";
import { saveKnowledgeDocument } from "../data/saveKnowledgeDocument";

type Props = {
  material: KnowledgeMaterial;
  importWarning?: string | null;
  ru: boolean;
  onClose: () => void;
  onCommand: (command: KnowledgeCommand) => Promise<void>;
  onOriginal: (id: string) => Promise<void>;
};
export function KnowledgeEditor({
  material,
  importWarning,
  ru,
  onClose,
  onCommand,
  onOriginal,
}: Props) {
  const t = (a: string, b: string) => (ru ? a : b);
  const workspace = useBookingWorkspace().workspace;
  const [draft, setDraft] = React.useState(material.draft);
  const questionKeys = React.useRef(
    material.draft.questions.map(() => crypto.randomUUID()),
  );
  const formId = React.useId();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(material.draft) ||
    (material.version === 0 &&
      (draft.title.trim() !== "" || knowledgeMarkdown(draft) !== ""));
  const markdown = knowledgeMarkdown(draft);
  const discard = t(
    "Есть несохранённые изменения. Закрыть без сохранения?",
    "Discard your unsaved changes?",
  );
  useBookingUnsavedChangesGuard(dirty, discard);
  const patch = (value: Partial<KnowledgeDraft>) =>
    setDraft((d) => ({ ...d, ...value }));
  const close = () => {
    if (!busy && (!dirty || window.confirm(discard))) onClose();
  };
  async function run(command: KnowledgeCommand) {
    setBusy(true);
    setError(null);
    try {
      await onCommand(command);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const save = () => {
    const parsed = draftSchema.safeParse(draft);
    if (!parsed.success || markdown.length > 50000) {
      setError(
        t(
          "Проверьте название, вопросы и размер текста (до 50 000 знаков).",
          "Check the title, questions and text size (up to 50,000 characters).",
        ),
      );
      return;
    }
    void run({
      operation: "save",
      id: material.id,
      expectedVersion: material.version,
      draft: parsed.data,
    });
  };
  function move(index: number, delta: number) {
    const questions = [...draft.questions];
    [questions[index], questions[index + delta]] = [
      questions[index + delta],
      questions[index],
    ];
    [questionKeys.current[index], questionKeys.current[index + delta]] = [
      questionKeys.current[index + delta],
      questionKeys.current[index],
    ];
    patch({ questions });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto p-6">
        <DialogHeader>
          <DialogTitle>
            {material.version
              ? t("Материал центра", "Center material")
              : t("Новый материал", "New material")}
          </DialogTitle>
          <DialogDescription>
            {material.publishedVersion
              ? t(
                  `Агенты используют версию ${material.publishedVersion}. Изменения останутся черновиком до публикации.`,
                  `Agents use version ${material.publishedVersion}. Edits remain a draft until published.`,
                )
              : t(
                  "Сначала сохраните черновик, затем проверьте и опубликуйте. Пустые ответы можно пропустить.",
                  "Save a draft, then review and publish. Unanswered questions can be skipped.",
                )}
          </DialogDescription>
        </DialogHeader>
        {importWarning && (
          <p role="alert" className="rounded-lg bg-muted p-3 text-sm">
            {t(
              "Оригинал сохранён. Добавьте текст вручную: ",
              "Original saved. Add text manually: ",
            )}
            {importWarning}
          </p>
        )}
        <fieldset disabled={busy} className="space-y-5">
          <label
            htmlFor={`${formId}-title`}
            className="block space-y-2 text-sm font-medium"
          >
            {t("Название", "Title")}
            <Input
              id={`${formId}-title`}
              aria-label={t("Название материала", "Material title")}
              value={draft.title}
              maxLength={200}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          <div className="flex gap-2">
            <Button
              variant={!preview ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setPreview(false)}
            >
              {t("Редактировать", "Edit")}
            </Button>
            <Button
              variant={preview ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setPreview(true)}
            >
              {t("Проверить текст", "Review text")}
            </Button>
          </div>
          {preview ? (
            <div className="rounded-xl border p-5">
              <KnowledgeMarkdown
                text={
                  markdown ||
                  t(
                    "Пока нет заполненных ответов или текста.",
                    "No answers or text yet.",
                  )
                }
              />
            </div>
          ) : (
            <>
              {draft.questions.map((q, index) => (
                <div
                  key={questionKeys.current[index]}
                  className="space-y-2 rounded-xl border p-4"
                >
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={t(
                        `Вопрос ${index + 1}`,
                        `Question ${index + 1}`,
                      )}
                      value={q.question}
                      maxLength={300}
                      className="font-medium"
                      onChange={(e) =>
                        patch({
                          questions: draft.questions.map((v, i) =>
                            i === index
                              ? { ...v, question: e.target.value }
                              : v,
                          ),
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === 0}
                      aria-label={t("Выше", "Move up")}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === draft.questions.length - 1}
                      aria-label={t("Ниже", "Move down")}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("Убрать вопрос", "Remove question")}
                      onClick={() => {
                        questionKeys.current.splice(index, 1);
                        patch({
                          questions: draft.questions.filter(
                            (_, i) => i !== index,
                          ),
                        });
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Textarea
                    aria-label={t(`Ответ ${index + 1}`, `Answer ${index + 1}`)}
                    placeholder={t(
                      "Напишите своими словами. Можно оставить пустым.",
                      "Use your own words. You can leave this blank.",
                    )}
                    value={q.answer}
                    maxLength={10000}
                    onChange={(e) =>
                      patch({
                        questions: draft.questions.map((v, i) =>
                          i === index ? { ...v, answer: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                disabled={draft.questions.length >= 30}
                onClick={() => {
                  questionKeys.current.push(crypto.randomUUID());
                  patch({
                    questions: [
                      ...draft.questions,
                      {
                        question: t("Ваш вопрос", "Your question"),
                        answer: "",
                      },
                    ],
                  });
                }}
              >
                <Plus />
                {t("Добавить вопрос", "Add a question")}
              </Button>
              <label
                htmlFor={`${formId}-text`}
                className="block space-y-2 text-sm font-medium"
              >
                {t("Текст материала", "Material text")}
                <Textarea
                  id={`${formId}-text`}
                  aria-label={t("Текст материала", "Material text")}
                  rows={draft.markdown ? 10 : 4}
                  maxLength={50000}
                  value={draft.markdown}
                  placeholder={t(
                    "Дополнительные сведения или текст документа",
                    "Additional information or document text",
                  )}
                  onChange={(e) => patch({ markdown: e.target.value })}
                />
              </label>
            </>
          )}
          {draft.sourceId && (
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <p>
                {t(
                  "Оригинал сохранён приватно. После импорта проверьте порядок текста, списки и таблицы: форматирование может отличаться.",
                  "The original is stored privately. Check text order, lists and tables after import; formatting may differ.",
                )}
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (draft.sourceId)
                    void onOriginal(draft.sourceId).catch((e) =>
                      setError(String(e)),
                    );
                }}
              >
                <FileDown />
                {t("Скачать оригинал", "Download original")}
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={!markdown}
            onClick={() => {
              void saveKnowledgeDocument(
                `${draft.title || "knowledge"}.md`,
                new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
              ).catch((e) => setError(String(e)));
            }}
          >
            <FileDown />
            {t("Скачать текст .md", "Download text .md")}
          </Button>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium">
              {t("Кто может использовать", "Who may use this")}
              <select
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                aria-label={t("Доступ к материалу", "Material audience")}
                value={draft.audience}
                onChange={(e) =>
                  patch({
                    audience: e.target.value as "parent" | "staff",
                    websiteAllowed: false,
                  })
                }
              >
                <option value="parent">
                  {t("Для ответов родителям", "For parent replies")}
                </option>
                <option value="staff">
                  {t("Только для команды", "Team only")}
                </option>
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              {t("Где действует", "Applies to")}
              <select
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                aria-label={t("Область материала", "Material scope")}
                value={
                  draft.scopeType === "organization"
                    ? "organization"
                    : `${draft.scopeType}:${draft.scopeId}`
                }
                onChange={(e) => {
                  const [scope, id] = e.target.value.split(":");
                  patch({
                    scopeType: scope as KnowledgeDraft["scopeType"],
                    scopeId: id ?? null,
                  });
                }}
              >
                <option value="organization">
                  {t("Весь центр", "Entire center")}
                </option>
                {workspace?.branches.map((b) => (
                  <option key={b.id} value={`branch:${b.id}`}>
                    {b.name}
                  </option>
                ))}
                {workspace?.groups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {t("Группа: ", "Group: ")}
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              disabled={draft.audience === "staff"}
              checked={draft.websiteAllowed}
              onChange={(e) => patch({ websiteAllowed: e.target.checked })}
            />
            <span>
              {t(
                "Можно использовать для подготовки сайта",
                "May be used to prepare website content",
              )}
              <span className="mt-1 block text-xs text-muted-foreground">
                {t(
                  "Это не размещает документ на сайте. Публикация сайта — отдельный шаг.",
                  "This does not publish the document on the website. Website publishing is a separate step.",
                )}
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            {t(
              "Цены, расписание и свободные места берутся из Center. Здесь — объяснения и инструкции. Не добавляйте персональные данные семей в общие материалы.",
              "Prices, schedules and availability come from Center. Use this for explanations and instructions. Do not add families' personal data to shared materials.",
            )}
          </p>
        </fieldset>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button variant="ghost" disabled={busy} onClick={close}>
            {t("Закрыть", "Close")}
          </Button>
          <Button
            disabled={busy || (!dirty && material.version > 0)}
            onClick={save}
          >
            {busy
              ? t("Сохраняем…", "Saving…")
              : t("Сохранить черновик", "Save draft")}
          </Button>
          {material.version > 0 && !material.archived && (
            <Button
              variant="outline"
              disabled={busy || dirty || !markdown.trim()}
              onClick={() => setPreview(true)}
            >
              {t("К публикации", "Review publication")}
            </Button>
          )}
        </div>
        {preview &&
          material.version > 0 &&
          !dirty &&
          !material.archived &&
          markdown.trim() && (
            <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm">
                {draft.audience === "parent"
                  ? t(
                      "После публикации Гермес сможет использовать этот текст в ответах родителям. Проверьте точность и отсутствие служебных сведений.",
                      "After publishing, Hermes may use this text in parent replies. Check accuracy and remove internal information.",
                    )
                  : t(
                      "Этот текст будет доступен только внутренним помощникам. Гермес не получит его.",
                      "This text is for internal assistants only. Hermes will not receive it.",
                    )}
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  void run({
                    operation: "publish",
                    id: material.id,
                    expectedVersion: material.version,
                  })
                }
              >
                {t(
                  "Опубликовать проверенный материал",
                  "Publish reviewed material",
                )}
              </Button>
            </div>
          )}
        {material.version > 0 && (
          <details className="border-t pt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {t("История и архив", "History and archive")}
            </summary>
            <div className="mt-3 space-y-2">
              {material.history.map((h) => (
                <div
                  key={h.version}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 p-2"
                >
                  <span>
                    v{h.version} ·{" "}
                    {new Date(h.createdAt).toLocaleString(
                      ru ? "ru-RU" : "en-US",
                    )}{" "}
                    ·{" "}
                    {(
                      {
                        save: t("Черновик", "Draft"),
                        publish: t("Публикация", "Publication"),
                        archive: t("Архив", "Archive"),
                        restore: t("Восстановление", "Restore"),
                        migration: t("Перенесено", "Migrated"),
                      } as Record<string, string>
                    )[h.operation] ?? h.operation}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || dirty || h.version === material.version}
                    onClick={() =>
                      void run({
                        operation: "restore",
                        id: material.id,
                        expectedVersion: material.version,
                        revision: h.version,
                      })
                    }
                  >
                    {t("В новый черновик", "Restore as draft")}
                  </Button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                {t(
                  "Последние 50 изменений. Восстановление не публикует текст автоматически.",
                  "Latest 50 changes. Restoring never publishes automatically.",
                )}
              </p>
              {!material.archived && (
                <Button
                  variant="outline"
                  disabled={busy || dirty}
                  onClick={() => {
                    if (
                      window.confirm(
                        t(
                          "Убрать материал из ответов агентов? История сохранится.",
                          "Remove this material from agent replies? History will be preserved.",
                        ),
                      )
                    )
                      void run({
                        operation: "archive",
                        id: material.id,
                        expectedVersion: material.version,
                      });
                  }}
                >
                  {t("Убрать в архив", "Archive material")}
                </Button>
              )}
            </div>
          </details>
        )}
      </DialogContent>
    </Dialog>
  );
}
