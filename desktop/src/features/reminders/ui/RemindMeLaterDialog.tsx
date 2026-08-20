import { CalendarClock, Clock, Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useAirHopLocale } from "@/features/activation/useAirHopLocale";
import { useReminderMutations } from "@/features/reminders/hooks";
import {
  parseCustomDateTime,
  TIME_PRESETS,
  todayDateString,
} from "@/features/reminders/lib/timePresets";
import type { ReminderTarget } from "@/features/reminders/lib/reminderTypes";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

export function RemindMeLaterDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ReminderTarget | null;
}) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const pubkey = useIdentityQuery().data?.pubkey ?? "";
  const { create } = useReminderMutations(pubkey);
  const [note, setNote] = React.useState("");
  const [customDate, setCustomDate] = React.useState(todayDateString);
  const [customTime, setCustomTime] = React.useState("09:00");
  const customTimestamp = parseCustomDateTime(customDate, customTime);

  const submit = (notBefore: number) => {
    if (!target || create.isPending) return;
    create.mutate(
      { target, notBefore, note: note || undefined },
      {
        onSuccess: () => {
          toast.success(isRussian ? "Напоминание установлено" : "Reminder set");
          onOpenChange(false);
          setNote("");
        },
        onError: () =>
          toast.error(
            isRussian
              ? "Не удалось создать напоминание"
              : "Failed to create reminder",
          ),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {isRussian ? "Напомнить позже" : "Remind me later"}
          </DialogTitle>
          <DialogDescription>
            {isRussian
              ? "Выберите, когда напомнить об этом сообщении."
              : "Choose when you want to be reminded about this message."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {TIME_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="outline"
              className="justify-start"
              disabled={create.isPending}
              onClick={() => submit(preset.getTimestamp())}
            >
              {isRussian
                ? ({
                    "In 30 minutes": "Через 30 минут",
                    "In 1 hour": "Через 1 час",
                    "In 3 hours": "Через 3 часа",
                    "Tomorrow at 9am": "Завтра в 09:00",
                    "Next Monday at 9am": "В следующий понедельник в 09:00",
                  }[preset.label] ?? preset.label)
                : preset.label}
            </Button>
          ))}
        </div>

        <div className="space-y-3 border-t pt-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="h-4 w-4" />
            {isRussian ? "Своя дата и время" : "Custom date & time"}
          </p>
          <div className="flex gap-2">
            <Input
              aria-label={isRussian ? "Дата напоминания" : "Reminder date"}
              className="flex-1"
              min={todayDateString()}
              onChange={(e) => setCustomDate(e.target.value)}
              type="date"
              value={customDate}
            />
            <Input
              aria-label={isRussian ? "Время напоминания" : "Reminder time"}
              className="w-[120px]"
              onChange={(e) => setCustomTime(e.target.value)}
              type="time"
              value={customTime}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="reminder-note"
            className="text-sm font-medium text-muted-foreground"
          >
            {isRussian ? "Заметка (необязательно)" : "Note (optional)"}
          </label>
          <Textarea
            id="reminder-note"
            placeholder={isRussian ? "Добавьте заметку…" : "Add a note..."}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            {isRussian ? "Отмена" : "Cancel"}
          </Button>
          <Button
            className="relative"
            disabled={create.isPending || customTimestamp === null}
            onClick={() => {
              if (customTimestamp === null) return;
              submit(customTimestamp);
            }}
            variant="default"
          >
            {/* The hidden label keeps the button width stable while the
                spinner overlays it. */}
            <span className={create.isPending ? "invisible" : undefined}>
              {isRussian ? "Установить напоминание" : "Set reminder"}
            </span>
            {create.isPending ? (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="animate-spin" />
              </span>
            ) : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
