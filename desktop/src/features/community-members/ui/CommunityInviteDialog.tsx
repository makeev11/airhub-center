import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { DirectAddMemberForm } from "./AddMemberDialog";
import {
  DEFAULT_INVITE_TTL_SECS,
  InviteLinkSection,
} from "./InviteLinkSection";
import { localePair } from "@/shared/locale/messengerCopy";

export function CommunityInviteDialog({
  isOwner,
  onOpenChange,
  open,
}: {
  isOwner: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [ttlSecs, setTtlSecs] = React.useState(DEFAULT_INVITE_TTL_SECS);

  React.useEffect(() => {
    if (open) setTtlSecs(DEFAULT_INVITE_TTL_SECS);
  }, [open]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[85vh] max-w-xl overflow-y-auto"
        data-testid="community-invite-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {localePair("Пригласить сотрудника", "Invite employee")}
          </DialogTitle>
          <DialogDescription>
            {localePair(
              "Добавьте человека напрямую или отправьте ему ссылку для входа.",
              "Add someone directly or share a link they can use to join.",
            )}
          </DialogDescription>
        </DialogHeader>

        <section className="mt-2 space-y-3">
          <DirectAddMemberForm
            isOwner={isOwner}
            showLabel={false}
            submitLabel={localePair("Пригласить", "Invite")}
          />
        </section>

        <section className="space-y-3">
          <p className="text-2xs font-medium text-secondary-foreground/75">
            {localePair("Настройки ссылки", "Link settings")}
          </p>
          <InviteLinkSection onTtlSecsChange={setTtlSecs} ttlSecs={ttlSecs} />
        </section>
      </DialogContent>
    </Dialog>
  );
}
