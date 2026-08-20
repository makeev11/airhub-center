import { ImagePlus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  useCustomEmojiQuery,
  useOwnCustomEmojiQuery,
  useRemoveCustomEmojiMutation,
  useSetCustomEmojiMutation,
} from "@/features/custom-emoji/hooks";
import {
  normalizeShortcode,
  suggestShortcodeFromFilename,
} from "@/shared/api/customEmoji";
import { pickAndUploadMedia } from "@/shared/api/tauri";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { SettingsOptionGroup } from "@/features/settings/ui/SettingsOptionGroup";
import { SettingsSectionHeader } from "@/features/settings/ui/SettingsSectionHeader";

/**
 * Custom emoji management (NIP-30, kind:30030). Each member owns their own set:
 * adding uploads an image and republishes the caller's own 30030; removing only
 * touches the caller's own set. So this card edits "My emoji" — the only set the
 * caller can publish — and shows the community palette (the read-only union of
 * every member's set) separately, since a member cannot remove someone else's
 * emoji. When shortcodes collide across members, the palette shows one
 * deterministic winner (see `unionCustomEmoji`).
 */
export function CustomEmojiSettingsCard() {
  const isRussian = useAirHopLocale() === "ru-RU";
  const { data: own = [], isLoading: ownLoading } = useOwnCustomEmojiQuery();
  const { data: community = [], isLoading: communityLoading } =
    useCustomEmojiQuery();
  const setEmoji = useSetCustomEmojiMutation();
  const removeEmoji = useRemoveCustomEmojiMutation();

  const [name, setName] = React.useState("");
  const [pendingUpload, setPendingUpload] = React.useState<{
    url: string;
    filename: string | null;
  } | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);

  const normalized = normalizeShortcode(name);
  const nameInvalid = name.trim().length > 0 && normalized === null;
  // "Replace" only applies to MY set — that's the set the upload will rewrite.
  const ownDuplicate =
    normalized !== null && own.some((e) => e.shortcode === normalized);
  const canSubmit =
    pendingUpload !== null &&
    normalized !== null &&
    !isUploading &&
    !setEmoji.isPending;

  const handleUpload = React.useCallback(async () => {
    setIsUploading(true);
    try {
      const blobs = await pickAndUploadMedia();
      const blob = blobs[0];
      if (!blob?.url) {
        return;
      }
      if (!blob.type.startsWith("image/")) {
        toast.error(
          isRussian
            ? "Выберите изображение для эмодзи."
            : "Choose an image file for custom emoji.",
        );
        return;
      }
      setPendingUpload({ url: blob.url, filename: blob.filename ?? null });
      const suggested = blob.filename
        ? suggestShortcodeFromFilename(blob.filename)
        : null;
      if (suggested && name.trim().length === 0) {
        setName(suggested);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isRussian
            ? "Не удалось загрузить изображение эмодзи."
            : "Failed to upload emoji image.",
      );
    } finally {
      setIsUploading(false);
    }
  }, [isRussian, name]);

  const handleAdd = React.useCallback(async () => {
    if (normalized === null || pendingUpload === null) return;
    try {
      const stored = await setEmoji.mutateAsync({
        shortcode: normalized,
        url: pendingUpload.url,
      });
      setName("");
      setPendingUpload(null);
      toast.success(
        isRussian ? `Эмодзи :${stored}: добавлен` : `Added :${stored}:`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isRussian
            ? "Не удалось добавить эмодзи."
            : "Failed to add emoji.",
      );
    }
  }, [isRussian, normalized, pendingUpload, setEmoji]);

  const handleReset = React.useCallback(() => {
    setName("");
    setPendingUpload(null);
  }, []);

  const handleRemove = React.useCallback(
    async (shortcode: string) => {
      try {
        await removeEmoji.mutateAsync(shortcode);
        toast.success(
          isRussian ? `Эмодзи :${shortcode}: удалён` : `Removed :${shortcode}:`,
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : isRussian
              ? "Не удалось удалить эмодзи."
              : "Failed to remove emoji.",
        );
      }
    },
    [isRussian, removeEmoji],
  );

  // Community emoji owned by someone else (so the caller can't remove them).
  const ownShortcodes = new Set(own.map((e) => e.shortcode));
  const othersEmoji = community.filter((e) => !ownShortcodes.has(e.shortcode));

  return (
    <section className="min-w-0" data-testid="settings-custom-emoji">
      <SettingsSectionHeader
        title={isRussian ? "Свои эмодзи" : "Custom emoji"}
        description={
          <>
            {isRussian
              ? "Добавляйте эмодзи, которыми сможет пользоваться вся команда. В сообщениях и реакциях вводите "
              : "Add your own custom emoji for everyone in the center to use. Type "}
            <code>:name:</code>
            {isRussian ? "." : " in messages and reactions."}
          </>
        }
      />

      <div className="space-y-6">
        <form
          className="w-full"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void handleAdd();
          }}
        >
          <SettingsOptionGroup>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-[1_1_22rem]">
                <h4 className="text-sm font-medium">
                  {isRussian ? "Загрузите изображение" : "Upload an image"}
                </h4>
                <p className="text-sm font-normal text-muted-foreground">
                  {isRussian
                    ? "Лучше всего подходят квадратные изображения. Поддерживаются GIF, PNG, JPEG и WebP."
                    : "Square images work best. GIF, PNG, JPEG, and WebP files are supported."}
                </p>
              </div>
              <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-background">
                  {pendingUpload ? (
                    <img
                      alt={
                        isRussian
                          ? "Предпросмотр выбранного эмодзи"
                          : "Selected custom emoji preview"
                      }
                      src={rewriteRelayUrl(pendingUpload.url)}
                      className="h-14 w-14 object-contain"
                      draggable={false}
                    />
                  ) : (
                    <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 space-y-2">
                  {pendingUpload?.filename ? (
                    <p className="max-w-full truncate text-sm font-normal text-muted-foreground">
                      {pendingUpload.filename}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    data-testid="custom-emoji-upload"
                    onClick={() => void handleUpload()}
                    disabled={isUploading || setEmoji.isPending}
                    variant="outline"
                  >
                    {isUploading
                      ? isRussian
                        ? "Загружаем…"
                        : "Uploading…"
                      : pendingUpload
                        ? isRussian
                          ? "Выбрать другое"
                          : "Choose different image"
                        : isRussian
                          ? "Загрузить изображение"
                          : "Upload image"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-[1_1_22rem]">
                <h4 className="text-sm font-medium">
                  {isRussian ? "Назовите эмодзи" : "Give it a name"}
                </h4>
                <p className="text-sm font-normal text-muted-foreground">
                  {isRussian
                    ? "Это имя нужно будет вводить в сообщениях и реакциях."
                    : "This is what you’ll type to add this emoji to messages and reactions."}
                </p>
              </div>
              <div className="w-full min-w-0 max-w-sm flex-[1_1_20rem] space-y-2">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    :
                  </span>
                  <Input
                    id="custom-emoji-name"
                    data-testid="custom-emoji-name-input"
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="px-6"
                    placeholder="party-parrot"
                    spellCheck={false}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    :
                  </span>
                </div>
                {nameInvalid ? (
                  <p className="text-sm text-destructive">
                    {isRussian
                      ? "Используйте только буквы, цифры, дефис или подчёркивание."
                      : "Use only letters, numbers, hyphen, or underscore."}
                  </p>
                ) : pendingUpload === null ? (
                  <p className="text-sm font-normal text-muted-foreground">
                    {isRussian
                      ? "Сначала выберите изображение — Airhop предложит имя по названию файла."
                      : "Choose an image first; Airhop will suggest a name from the filename."}
                  </p>
                ) : ownDuplicate ? (
                  <p className="text-sm font-normal text-muted-foreground">
                    {isRussian
                      ? `Эмодзи :${normalized}: уже существует — новое изображение заменит старое.`
                      : `You already have :${normalized}: — saving will replace its image.`}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-4 py-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                disabled={
                  setEmoji.isPending || (name.length === 0 && !pendingUpload)
                }
              >
                {isRussian ? "Очистить" : "Clear"}
              </Button>
              <Button
                type="submit"
                data-testid="custom-emoji-add"
                disabled={!canSubmit}
              >
                {setEmoji.isPending
                  ? isRussian
                    ? "Сохраняем…"
                    : "Saving…"
                  : isRussian
                    ? "Сохранить эмодзи"
                    : "Save emoji"}
              </Button>
            </div>
          </SettingsOptionGroup>
        </form>

        <div className="space-y-3" data-testid="custom-emoji-mine">
          <h2 className="text-lg font-semibold tracking-tight">
            {isRussian ? "Мои эмодзи" : "My emoji"}
            {own.length > 0 ? ` (${own.length})` : ""}
          </h2>
          {ownLoading ? (
            <SettingsOptionGroup>
              <div className="px-4 py-3 text-sm font-normal text-muted-foreground">
                {isRussian ? "Загружаем…" : "Loading…"}
              </div>
            </SettingsOptionGroup>
          ) : own.length === 0 ? (
            <SettingsOptionGroup>
              <div className="px-4 py-3 text-sm font-normal text-muted-foreground">
                {isRussian
                  ? "Вы пока не добавили ни одного эмодзи."
                  : "You haven't added any emoji yet. Add one above."}
              </div>
            </SettingsOptionGroup>
          ) : (
            <SettingsOptionGroup>
              {own.map((e) => (
                <div
                  key={e.shortcode}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <img
                    alt={`:${e.shortcode}:`}
                    src={rewriteRelayUrl(e.url)}
                    className="h-6 w-6 shrink-0 object-contain"
                    draggable={false}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    :{e.shortcode}:
                  </span>
                  <Button
                    aria-label={
                      isRussian
                        ? `Удалить :${e.shortcode}:`
                        : `Remove :${e.shortcode}:`
                    }
                    size="icon"
                    variant="ghost"
                    onClick={() => void handleRemove(e.shortcode)}
                    disabled={removeEmoji.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </SettingsOptionGroup>
          )}
        </div>

        {!communityLoading && othersEmoji.length > 0 ? (
          <div className="space-y-3" data-testid="custom-emoji-community">
            <h2 className="text-lg font-semibold tracking-tight">
              {isRussian ? "Эмодзи команды" : "Community emoji"} (
              {othersEmoji.length})
            </h2>
            <p className="text-sm font-normal text-muted-foreground">
              {isRussian
                ? "Добавлены другими сотрудниками. Пользоваться ими могут все, а удалить может только владелец."
                : "Added by other employees. Everyone can use them, but only their owner can remove them."}
            </p>
            <SettingsOptionGroup>
              {othersEmoji.map((e) => (
                <div
                  key={e.shortcode}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <img
                    alt={`:${e.shortcode}:`}
                    src={rewriteRelayUrl(e.url)}
                    className="h-6 w-6 shrink-0 object-contain"
                    draggable={false}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    :{e.shortcode}:
                  </span>
                </div>
              ))}
            </SettingsOptionGroup>
          </div>
        ) : null}
      </div>
    </section>
  );
}
