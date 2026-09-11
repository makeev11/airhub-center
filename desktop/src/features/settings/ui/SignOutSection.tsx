import * as React from "react";
import { toast } from "sonner";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";

import { NsecMaskedDisplay } from "@/features/onboarding/ui/NsecMaskedDisplay";
import { getNsec, signOut } from "@/shared/api/tauriIdentity";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Spinner } from "@/shared/ui/spinner";

/**
 * The exact phrase the user must type before the destructive sign-out button
 * unlocks. Kept lowercase; the comparison trims and lowercases input so a
 * stray capital or trailing space does not trip people up — the friction is
 * deliberate typing, not case sensitivity.
 */
export const SIGNOUT_CONFIRM_PHRASE = "wipe all my data";

/**
 * Sign-out card + destructive confirmation flow.
 *
 * Signing out wipes the identity key and all local data, so the confirm
 * dialog gates the delete button behind two explicit steps:
 *
 * 1. Confirm recovery — Settings offers a tested password-protected backup;
 *    the dialog also shows the raw nsec as a last-chance fallback, and the
 *    user checks a box confirming they can restore their identity.
 * 2. Typed confirmation — the user must type the exact phrase
 *    "wipe all my data".
 *
 * Only when both gates pass does "Delete my data" become clickable.
 */
export function SignOutSection() {
  const russian = useAirHopLocale() === "ru-RU";
  const confirmPhrase = russian
    ? "удалить данные с устройства"
    : SIGNOUT_CONFIRM_PHRASE;
  const pendingLabel = russian ? "Выходим…" : "Signing out…";
  const deleteLabel = russian
    ? "Выйти и удалить локальные данные"
    : "Sign out and delete local data";
  const [isOpen, setIsOpen] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);

  // Backup gate.
  const [nsec, setNsec] = React.useState<string | null>(null);
  const [nsecError, setNsecError] = React.useState<string | null>(null);
  const [isNsecLoading, setIsNsecLoading] = React.useState(false);
  const [hasConfirmedBackup, setHasConfirmedBackup] = React.useState(false);
  // Guards against a late-resolving getNsec() repopulating state after the
  // dialog closes.
  const fetchCancelledRef = React.useRef(false);

  // Typed-confirmation gate.
  const [confirmText, setConfirmText] = React.useState("");
  const isPhraseConfirmed = confirmText.trim().toLowerCase() === confirmPhrase;

  const canDelete = hasConfirmedBackup && isPhraseConfirmed && !isPending;

  function resetDialogState() {
    fetchCancelledRef.current = true;
    setNsec(null);
    setNsecError(null);
    setIsNsecLoading(false);
    setHasConfirmedBackup(false);
    setConfirmText("");
  }

  React.useEffect(() => {
    return () => {
      fetchCancelledRef.current = true;
      setNsec(null);
    };
  }, []);

  async function openDialog() {
    setIsOpen(true);
    fetchCancelledRef.current = false;
    setIsNsecLoading(true);
    setNsecError(null);
    try {
      const value = await getNsec();
      if (!fetchCancelledRef.current) setNsec(value);
    } catch {
      if (!fetchCancelledRef.current)
        setNsecError(
          russian
            ? "Не удалось получить ключ доступа. Повторите попытку."
            : "Failed to retrieve private key. Please try again.",
        );
    } finally {
      if (!fetchCancelledRef.current) setIsNsecLoading(false);
    }
  }

  function handleSignOut() {
    setIsPending(true);
    // Keep the pending state if signOut() resolves before restart.
    signOut()
      .then(() => {
        // Clear web storage for this origin on the success path only. This
        // covers dev builds where the Rust webview wipe targets the
        // .app-bundle WebKit dir (missing in `tauri dev`), preventing stale
        // community config from vouching for the fresh key on next boot. In
        // production the Rust wipe already handles this; the clear here is
        // redundant but harmless. The restart may race this clear — that is
        // acceptable; Fix A (pubkey-scoped heuristic) is the correctness
        // gate.
        window.localStorage.clear();
        window.sessionStorage.clear();
      })
      .catch(() => {
        setIsPending(false);
        setIsOpen(false);
        resetDialogState();
        toast.error(
          russian
            ? "Не удалось выйти. Повторите попытку."
            : "Sign out failed. Please try again.",
        );
      });
  }

  return (
    <div
      className="mt-8 border-t border-border/60 pb-6 pt-5"
      data-testid="settings-signout"
    >
      <div className="flex items-center justify-between gap-4 px-1">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            {russian ? "Выход из аккаунта" : "Sign out"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {russian
              ? "Ключ доступа и локальные данные приложения будут удалены с этого устройства. Данные центра на сервере останутся. Перед выходом сохраните ключ или проверьте резервную копию: без них вы можете потерять доступ к аккаунту."
              : "Your identity key and local app data will be removed from this device. Center data on the server will remain. Before signing out, save your key or verify a backup: without them, you may lose access to your account."}
          </p>
        </div>
        <Button
          className="shrink-0"
          data-testid="signout-open-dialog"
          disabled={isPending}
          onClick={() => void openDialog()}
          type="button"
          variant="destructive"
        >
          {isPending ? (
            <Spinner aria-label={pendingLabel} className="h-4 w-4 border-2" />
          ) : null}
          {isPending ? pendingLabel : deleteLabel}
        </Button>
      </div>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setIsOpen(false);
            resetDialogState();
          }
        }}
        open={isOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {russian
                ? "Выйти и удалить данные с устройства?"
                : "Sign out and delete data from this device?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {russian
                ? "Будут удалены ключ доступа, локальные настройки агентов и кеш приложения. AirHop Center перезапустится и предложит войти заново. Это действие нельзя отменить; данные на сервере не удаляются."
                : "This removes your identity key, local agent settings, and app cache. AirHop Center will restart and ask you to sign in again. This cannot be undone; server data is not deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <p className="text-sm font-medium">
              {russian
                ? "1. Подтвердите, что сможете восстановить доступ"
                : "1. Confirm you can restore your identity"}
            </p>
            {isNsecLoading ? (
              <p className="text-sm text-muted-foreground">
                {russian ? "Загрузка…" : "Loading…"}
              </p>
            ) : nsecError ? (
              <p
                className="text-sm text-destructive"
                data-testid="signout-nsec-error"
              >
                {nsecError}
              </p>
            ) : nsec ? (
              <NsecMaskedDisplay nsec={nsec} />
            ) : null}
            <label
              className="flex cursor-pointer items-start gap-2.5 text-sm has-[button:disabled]:cursor-not-allowed has-[button:disabled]:opacity-60"
              data-testid="signout-backup-confirm-label"
              htmlFor="signout-backup-confirm"
            >
              <Checkbox
                checked={hasConfirmedBackup}
                className="mt-0.5"
                data-testid="signout-backup-confirm"
                disabled={isPending}
                id="signout-backup-confirm"
                onCheckedChange={(checked) =>
                  setHasConfirmedBackup(checked === true)
                }
              />
              <span>
                {russian
                  ? "Я проверил резервную копию или сохранил этот секретный ключ в безопасном месте."
                  : "I have tested a key backup or saved this private key somewhere safe."}
              </span>
            </label>
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="signout-confirm-phrase"
            >
              {russian
                ? "2. Для подтверждения введите "
                : "2. To confirm, type "}
              <span className="font-semibold">«{confirmPhrase}»</span>
            </label>
            <Input
              autoComplete="off"
              data-testid="signout-confirm-phrase"
              disabled={isPending}
              id="signout-confirm-phrase"
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={confirmPhrase}
              spellCheck={false}
              value={confirmText}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              {russian ? "Отмена" : "Cancel"}
            </AlertDialogCancel>
            {/* A plain Button, not AlertDialogAction: Radix's Action closes
                the dialog on click, which would drop the pending state while
                the wipe + restart is still in flight. */}
            <Button
              data-testid="signout-confirm"
              disabled={!canDelete}
              onClick={handleSignOut}
              type="button"
              variant="destructive"
            >
              {isPending ? (
                <Spinner
                  aria-label={pendingLabel}
                  className="h-4 w-4 border-2"
                />
              ) : null}
              {isPending ? pendingLabel : deleteLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
