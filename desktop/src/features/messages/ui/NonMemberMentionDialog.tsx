import {
  messageError,
  messageText,
  useMessengerCopy,
} from "@/shared/locale/messengerCopy";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";

type NonMemberMentionDialogProps = {
  error: string | null;
  isInvitePending: boolean;
  names: string[];
  onDismiss: () => void;
  onDoNothing: () => void;
  onInvite: () => void;
  open: boolean;
};

export function NonMemberMentionDialog({
  error,
  isInvitePending,
  names,
  onDismiss,
  onDoNothing,
  onInvite,
  open,
}: NonMemberMentionDialogProps) {
  useMessengerCopy();
  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onDismiss();
        }
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {messageText("Mention people outside this channel?")}{" "}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {messageText(
              names.length === 1
                ? "{names} is not in this channel. Invite them, or send without inviting them."
                : "{names} are not in this channel. Invite them, or send without inviting them.",
              { names: names.join(", ") },
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {messageError(error)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button
            disabled={isInvitePending}
            onClick={onDoNothing}
            size="sm"
            type="button"
            variant="outline"
          >
            {messageText("Do nothing")}{" "}
          </Button>
          <Button
            disabled={isInvitePending}
            onClick={onInvite}
            size="sm"
            type="button"
          >
            {isInvitePending
              ? messageText("Inviting...")
              : messageText("Invite")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
