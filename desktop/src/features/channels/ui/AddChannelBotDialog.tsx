import * as React from "react";
import { Bot } from "lucide-react";
import type { AcpRuntime } from "@/shared/api/types";
import type { CreateChannelManagedAgentResult } from "@/features/agents/hooks";
import {
  useAddChannelMembersMutation,
  useChannelMembersQuery,
} from "@/features/channels/hooks";
import { useAirhopPrincipalDirectory } from "@/features/airhop-agents/data/principalDirectory";
import { AIRHOP_AGENT_CATALOG } from "@/features/airhop-agents/model/airhopAgentCatalog";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import {
  useMessengerCopy,
  messengerCount,
} from "@/shared/locale/messengerCopy";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { ChooserDialogContent } from "@/shared/ui/chooser-dialog-content";

type Props = {
  channelId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: AcpRuntime[];
  providersErrorMessage?: string | null;
  providersLoading?: boolean;
  onAdded?: (result: CreateChannelManagedAgentResult) => void;
  onCreateAgent: () => void;
};

/** Adds the registered identity, never clones a global persona or starts a second agent. */
export function AddChannelBotDialog({ channelId, open, onOpenChange }: Props) {
  const m = useMessengerCopy();
  const locale = useAirHopLocale();
  const directory = useAirhopPrincipalDirectory(open);
  const members = useChannelMembersQuery(channelId);
  const add = useAddChannelMembersMutation(channelId);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [error, setError] = React.useState(false);
  const inChannel = new Set(
    (members.data ?? []).map((member) => member.pubkey.toLowerCase()),
  );
  const agents = directory.data?.agents ?? [];
  const available = selected.filter(
    (key) =>
      agents.some((agent) => agent.pubkey === key) && !inChannel.has(key),
  );
  React.useEffect(() => {
    if (!channelId && !open) return;
    setSelected([]);
    setError(false);
  }, [channelId, open]);
  async function submit() {
    if (!channelId || !available.length || add.isPending) return;
    setError(false);
    try {
      const result = await add.mutateAsync({
        channelId,
        pubkeys: available,
        role: "bot",
      });
      if (result.errors.length) {
        setSelected(result.errors.map((entry) => entry.pubkey));
        setError(true);
      } else onOpenChange(false);
    } catch {
      setError(true);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChooserDialogContent
        data-testid="add-channel-bot-dialog"
        title={m("Add agents")}
        description={m(
          "Choose the center’s registered agents. Existing identities and history are preserved.",
        )}
        footer={
          <>
            <Button
              variant="outline"
              disabled={add.isPending}
              onClick={() => onOpenChange(false)}
            >
              {m("Cancel")}
            </Button>
            <Button
              disabled={
                !available.length ||
                add.isPending ||
                members.isLoading ||
                members.isError ||
                directory.isFetching
              }
              onClick={() => void submit()}
            >
              {add.isPending ? m("Adding…") : m("Add agent")}
            </Button>
          </>
        }
      >
        <h3 className="text-sm font-medium">
          {m("Your agents")} · {messengerCount(agents.length, "agent", locale)}
        </h3>
        {members.isError ? (
          <p role="alert">
            {m("Could not load members. Please try again.")}{" "}
            <Button variant="outline" onClick={() => void members.refetch()}>
              {m("Retry")}
            </Button>
          </p>
        ) : null}
        {directory.isLoading ? (
          <p role="status">{m("Loading…")}</p>
        ) : directory.isError || !directory.data ? (
          <div role="alert">
            <p>{m("Could not load the center’s team.")}</p>
            <Button variant="outline" onClick={() => void directory.refetch()}>
              {m("Retry")}
            </Button>
          </div>
        ) : (
          <>
            {agents.length === 0 ? (
              <p>
                {m("No registered agents are available.")}{" "}
                {m("Connect the AirHop team in AI agent settings.")}
              </p>
            ) : null}
            {agents.map((agent) => {
              const definition = AIRHOP_AGENT_CATALOG.find(
                (item) => item.role === agent.role,
              );
              const name = definition?.name[locale] ?? m("Hermes");
              return (
                <label
                  key={agent.pubkey}
                  className="flex items-center gap-3 rounded-lg border p-3"
                  data-testid="organization-agent-option"
                >
                  <input
                    type="checkbox"
                    checked={
                      selected.includes(agent.pubkey) ||
                      inChannel.has(agent.pubkey)
                    }
                    disabled={inChannel.has(agent.pubkey) || add.isPending}
                    onChange={(event) =>
                      setSelected((keys) =>
                        event.target.checked
                          ? [...keys, agent.pubkey]
                          : keys.filter((key) => key !== agent.pubkey),
                      )
                    }
                  />
                  <Bot className="size-5" />
                  <span className="flex-1">
                    <span className="block font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">
                      {inChannel.has(agent.pubkey)
                        ? m("Already in this channel")
                        : (definition?.roleLabel[locale] ??
                          m("Parent Administrator"))}
                    </span>
                  </span>
                </label>
              );
            })}
          </>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {m("Could not add the agent. Refresh and try again.")}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {m(
            "Only active registered agents are shown. Global personas are not imported.",
          )}
        </p>
      </ChooserDialogContent>
    </Dialog>
  );
}
