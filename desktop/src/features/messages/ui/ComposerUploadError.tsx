import { messageError, useMessengerCopy } from "@/shared/locale/messengerCopy";

/** Upload feedback stays localized without resetting the editor's draft. */
export function ComposerUploadError({
  message,
  onDismiss,
}: {
  message: string | undefined;
  onDismiss: () => void;
}) {
  const m = useMessengerCopy();
  return (
    <div className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {m("Upload failed:")} {messageError(message)}
      <button className="ml-2 underline" onClick={onDismiss} type="button">
        {m("Dismiss")}
      </button>
    </div>
  );
}
