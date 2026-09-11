import React from "react";

import { useAppShell } from "@/app/AppShellContext";
import { computeAgentRequestStatus } from "@/shared/lib/agentRequestStatus";
import {
  computeConfigNudge,
  selectProseOrNudge,
} from "@/shared/lib/computeConfigNudge";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { AgentRequestStatusCard } from "@/shared/ui/agent-request-status-attachment";
import { AttachmentGroup } from "@/shared/ui/attachment";
import { ConfigNudgeCard } from "@/shared/ui/config-nudge-attachment";

/** Authenticate and render a relay-authored corrective agent status. */
export function useAgentRequestStatusAttachment({
  configNudgeAuthorPubkey,
  content,
  interactive,
  relaySelfPubkey,
  signerPubkey,
}: {
  configNudgeAuthorPubkey?: string | null;
  content: string;
  interactive: boolean;
  relaySelfPubkey?: string | null;
  signerPubkey?: string | null;
}) {
  const { onOpenSettings, openChannelManagement } = useAppShell();
  const locale = useAirHopLocale();
  const status = React.useMemo(
    () =>
      computeAgentRequestStatus(
        content,
        interactive,
        signerPubkey,
        relaySelfPubkey,
      ),
    [content, interactive, relaySelfPubkey, signerPubkey],
  );
  const configNudge = React.useMemo(
    () => computeConfigNudge(content, interactive, configNudgeAuthorPubkey),
    [configNudgeAuthorPubkey, content, interactive],
  );
  const openAgentSettings = React.useCallback(
    () => onOpenSettings?.("agents"),
    [onOpenSettings],
  );
  const statusAttachment =
    status === null ? null : (
      <AttachmentGroup
        className="max-w-full flex-wrap overflow-visible pb-0"
        data-agent-request-status=""
      >
        <AgentRequestStatusCard
          locale={locale}
          onOpenAgentSettings={openAgentSettings}
          onOpenChannelMembers={openChannelManagement}
          status={status}
        />
      </AttachmentGroup>
    );
  return (
    selectProseOrNudge(configNudge, statusAttachment) ??
    (configNudge === null ? null : (
      <AttachmentGroup
        className="max-w-full flex-wrap overflow-visible pb-0"
        data-config-nudge=""
      >
        <ConfigNudgeCard nudge={configNudge} />
      </AttachmentGroup>
    ))
  );
}
