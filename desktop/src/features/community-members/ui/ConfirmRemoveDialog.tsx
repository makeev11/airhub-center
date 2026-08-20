import { toast } from "sonner";

import { truncatePubkey } from "@/shared/lib/pubkey";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { PubKey } from "@/shared/ui/PubKey";
import { useRemoveRelayMemberMutation } from "@/features/community-members/hooks";
import type { RelayMember } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function ConfirmRemoveDialog({
  member,
  displayName,
  open,
  onOpenChange,
}: {
  member: RelayMember | null;
  displayName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const removeMutation = useRemoveRelayMemberMutation();
  const label = displayName || (member ? truncatePubkey(member.pubkey) : "");

  function handleOpenChange(next: boolean) {
    if (!next) {
      removeMutation.reset();
    }
    onOpenChange(next);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="max-w-sm"
        data-testid="confirm-remove-member-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {isRussian ? `Удалить ${label}?` : `Remove ${label}?`}
          </DialogTitle>
          <DialogDescription>
            {isRussian
              ? "Доступ этого сотрудника к центру будет немедленно отозван."
              : "This will immediately revoke their access to the center."}
          </DialogDescription>
          {member ? (
            <PubKey
              pubkey={member.pubkey}
              testId="confirm-remove-member-pubkey"
              variant="full"
            />
          ) : null}
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => handleOpenChange(false)}
            size="sm"
            variant="outline"
          >
            {isRussian ? "Отмена" : "Cancel"}
          </Button>
          <Button
            data-testid="confirm-remove-member"
            disabled={removeMutation.isPending || !member}
            onClick={() => {
              if (!member) return;
              removeMutation.mutate(member.pubkey, {
                onSuccess: () => {
                  toast.success(
                    isRussian ? "Сотрудник удалён" : "Member removed",
                  );
                  handleOpenChange(false);
                },
                onError: (error) => {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : isRussian
                        ? "Не удалось удалить сотрудника"
                        : "Failed to remove member",
                  );
                },
              });
            }}
            size="sm"
            variant="destructive"
          >
            {removeMutation.isPending
              ? isRussian
                ? "Удаляем…"
                : "Removing…"
              : isRussian
                ? "Удалить"
                : "Remove"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
