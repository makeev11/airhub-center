import * as React from "react";
import {
  BookOpen,
  CircleHelp,
  FilePlus2,
  LoaderCircle,
  MessageCircleQuestion,
  Plus,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useAirHopLocale } from "@/features/activation/useAirHopLocale";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { SkeletonReveal } from "@/shared/ui/skeleton";
import { KnowledgeBaseSkeleton } from "./KnowledgeBaseSkeleton";
import { PageHeader } from "@/shared/ui/PageHeader";
import { KnowledgeService } from "../data/knowledgeService";
import { importKnowledge } from "../data/importKnowledge";
import { validateKnowledgeFile } from "../data/importSafety";
import { saveKnowledgeDocument } from "../data/saveKnowledgeDocument";
import {
  knowledgeTopics,
  newKnowledgeDraft,
  type KnowledgeCommand,
  type KnowledgeDraft,
  type KnowledgeMaterial,
  type KnowledgeSummary,
} from "../model/knowledge";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { KnowledgeIntro } from "./KnowledgeIntro";
import { KnowledgePreview } from "./KnowledgePreview";

export function KnowledgeBaseScreen() {
  const ru = useAirHopLocale().startsWith("ru");
  const t = (a: string, b: string) => (ru ? a : b);
  const [service] = React.useState(() => new KnowledgeService());
  const [items, setItems] = React.useState<KnowledgeSummary[]>([]);
  const [community, setCommunity] = React.useState<string | null>(null);
  const [locale, setLocale] = React.useState("ru-RU");
  const [after, setAfter] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<KnowledgeMaterial | null>(null);
  const [importWarning, setImportWarning] = React.useState<string | null>(null);
  const [intro, setIntro] = React.useState<number | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [topics, setTopics] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [archives, setArchives] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const importAbort = React.useRef<AbortController | null>(null);
  const mounted = React.useRef(false);
  const request = React.useRef(0);
  const load = React.useCallback(
    async (cursor?: string) => {
      const generation = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const manifest = await service.manifest(cursor);
        if (!mounted.current || generation !== request.current) return;
        setItems((old) =>
          cursor
            ? [
                ...old,
                ...manifest.items.filter(
                  (item) => !old.some((v) => v.id === item.id),
                ),
              ]
            : manifest.items,
        );
        setCommunity(manifest.communityId);
        setLocale(manifest.locale);
        setAfter(manifest.nextCursor);
        if (!cursor && manifest.items.length === 0) {
          try {
            if (
              localStorage.getItem(
                `airhop.knowledge.intro.v1:${manifest.communityId}`,
              ) !== "done"
            )
              setIntro(1);
          } catch {
            setIntro(1);
          }
        }
      } catch (e) {
        if (mounted.current && generation === request.current)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted.current && generation === request.current)
          setLoading(false);
      }
    },
    [service],
  );
  React.useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      request.current++;
      importAbort.current?.abort();
    };
  }, [load]);
  const closeIntro = () => {
    setIntro(null);
    if (community)
      try {
        localStorage.setItem(`airhop.knowledge.intro.v1:${community}`, "done");
      } catch {
        /* Preference only; server data is unaffected. */
      }
  };
  function create(draft: KnowledgeDraft) {
    setImportWarning(null);
    setEditor({
      id: crypto.randomUUID(),
      version: 0,
      publishedVersion: null,
      archived: false,
      updatedAt: new Date().toISOString(),
      draft,
      history: [],
    });
    setTopics(false);
  }
  async function open(id: string) {
    setImportWarning(null);
    setError(null);
    try {
      const m = await service.material(id);
      if (mounted.current) setEditor(m);
    } catch (e) {
      if (mounted.current) setError(String(e));
    }
  }
  async function command(input: KnowledgeCommand) {
    if (!community) throw new Error("Knowledge workspace is not connected");
    await service.command(community, input);
    setImportWarning(null);
    const material = await service.material(input.id);
    if (!mounted.current) return;
    setEditor(material);
    setNotice(
      input.operation === "publish"
        ? t(
            "Опубликовано. Агенты смогут использовать новую версию при следующем обращении к базе.",
            "Published. Agents can retrieve the new version on their next knowledge request.",
          )
        : input.operation === "archive"
          ? t(
              "Материал убран из ответов. История сохранена.",
              "Material withdrawn from replies. History is preserved.",
            )
          : t(
              "Черновик сохранён. Опубликованный текст не изменился.",
              "Draft saved. The published text has not changed.",
            ),
    );
    await load();
  }
  async function importFile(file: File) {
    if (!community) return;
    try {
      validateKnowledgeFile(file.name, file.size);
    } catch (e) {
      setError(String(e));
      return;
    }
    const controller = new AbortController();
    importAbort.current = controller;
    setImporting(true);
    setError(null);
    setNotice(null);
    let importError: string | null = null;
    try {
      // First preserve the original privately, including when extraction fails.
      const source = await service.upload(file);
      const id = crypto.randomUUID();
      const draft = {
        ...newKnowledgeDraft(locale),
        title: file.name.replace(/\.[^.]+$/, "").slice(0, 200) || file.name,
        topic: "imported",
        sourceId: source.id,
      };
      // Persist a draft reference before conversion so cancellation, navigation,
      // or a parser failure cannot hide the original from the material list.
      await service.command(community, {
        operation: "save",
        id,
        expectedVersion: 0,
        draft,
      });
      controller.signal.throwIfAborted();
      let warning: string | null = null;
      try {
        const markdown = await importKnowledge(file, controller.signal);
        await service.command(community, {
          operation: "save",
          id,
          expectedVersion: 1,
          draft: { ...draft, markdown },
        });
      } catch (e) {
        if (controller.signal.aborted) throw e;
        warning = e instanceof Error ? e.message : String(e);
      }
      if (!mounted.current) return;
      const material = await service.material(id);
      if (!mounted.current) return;
      setImportWarning(warning);
      setEditor(material);
      if (warning)
        setNotice(
          `${t("Оригинал сохранён. Добавьте текст вручную: ", "Original saved. Add text manually: ")}${warning}`,
        );
    } catch (e) {
      if (!controller.signal.aborted) importError = String(e);
    } finally {
      if (mounted.current) {
        setImporting(false);
        await load();
        if (mounted.current && importError) setError(importError);
      }
      importAbort.current = null;
    }
  }
  async function downloadOriginal(id: string) {
    const { name, blob } = await service.original(id);
    await saveKnowledgeDocument(name, blob);
  }
  const visible = items.filter(
    (i) =>
      i.archived === archives &&
      i.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  const published = items.filter(
    (i) => i.publishedVersion !== null && !i.archived,
  ).length;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background"
      data-testid="knowledge-base-screen"
    >
      <div className="mx-auto w-full max-w-5xl space-y-6 px-5 py-6 lg:px-8">
        <PageHeader
          title={t("База знаний", "Knowledge base")}
          description={t(
            "То, что вашим помощникам важно знать о центре.",
            "What your assistants need to know about your center.",
          )}
          action={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Как это работает", "How it works")}
              onClick={() => setIntro(1)}
            >
              <CircleHelp />
            </Button>
          }
        />
        {error && (
          <Card role="alert" className="space-y-3 border-destructive/30 p-4">
            <p className="text-sm text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground">
              {t(
                "Не удалось получить актуальные данные. Мы не подставляем демонстрационные материалы.",
                "Current data could not be loaded. No demo content is substituted.",
              )}
            </p>
            <Button variant="outline" onClick={() => void load()}>
              {t("Повторить", "Retry")}
            </Button>
          </Card>
        )}
        {notice && (
          <div
            role="status"
            className="flex items-start justify-between gap-3 rounded-xl bg-primary/5 p-4 text-sm"
          >
            <span>{notice}</span>
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              {t("Понятно", "Got it")}
            </Button>
          </div>
        )}
        <SkeletonReveal
          loading={loading && !community}
          skeleton={<KnowledgeBaseSkeleton />}
          contentClassName="space-y-6"
          data-testid="knowledge-base-content"
          aria-busy={loading}
        >
          {community && (
            <>
              <Card className="space-y-5 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary/10 p-3 text-primary">
                    <BookOpen />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">
                      {items.length
                        ? t(
                            "Знания, на которые можно опереться",
                            "Knowledge your team can rely on",
                          )
                        : t(
                            "Начните с того, что уже знаете",
                            "Start with what you already know",
                          )}
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                      {t(
                        "Расскажите, как проходит первое занятие, что взять с собой и какие у вас правила. Можно ответить на готовые вопросы или добавить документ.",
                        "Explain the first visit, what to bring and your guidelines. Answer suggested questions or add an existing document.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={importing}
                    onClick={() => setTopics((v) => !v)}
                  >
                    <MessageCircleQuestion />
                    {t("Ответить на вопросы", "Answer questions")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={importing}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload />
                    {importing
                      ? t("Читаем документ…", "Reading document…")
                      : t("Добавить документ", "Add a document")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={importing}
                    onClick={() => create(newKnowledgeDraft(locale))}
                  >
                    <Plus />
                    {t("Написать свой текст", "Write your own text")}
                  </Button>
                  {importing && (
                    <Button
                      variant="ghost"
                      onClick={() => importAbort.current?.abort()}
                    >
                      {t("Отменить", "Cancel")}
                    </Button>
                  )}
                </div>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  aria-label={t(
                    "Документ для базы знаний",
                    "Knowledge document",
                  )}
                  ref={fileRef}
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void importFile(file);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    "PDF, DOCX, TXT, Markdown · до 10 МБ · без автоматической публикации",
                    "PDF, DOCX, TXT, Markdown · up to 10 MB · never auto-published",
                  )}
                </p>
              </Card>
              {topics && (
                <section className="space-y-3">
                  <h2 className="text-base font-semibold">
                    {t(
                      "Выберите тему. Заполнять всё не обязательно.",
                      "Choose a topic. You don't have to answer everything.",
                    )}
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {knowledgeTopics(ru).map((topic) => (
                      <button
                        key={topic.key}
                        type="button"
                        className="space-y-2 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                          create({
                            ...newKnowledgeDraft(locale),
                            title: topic.title,
                            topic: topic.key,
                            questions: topic.questions.map((question) => ({
                              question,
                              answer: "",
                            })),
                          })
                        }
                      >
                        <span className="block text-sm font-semibold">
                          {topic.title}
                        </span>
                        <span className="block text-xs leading-relaxed text-muted-foreground">
                          {topic.questions[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="size-4 text-primary" />
                  <span>
                    {published
                      ? t(
                          `Опубликовано на этой странице: ${published}`,
                          `${published} published materials on this page`,
                        )
                      : t(
                          "Агенты пока не получили опубликованные материалы",
                          "No published materials on this page",
                        )}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreview(true)}
                >
                  <Search />
                  {t("Что увидит Гермес", "What Hermes can see")}
                </Button>
              </div>
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">
                    {t("Материалы центра", "Center materials")}
                  </h2>
                  <div className="flex items-center gap-3">
                    <Input
                      className="max-w-56"
                      aria-label={t("Поиск материалов", "Find materials")}
                      placeholder={t("Найти материал", "Find a material")}
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                    <label className="flex items-center gap-2 whitespace-nowrap text-sm">
                      <input
                        type="checkbox"
                        checked={archives}
                        onChange={(e) => setArchives(e.target.checked)}
                      />
                      {t("Архив", "Archive")}
                    </label>
                  </div>
                </div>
                {visible.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {visible.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className="space-y-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => void open(item.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold">
                            {item.title}
                          </h3>
                          <FilePlus2 className="size-4 shrink-0 text-muted-foreground" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            variant={
                              item.publishedVersion ? "default" : "secondary"
                            }
                          >
                            {item.archived
                              ? t("В архиве", "Archived")
                              : item.publishedVersion
                                ? t("Опубликовано", "Published")
                                : t("Черновик", "Draft")}
                          </Badge>
                          {item.publishedVersion &&
                            item.publishedVersion !== item.version && (
                              <Badge variant="outline">
                                {t("Есть изменения", "Has draft changes")}
                              </Badge>
                            )}
                          <span className="text-xs text-muted-foreground">
                            {item.audience === "staff"
                              ? t("Для команды", "Team only")
                              : t("Для родителей", "For parents")}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed p-8 text-center">
                    <BookOpen className="mx-auto mb-3 size-7 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {filter
                        ? t("Ничего не найдено", "No matches")
                        : archives
                          ? t("Архив пуст", "Archive is empty")
                          : t(
                              "Первый материал можно добавить за пару минут",
                              "Your first material can take just a few minutes",
                            )}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t(
                        "Начните с вопроса «Что взять с собой?». Остальное можно дополнить позже.",
                        "Start with “What should families bring?” You can add more later.",
                      )}
                    </p>
                  </div>
                )}
                {after && (
                  <Button
                    variant="outline"
                    disabled={loading}
                    onClick={() => void load(after)}
                  >
                    {loading && (
                      <LoaderCircle className="size-4 animate-spin" />
                    )}
                    {t("Загрузить ещё", "Load more")}
                  </Button>
                )}
              </section>
            </>
          )}
        </SkeletonReveal>
        {loading && (
          <span className="sr-only" role="status">
            {t("Загружаем материалы…", "Loading materials…")}
          </span>
        )}
      </div>
      <KnowledgeIntro
        step={intro}
        ru={ru}
        onStep={setIntro}
        onClose={closeIntro}
      />
      {editor && (
        <KnowledgeEditor
          key={`${editor.id}:${editor.version}`}
          material={editor}
          importWarning={importWarning}
          ru={ru}
          onClose={() => setEditor(null)}
          onCommand={command}
          onOriginal={downloadOriginal}
        />
      )}
      {preview && (
        <KnowledgePreview
          service={service}
          ru={ru}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}
