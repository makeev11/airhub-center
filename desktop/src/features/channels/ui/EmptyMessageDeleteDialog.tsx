import { DeleteMessageConfirmDialog } from "@/features/messages/ui/DeleteMessageConfirmDialog";

type Props = {
  messageId: string | null;
  onDelete: (message: { id: string }) => void | Promise<void>;
  onClearEdit: (id: string | null) => void;
  onDismiss: (id: string | null) => void;
};

/** Confirms deleting a message whose edited text has been cleared. */
export function EmptyMessageDeleteDialog({
  messageId,
  onDelete,
  onClearEdit,
  onDismiss,
}: Props) {
  return (
    <DeleteMessageConfirmDialog
      onConfirm={() => {
        if (messageId) {
          onClearEdit(null);
          void onDelete({ id: messageId });
        }
        onDismiss(null);
      }}
      onOpenChange={(open) => {
        if (!open) onDismiss(null);
      }}
      open={messageId !== null}
    />
  );
}
