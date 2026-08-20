import * as React from "react";

import { useAirHopLocale } from "@/features/activation/useAirHopLocale";
import { EmojiPicker } from "@/features/custom-emoji/ui/EmojiPicker";
import { StatusEmoji } from "@/features/user-status/ui/StatusEmoji";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

type SetStatusDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText?: string;
  initialEmoji?: string;
  onSave: (text: string, emoji: string) => void;
  onClear: () => void;
  hasExistingStatus: boolean;
};

export function SetStatusDialog({
  open,
  onOpenChange,
  initialText = "",
  initialEmoji = "",
  onSave,
  onClear,
  hasExistingStatus,
}: SetStatusDialogProps) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const presets = React.useMemo(
    () => [
      {
        id: "teaching-a-class",
        text: isRussian ? "На занятии" : "Teaching a class",
        emoji: "🧑‍🏫",
      },
      {
        id: "in-a-meeting",
        text: isRussian ? "На встрече" : "In a meeting",
        emoji: "\uD83D\uDDE3\uFE0F",
      },
      {
        id: "commuting",
        text: isRussian ? "В дороге" : "Commuting",
        emoji: "\uD83D\uDE8C",
      },
      {
        id: "out-sick",
        text: isRussian ? "Болею" : "Out sick",
        emoji: "\uD83E\uDD12",
      },
      {
        id: "vacationing",
        text: isRussian ? "В отпуске" : "Vacationing",
        emoji: "\uD83C\uDFD6\uFE0F",
      },
    ],
    [isRussian],
  );
  const [text, setText] = React.useState(initialText);
  const [emoji, setEmoji] = React.useState(initialEmoji);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setText(initialText);
      setEmoji(initialEmoji);
    }
  }, [open, initialText, initialEmoji]);

  function handlePresetClick(preset: { text: string; emoji: string }) {
    setText(preset.text);
    setEmoji(preset.emoji);
  }

  function handleEmojiSelect(selectedEmoji: string) {
    setEmoji(selectedEmoji);
    setPickerOpen(false);
  }

  function handleSave() {
    onSave(text.trim(), emoji);
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
    onOpenChange(false);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSave();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[420px]"
        data-testid="set-status-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {isRussian ? "Установить статус" : "Set a status"}
          </DialogTitle>
          <DialogDescription>
            {isRussian
              ? "Расскажите коллегам, чем вы заняты."
              : "Let others know what you're up to."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-2">
          <div className="flex items-center gap-2">
            <Popover onOpenChange={setPickerOpen} open={pickerOpen}>
              <div className="relative shrink-0">
                <PopoverTrigger asChild>
                  <button
                    aria-label={
                      isRussian
                        ? "Выбрать эмодзи статуса"
                        : "Choose status emoji"
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-lg transition-colors hover:bg-accent"
                    type="button"
                  >
                    {emoji ? (
                      <StatusEmoji className="h-5 w-5" value={emoji} />
                    ) : (
                      "\uD83D\uDCAC"
                    )}
                  </button>
                </PopoverTrigger>
                {emoji ? (
                  <button
                    aria-label={
                      isRussian ? "Убрать эмодзи статуса" : "Clear status emoji"
                    }
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-background bg-muted text-2xs leading-none text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEmoji("");
                    }}
                    type="button"
                  >
                    ×
                  </button>
                ) : null}
              </div>
              <PopoverContent
                align="start"
                sideOffset={4}
                className="w-auto overflow-hidden rounded-2xl p-0"
              >
                <EmojiPicker autoFocus onSelect={handleEmojiSelect} />
              </PopoverContent>
            </Popover>
            <Input
              autoFocus
              data-testid="set-status-input"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isRussian ? "Что у вас сейчас?" : "What's your status?"
              }
              value={text}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <button
                className="rounded-full border border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                data-testid={`set-status-preset-${preset.id}`}
                key={preset.id}
                onClick={() => handlePresetClick(preset)}
                type="button"
              >
                {preset.emoji} {preset.text}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {hasExistingStatus ? (
                <Button
                  data-testid="set-status-clear"
                  onClick={handleClear}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {isRussian ? "Очистить статус" : "Clear status"}
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                data-testid="set-status-cancel"
                onClick={() => onOpenChange(false)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {isRussian ? "Отмена" : "Cancel"}
              </Button>
              <Button
                data-testid="set-status-save"
                disabled={!text.trim() && !emoji}
                onClick={handleSave}
                size="sm"
                type="button"
              >
                {isRussian ? "Сохранить" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
