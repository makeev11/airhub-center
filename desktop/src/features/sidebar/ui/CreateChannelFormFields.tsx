import { cn } from "@/shared/lib/cn";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

import {
  CHANNEL_FORM_FIELD_CONTROL_CLASS,
  CHANNEL_FORM_FIELD_SHELL_CLASS,
} from "@/features/channels/ui/channelFormStyles";
import { ChannelPermissionsSettings } from "@/features/channels/ui/ChannelPermissionsSettings";
import type { CreateChannelFormState } from "@/features/sidebar/lib/useCreateChannelForm";

const CREATE_LABEL_OPTIONAL_CLASS =
  "ml-1 text-xs font-normal text-muted-foreground/50";
export const CREATE_CHANNEL_FORM_ID = "create-channel-form";

/**
 * The body of the create-channel form. Rendered inside both the standalone
 * dialog and the "Add channel" browser's create mode. Wrap in a `<form>` with
 * `id={CREATE_CHANNEL_FORM_ID}` and hook up `form.handleSubmit`.
 */
export function CreateChannelFormFields({
  form,
}: {
  form: CreateChannelFormState;
}) {
  const { channelKind, kindLabel, isCreating } = form;
  const isRussian = useAirHopLocale() === "ru-RU";

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="create-channel-name"
        >
          {isRussian ? "Название" : "Name"}
        </label>
        <div
          className={cn(
            "flex min-h-11 items-center px-3",
            CHANNEL_FORM_FIELD_SHELL_CLASS,
          )}
        >
          <Input
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            className={cn(
              "h-8 px-0 py-0 leading-6",
              CHANNEL_FORM_FIELD_CONTROL_CLASS,
            )}
            data-testid="create-channel-name"
            disabled={isCreating}
            id="create-channel-name"
            onChange={(event) => form.setName(event.target.value)}
            placeholder={
              channelKind === "forum" ? "обсуждения" : "новости-центра"
            }
            ref={form.nameInputRef}
            spellCheck={false}
            value={form.name}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="create-channel-description"
        >
          {isRussian ? "Описание" : "Description"}
          <span className={CREATE_LABEL_OPTIONAL_CLASS}>
            {isRussian ? "Необязательно" : "Optional"}
          </span>
        </label>
        <div className={CHANNEL_FORM_FIELD_SHELL_CLASS}>
          <Textarea
            className={cn(
              "min-h-20 resize-none px-3 py-3 leading-5",
              CHANNEL_FORM_FIELD_CONTROL_CLASS,
            )}
            data-testid="create-channel-description"
            disabled={isCreating}
            id="create-channel-description"
            onChange={(event) => form.setDescription(event.target.value)}
            placeholder={
              isRussian
                ? "Для чего нужен этот канал"
                : `What this ${kindLabel} is for`
            }
            rows={2}
            value={form.description}
          />
        </div>
      </div>

      <ChannelPermissionsSettings
        disabled={isCreating}
        onVisibilityChange={form.setVisibility}
        testIdPrefix="create-channel"
        visibility={form.visibility}
      />

      {form.errorMessage ? (
        <p className="text-sm text-destructive">{form.errorMessage}</p>
      ) : null}
    </div>
  );
}

/**
 * Footer for the create-channel form. The submit button is bound to the form
 * via `form={CREATE_CHANNEL_FORM_ID}`.
 */
export function CreateChannelFormFooter({
  form,
  submitLabel,
}: {
  form: CreateChannelFormState;
  submitLabel?: string;
}) {
  const { isCreating, kindLabel } = form;
  const isRussian = useAirHopLocale() === "ru-RU";

  return (
    <div className="flex w-full items-center justify-end gap-3">
      <Button
        data-testid="create-channel-submit"
        disabled={!form.canSubmit}
        form={CREATE_CHANNEL_FORM_ID}
        type="submit"
      >
        {isCreating
          ? isRussian
            ? "Создаём…"
            : "Creating..."
          : (submitLabel ??
            (isRussian ? "Создать канал" : `Create ${kindLabel}`))}
      </Button>
    </div>
  );
}
