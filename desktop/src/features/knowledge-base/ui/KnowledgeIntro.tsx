import { BookOpen, ShieldCheck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function KnowledgeIntro({
  step,
  ru,
  onStep,
  onClose,
}: {
  step: number | null;
  ru: boolean;
  onStep: (step: number) => void;
  onClose: () => void;
}) {
  const t = (a: string, b: string) => (ru ? a : b);
  return (
    <Dialog
      open={step !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg p-7">
        <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {step === 1 ? <BookOpen /> : <ShieldCheck />}
        </div>
        <DialogHeader>
          <p className="text-xs text-muted-foreground">{step} / 2</p>
          <DialogTitle className="text-xl">
            {step === 1
              ? t(
                  "Расскажите агентам о вашем центре",
                  "Tell your agents about your center",
                )
              : t(
                  "Вы решаете, что знают агенты",
                  "You control what agents know",
                )}
          </DialogTitle>
          <DialogDescription className="pt-2 text-base leading-relaxed">
            {step === 1
              ? t(
                  "Добавьте правила и полезные материалы. Гермес сможет отвечать родителям по вашим инструкциям, а другие помощники — использовать их в работе центра.",
                  "Add your guidelines and useful materials. Hermes can answer parents using your instructions, and other assistants can use them in their work.",
                )
              : t(
                  "Ответьте на несколько вопросов или добавьте документы. Проверьте результат и опубликуйте. До этого материалы остаются черновиками и не используются в ответах.",
                  "Answer a few questions or add documents. Review the result and publish it. Until then, drafts are not used in answers.",
                )}
          </DialogDescription>
        </DialogHeader>
        <div className="my-3 rounded-xl bg-muted/60 p-4 text-sm leading-relaxed">
          {step === 1 ? (
            <>
              <p className="text-muted-foreground">
                {t(
                  "Родитель: «Что взять на первое занятие?»",
                  "Parent: “What should we bring to our first class?”",
                )}
              </p>
              <p className="mt-2">
                {t(
                  "Гермес найдёт вашу инструкцию и ответит по ней. Если ответа нет — попросит сотрудника помочь.",
                  "Hermes finds your instructions and uses them to answer. If information is missing, it asks a staff member for help.",
                )}
              </p>
            </>
          ) : (
            <p>
              {t(
                "Расписание, цены, места и записи уже живут в Center. Их не нужно переписывать сюда. Внутренние документы можно оставить только для команды.",
                "Schedules, prices, availability and bookings already live in Center. No need to copy them here. Internal documents can remain team-only.",
              )}
            </p>
          )}
        </div>
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onClose}>
            {t("Пропустить", "Skip")}
          </Button>
          <Button onClick={() => (step === 1 ? onStep(2) : onClose())}>
            {step === 1 ? t("Дальше", "Next") : t("Начать", "Get started")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
