import * as React from "react";

import { useUpdateManagedAgentMutation } from "@/features/agents/hooks";
import { runLocationForBackend } from "@/features/agents/lib/agentAccessWarning";
import { CreateAgentRespondToField } from "@/features/agents/ui/RespondToField";
import type { ManagedAgent, RespondToMode } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useAirHopLocale } from "@/features/activation/useAirHopLocale";

export function EditRespondToDialog({
  agent,
  currentPubkey,
  onOpenChange,
  open,
}: {
  agent: ManagedAgent | null;
  currentPubkey?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const updateMutation = useUpdateManagedAgentMutation();
  const [respondTo, setRespondTo] = React.useState<RespondToMode>("owner-only");
  const [respondToAllowlist, setRespondToAllowlist] = React.useState<string[]>(
    [],
  );

  React.useEffect(() => {
    if (agent) {
      setRespondTo(agent.respondTo);
      setRespondToAllowlist([...agent.respondToAllowlist]);
    }
  }, [agent]);

  const respondToValid =
    respondTo !== "allowlist" || respondToAllowlist.length > 0;

  async function handleSave() {
    if (!agent) return;
    await updateMutation.mutateAsync({
      pubkey: agent.pubkey,
      respondTo,
      respondToAllowlist:
        respondTo === "allowlist" ? respondToAllowlist : undefined,
    });
    onOpenChange(false);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isRussian ? "Доступ к AI-агенту" : "Manage agent access"}
          </DialogTitle>
          <DialogDescription>
            {isRussian
              ? `Выберите, кто может давать задания агенту ${agent?.name ?? ""}.`
              : `Choose who can send instructions to ${agent?.name ?? "this agent"}.`}
          </DialogDescription>
        </DialogHeader>
        <CreateAgentRespondToField
          allowlist={respondToAllowlist}
          disabled={updateMutation.isPending}
          mode={respondTo}
          onAllowlistChange={setRespondToAllowlist}
          onModeChange={setRespondTo}
          ownerPubkey={currentPubkey}
          runLocation={runLocationForBackend(agent?.backend)}
        />
        {updateMutation.error instanceof Error ? (
          <p className="text-sm text-destructive">
            {updateMutation.error.message}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => onOpenChange(false)}
            size="sm"
            type="button"
            variant="outline"
          >
            {isRussian ? "Отмена" : "Cancel"}
          </Button>
          <Button
            disabled={!respondToValid || updateMutation.isPending}
            onClick={() => void handleSave()}
            size="sm"
            type="button"
          >
            {updateMutation.isPending
              ? isRussian
                ? "Сохраняем…"
                : "Saving..."
              : isRussian
                ? "Сохранить доступ"
                : "Save access"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
