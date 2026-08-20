import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { useAirHopLocale } from "@/features/activation/useAirHopLocale";

/**
 * The "Delete message?" confirmation. Single definition shared by every
 * surface that deletes a message — the message action menu (MessageActionBar)
 * and the empty-edit delete path (clearing an edit to empty and hitting accept
 * routes here, so it prompts exactly like the menu's Delete does). `onConfirm`
 * fires when the user presses Delete; the caller owns the actual deletion.
 */
export function DeleteMessageConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const isRussian = useAirHopLocale() === "ru-RU";
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isRussian ? "Удалить сообщение?" : "Delete message?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isRussian
              ? "Сообщение будет удалено без возможности восстановления."
              : "This will permanently delete this message and cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline">
              {isRussian ? "Отмена" : "Cancel"}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button onClick={onConfirm} type="button" variant="destructive">
              {isRussian ? "Удалить" : "Delete"}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
