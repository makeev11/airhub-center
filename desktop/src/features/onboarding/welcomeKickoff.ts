import * as React from "react";

import {
  useAcpRuntimesQuery,
  useManagedAgentsQuery,
} from "@/features/agents/hooks";
import { canonicalRelayUrl } from "@/features/agents/managedAgentRuntimeStatus";
import { useManagedAgentRuntimesQuery } from "@/features/agents/managedAgentRuntimeHooks";
import { useGlobalAgentConfig } from "@/features/agents/useGlobalAgentConfig";
import { createHttpBookingSettingsRepository } from "@/features/booking/data/httpBookingSettingsRepository";
import { useCommunities } from "@/features/communities/useCommunities";
import { isWelcomeChannel } from "@/features/onboarding/welcome";
import {
  pickWelcomeTeamStarterAgentForRelay,
  WELCOME_TEAM_STARTERS,
  type WelcomeTeamAgents,
} from "@/features/onboarding/welcomeGuide";
import { resolveAgentReadiness } from "@/features/onboarding/ui/agentReadiness";
import {
  type AirhopWelcomeRole,
  type WelcomeKickoffStage,
  resolveWelcomeLocale,
} from "@/features/onboarding/welcomeTeamLocale";
import { useIdentityQuery } from "@/shared/api/hooks";
import { dispatchAirhopAgentTask } from "@/shared/api/tauriAirhopAgentTasks";
import { sendManagedAgentChannelMessage } from "@/shared/api/tauriManagedAgentMessages";
import { getProfile } from "@/shared/api/tauriProfiles";
import type {
  Channel,
  ManagedAgent,
  ManagedAgentRuntimeStatus,
  RelayEvent,
} from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export const ALL_WELCOME_KICKOFF_STAGES = [
  "fizz_intro",
  "fizz_invite_administrator",
  "administrator_intro",
  "fizz_invite_analyst",
  "analyst_intro",
  "fizz_invite_content_marketer",
  "content_marketer_intro",
  "fizz_explain_team",
  "fizz_first_question",
] as const satisfies readonly WelcomeKickoffStage[];

export const WELCOME_KICKOFF_PROVIDER_MARKER =
  "airhop-welcome-kickoff.provider-required.v2";

const KICKOFF_STAGE_TAG = "airhop-kickoff-stage";
const OWNER_MESSAGE_KINDS = new Set([9, 40002]);
const READY_RUNTIME_LIFECYCLES = new Set(["listening", "ready"]);

type WelcomeKickoffAgentIdentities = Readonly<
  Record<AirhopWelcomeRole, Readonly<{ pubkey: string }>>
>;

export type WelcomeKickoffSnapshot = Readonly<{
  observedStages: ReadonlySet<WelcomeKickoffStage>;
  ownerHasSpoken: boolean;
  inFlightStage: WelcomeKickoffStage | null;
}>;

export type WelcomeKickoffTask = Readonly<{
  stage: WelcomeKickoffStage;
  targetRole: AirhopWelcomeRole;
  taskId: string;
  instruction: string;
  parentEventId: null;
}>;

type KickoffContext = Readonly<{
  locale: string;
  ownerName?: string;
  organization?: Readonly<{
    name: string;
    timeZone: string;
  }>;
}>;

const kickoffContextPromises = new Map<string, Promise<KickoffContext>>();

function normalizeRelayUrl(relayUrl: string | null | undefined) {
  return relayUrl?.trim().replace(/\/+$/, "") ?? "";
}

function isKickoffStage(value: string): value is WelcomeKickoffStage {
  return (ALL_WELCOME_KICKOFF_STAGES as readonly string[]).includes(value);
}

export function welcomeKickoffTargetRole(
  stage: WelcomeKickoffStage,
): AirhopWelcomeRole {
  switch (stage) {
    case "administrator_intro":
      return "administrator";
    case "analyst_intro":
      return "analyst";
    case "content_marketer_intro":
      return "content_marketer";
    case "fizz_intro":
    case "fizz_invite_administrator":
    case "fizz_invite_analyst":
    case "fizz_invite_content_marketer":
    case "fizz_explain_team":
    case "fizz_first_question":
      return "fizz";
  }
}

export function nextKickoffStages(
  observedStages: Iterable<WelcomeKickoffStage>,
): WelcomeKickoffStage[] {
  const observed = new Set(observedStages);
  const next = ALL_WELCOME_KICKOFF_STAGES.find((stage) => !observed.has(stage));
  return next ? [next] : [];
}

export function buildWelcomeKickoffSnapshot(
  events: readonly RelayEvent[],
  ownerPubkey: string | null | undefined,
  agents: WelcomeKickoffAgentIdentities,
  inFlightStage: WelcomeKickoffStage | null,
): WelcomeKickoffSnapshot {
  const observedStages = new Set<WelcomeKickoffStage>();
  for (const event of events) {
    for (const tag of event.tags) {
      const stage = tag[0] === KICKOFF_STAGE_TAG ? tag[1] : undefined;
      if (!stage || !isKickoffStage(stage)) continue;
      const expectedRole = welcomeKickoffTargetRole(stage);
      if (
        normalizePubkey(event.pubkey) ===
        normalizePubkey(agents[expectedRole].pubkey)
      ) {
        observedStages.add(stage);
      }
    }
  }

  const normalizedOwner = ownerPubkey ? normalizePubkey(ownerPubkey) : null;
  const agentPubkeys = new Set(
    Object.values(agents).map((agent) => normalizePubkey(agent.pubkey)),
  );
  const ownerHasSpoken =
    normalizedOwner !== null &&
    events.some(
      (event) =>
        OWNER_MESSAGE_KINDS.has(event.kind) &&
        event.content.trim().length > 0 &&
        normalizePubkey(event.pubkey) === normalizedOwner &&
        !agentPubkeys.has(normalizePubkey(event.pubkey)),
    );

  return { observedStages, ownerHasSpoken, inFlightStage };
}

export function shouldDispatchKickoff(
  snapshot: WelcomeKickoffSnapshot & {
    targetRuntimeReady?: boolean;
    providerReady?: boolean;
  },
) {
  return (
    !snapshot.ownerHasSpoken &&
    snapshot.inFlightStage === null &&
    (snapshot.targetRuntimeReady ?? true) &&
    (snapshot.providerReady ?? true) &&
    nextKickoffStages(snapshot.observedStages).length > 0
  );
}

export function buildKickoffTask(
  stage: WelcomeKickoffStage,
  organizationLocale: string | null | undefined,
  options: Readonly<{
    channelId: string;
    ownerName?: string;
    organization?: Readonly<{
      name: string;
      timeZone: string;
    }>;
  }>,
): WelcomeKickoffTask {
  const locale = resolveWelcomeLocale(organizationLocale);
  const organizationContext = options.organization
    ? JSON.stringify(options.organization)
    : "not configured";
  return {
    stage,
    targetRole: welcomeKickoffTargetRole(stage),
    taskId: `airhop-welcome:${options.channelId}:${stage}`,
    parentEventId: null,
    instruction: [
      `Language: ${locale.language}.`,
      `Owner: ${options.ownerName?.trim() || "unknown"}.`,
      locale.kickoffInstruction(stage, options.ownerName),
      `Known organization data: ${organizationContext}.`,
      "Write only top-level messages in the Welcome channel; never create or reply in a thread.",
      "Use one thought per message and at most three short messages.",
      `Call airhop_send_messages with kickoff_stage="${stage}" so every output carries the airhop-kickoff-stage receipt.`,
      "Do not announce that onboarding or setup is complete.",
    ].join("\n"),
  };
}

export function buildWelcomeProviderFallback(
  organizationLocale: string | null | undefined,
) {
  return {
    targetRole: "fizz" as const,
    message: resolveWelcomeLocale(organizationLocale).providerRequired,
    marker: WELCOME_KICKOFF_PROVIDER_MARKER,
    parentEventId: null,
    kickoffStage: null,
  };
}

export function welcomeRuntimeIsReady(
  runtimes: readonly Pick<
    ManagedAgentRuntimeStatus,
    "pubkey" | "relayUrl" | "lifecycle"
  >[],
  agentPubkey: string,
  relayUrl: string,
) {
  const targetPubkey = normalizePubkey(agentPubkey);
  const targetRelay = canonicalRelayUrl(relayUrl);
  if (!targetRelay) return false;
  return runtimes.some(
    (runtime) =>
      normalizePubkey(runtime.pubkey) === targetPubkey &&
      canonicalRelayUrl(runtime.relayUrl) === targetRelay &&
      READY_RUNTIME_LIFECYCLES.has(runtime.lifecycle),
  );
}

function resolveWelcomeTeamAgentsForRelay(
  agents: readonly ManagedAgent[],
  relayUrl: string,
): WelcomeTeamAgents | null {
  const resolved = {} as Record<AirhopWelcomeRole, ManagedAgent>;
  for (const starter of WELCOME_TEAM_STARTERS) {
    const agent = pickWelcomeTeamStarterAgentForRelay(
      [...agents],
      starter,
      relayUrl,
    );
    if (!agent) return null;
    resolved[starter.role] = agent;
  }
  return resolved;
}

function loadKickoffContext(cacheKey: string): Promise<KickoffContext> {
  const current = kickoffContextPromises.get(cacheKey);
  if (current) return current;

  const promise = Promise.all([
    createHttpBookingSettingsRepository().load(),
    getProfile().catch(() => null),
  ])
    .then(([workspace, profile]) => ({
      locale: workspace.organization.locale,
      ownerName: profile?.displayName || undefined,
      organization: {
        name: workspace.organization.name,
        timeZone: workspace.organization.timeZone,
      },
    }))
    .catch((error) => {
      kickoffContextPromises.delete(cacheKey);
      throw error;
    });
  kickoffContextPromises.set(cacheKey, promise);
  return promise;
}

/**
 * Dispatches one owner-signed semantic task at a time. Agent-authored stage
 * receipts in the ordinary top-level timeline are the durable restart cursor.
 * There is deliberately no "completed" state: after the first question there
 * is simply no next scheduled stage.
 */
export function useWelcomeKickoff(
  activeChannel: Channel | null,
  channelEvents: readonly RelayEvent[],
) {
  const { activeCommunity } = useCommunities();
  const managedAgentsQuery = useManagedAgentsQuery();
  const runtimePairsQuery = useManagedAgentRuntimesQuery();
  const acpRuntimesQuery = useAcpRuntimesQuery();
  const { globalConfig, isLoading: configLoading } = useGlobalAgentConfig();
  const identityQuery = useIdentityQuery();
  const [inFlightStage, setInFlightStage] =
    React.useState<WelcomeKickoffStage | null>(null);
  const dispatchingStageRef = React.useRef<WelcomeKickoffStage | null>(null);
  const providerNoticeInFlightRef = React.useRef(false);

  const channelId = activeChannel?.id ?? null;
  const activeChannelIdRef = React.useRef<string | null>(channelId);
  activeChannelIdRef.current = channelId;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const isActiveWelcome = isWelcomeChannel(activeChannel);
  const welcomeAgents = React.useMemo(
    () =>
      relayUrl
        ? resolveWelcomeTeamAgentsForRelay(
            managedAgentsQuery.data ?? [],
            relayUrl,
          )
        : null,
    [managedAgentsQuery.data, relayUrl],
  );
  const snapshot = React.useMemo(
    () =>
      welcomeAgents
        ? buildWelcomeKickoffSnapshot(
            channelEvents,
            identityQuery.data?.pubkey,
            welcomeAgents,
            inFlightStage,
          )
        : null,
    [channelEvents, identityQuery.data?.pubkey, inFlightStage, welcomeAgents],
  );
  const providerReadiness = React.useMemo(
    () => resolveAgentReadiness(acpRuntimesQuery.data ?? [], globalConfig),
    [acpRuntimesQuery.data, globalConfig],
  );

  React.useEffect(() => {
    void channelId;
    dispatchingStageRef.current = null;
    providerNoticeInFlightRef.current = false;
    setInFlightStage(null);
  }, [channelId]);

  React.useEffect(() => {
    if (inFlightStage && snapshot?.observedStages.has(inFlightStage)) {
      setInFlightStage(null);
    }
  }, [inFlightStage, snapshot]);

  React.useEffect(() => {
    if (
      !channelId ||
      !relayUrl ||
      !isActiveWelcome ||
      !welcomeAgents ||
      !snapshot ||
      configLoading ||
      acpRuntimesQuery.isPending ||
      runtimePairsQuery.isPending
    ) {
      return;
    }
    if (
      snapshot.ownerHasSpoken ||
      inFlightStage !== null ||
      dispatchingStageRef.current !== null
    )
      return;

    let cancelled = false;
    const cacheKey = `${normalizeRelayUrl(relayUrl)}:${channelId}`;

    if (!providerReadiness.ready) {
      if (snapshot.observedStages.size > 0 || providerNoticeInFlightRef.current)
        return;
      providerNoticeInFlightRef.current = true;
      void loadKickoffContext(cacheKey)
        .then((context) => {
          if (cancelled) return;
          const fallback = buildWelcomeProviderFallback(context.locale);
          return sendManagedAgentChannelMessage({
            agentPubkey: welcomeAgents[fallback.targetRole].pubkey,
            channelId,
            content: fallback.message,
            marker: fallback.marker,
            markerScope: "channel",
          });
        })
        .catch((error) => {
          console.warn("Failed to publish the Welcome provider notice.", error);
        })
        .finally(() => {
          providerNoticeInFlightRef.current = false;
        });
      return () => {
        cancelled = true;
      };
    }

    const [stage] = nextKickoffStages(snapshot.observedStages);
    if (!stage) return;
    const targetRole = welcomeKickoffTargetRole(stage);
    const targetAgent = welcomeAgents[targetRole];
    if (
      !welcomeRuntimeIsReady(
        runtimePairsQuery.data ?? [],
        targetAgent.pubkey,
        relayUrl,
      )
    ) {
      return;
    }

    dispatchingStageRef.current = stage;
    void loadKickoffContext(cacheKey)
      .then((context) => {
        if (cancelled) return;
        const task = buildKickoffTask(stage, context.locale, {
          channelId,
          ownerName: context.ownerName,
          organization: context.organization,
        });
        setInFlightStage(stage);
        return dispatchAirhopAgentTask({
          channelId,
          agentPubkey: targetAgent.pubkey,
          taskId: task.taskId,
          stage: task.stage,
          instruction: task.instruction,
        });
      })
      .catch((error) => {
        dispatchingStageRef.current = null;
        if (activeChannelIdRef.current === channelId) {
          setInFlightStage((current) => (current === stage ? null : current));
          console.warn("Failed to dispatch the Welcome kickoff stage.", error);
        }
      });

    return () => {
      cancelled = true;
      if (inFlightStage === null) {
        dispatchingStageRef.current = null;
      }
    };
  }, [
    acpRuntimesQuery.isPending,
    channelId,
    configLoading,
    inFlightStage,
    isActiveWelcome,
    providerReadiness,
    relayUrl,
    runtimePairsQuery.data,
    runtimePairsQuery.isPending,
    snapshot,
    welcomeAgents,
  ]);

  return snapshot;
}
