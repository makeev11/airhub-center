import * as React from "react";
import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { KnowledgeService } from "../data/knowledgeService";
import type { KnowledgeArtifact } from "../model/knowledge";
import { KnowledgeMarkdown } from "./KnowledgeMarkdown";

export function KnowledgePreview({
  service,
  ru,
  onClose,
}: {
  service: KnowledgeService;
  ru: boolean;
  onClose: () => void;
}) {
  const t = (a: string, b: string) => (ru ? a : b);
  const workspace = useBookingWorkspace().workspace;
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState("organization");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [documents, setDocuments] = React.useState<KnowledgeArtifact[] | null>(
    null,
  );
  const generation = React.useRef(0);
  const inputId = React.useId();
  React.useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function search() {
    const turn = ++generation.current;
    setBusy(true);
    setError(null);
    setDocuments(null);
    const [kind, id] = scope.split(":");
    try {
      const result = await service.parentPreview(
        query,
        kind === "branch" ? id : undefined,
        kind === "group" ? id : undefined,
      );
      if (turn === generation.current) setDocuments(result.documents);
    } catch (e) {
      if (turn === generation.current) setError(String(e));
    } finally {
      if (turn === generation.current) setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto p-6">
        <DialogHeader>
          <DialogTitle>
            {t("Что увидит Гермес", "What Hermes can see")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Проверка опубликованных источников — не ответ модели и не сообщение родителю. Черновики и внутренние материалы здесь не показываются.",
              "This checks published sources, not a model-generated answer or a message to a parent. Drafts and internal materials are excluded.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <label htmlFor={inputId} className="block space-y-2 text-sm">
            {t("Тема или ключевые слова", "Topic or keywords")}
            <Input
              id={inputId}
              aria-label={t("Проверочный вопрос", "Test question")}
              value={query}
              maxLength={300}
              placeholder={t(
                "Например: сменная обувь",
                "For example: indoor shoes",
              )}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label={t("Контекст проверки", "Preview context")}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="organization">
              {t(
                "Новый родитель — без выбранной группы",
                "New parent — no selected group",
              )}
            </option>
            {workspace?.branches.map((b) => (
              <option key={b.id} value={`branch:${b.id}`}>
                {b.name}
              </option>
            ))}
            {workspace?.groups.map((g) => (
              <option key={g.id} value={`group:${g.id}`}>
                {g.name}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={busy || !query.trim()}>
            {busy
              ? t("Ищем…", "Searching…")
              : t("Проверить источники", "Check sources")}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {documents?.length === 0 && (
          <div className="rounded-xl bg-muted p-4 text-sm">
            {t(
              "Подходящего опубликованного ответа нет. Добавьте материал или уточните ключевые слова. Гермес не должен придумывать отсутствующие сведения.",
              "No matching published information. Add a material or refine the keywords. Hermes must not invent missing facts.",
            )}
          </div>
        )}
        {documents?.map((d) => (
          <article className="space-y-2 rounded-xl border p-4" key={d.id}>
            <h3 className="font-semibold">{d.title}</h3>
            <p className="text-xs text-muted-foreground">
              v{d.version} · {d.locale}
            </p>
            <KnowledgeMarkdown text={d.markdown} />
          </article>
        ))}
      </DialogContent>
    </Dialog>
  );
}
