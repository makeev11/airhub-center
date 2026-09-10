import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getChannelMessagesBefore } from "@/shared/api/tauriChannels";
import { loadWelcomeHistory } from "./welcomeHistory";
import { createAirhopControlPlaneClient } from "@/features/airhop-agents/data/airhopControlPlane";

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

// Legacy invitation receipts remain readable, but new onboarding does not
// interleave a second Fizz message before each specialist's introduction.
const WELCOME_KICKOFF_SEQUENCE: readonly WelcomeKickoffStage[] = [
  "fizz_intro",
  "administrator_intro",
  "analyst_intro",
  "content_marketer_intro",
  "fizz_first_question",
];

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
  pendingOwnerQuestion?: boolean;
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
  const next = WELCOME_KICKOFF_SEQUENCE.find((stage) => !observed.has(stage));
  return next ? [next] : [];
}

/** Accept the guest receipt only from the server-registered Hermes identity. */
export function hasWelcomeGuestIntroduction(
  events: readonly RelayEvent[],
  guestPubkey: string | null | undefined,
): boolean {
  if (!guestPubkey) return false;
  return events.some(
    (event) =>
      event.kind === 9 &&
      normalizePubkey(event.pubkey) === normalizePubkey(guestPubkey) &&
      event.tags.some(
        (tag) =>
          tag[0] === "airhop-kickoff-stage" && tag[1] === "hermes_guest_intro",
      ) &&
      event.tags.some(
        (tag) =>
          tag[0] === "airhop-guest-invitation" &&
          /^[0-9a-f]{64}$/i.test(tag[1] ?? ""),
      ) &&
      !event.tags.some((tag) => tag[0] === "e"),
  );
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

  const answered = new Set(
    events
      .filter(
        (event) =>
          OWNER_MESSAGE_KINDS.has(event.kind) &&
          agentPubkeys.has(normalizePubkey(event.pubkey)) &&
          !event.tags.some((tag) => tag[0] === KICKOFF_STAGE_TAG),
      )
      .flatMap((event) =>
        event.tags
          .filter((tag) => tag[0] === "airhop-responds-to")
          .map((tag) => tag[1]),
      ),
  );
  const pendingOwnerQuestion = events.some(
    (event) =>
      OWNER_MESSAGE_KINDS.has(event.kind) &&
      normalizePubkey(event.pubkey) === normalizedOwner &&
      event.content.trim().length > 0 &&
      !answered.has(event.id),
  );
  return {
    observedStages,
    ownerHasSpoken,
    pendingOwnerQuestion,
    inFlightStage,
  };
}

export function shouldDispatchKickoff(
  snapshot: WelcomeKickoffSnapshot & {
    targetRuntimeReady?: boolean;
    providerReady?: boolean;
    historyReady?: boolean;
  },
) {
  return (
    snapshot.inFlightStage === null &&
    !snapshot.pendingOwnerQuestion &&
    (snapshot.historyReady ?? true) &&
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
      "Send exactly one short message for this stage, then finish the task. Do not perform other kickoff stages.",
      stage === "fizz_first_question"
        ? [
            "Before asking, use airhop_read to read fresh organization_settings, schedule, knowledge and channel_connections. The organization name above is not a setup inventory.",
            "Briefly acknowledge the data that already exists. Select the first missing setup topic in this order: branches, teachers, groups/schedule, tariffs, knowledge, Telegram connection.",
            "Ask exactly one concrete question about that topic, offering to skip it. Do not ask vague priorities such as what matters most. Do not ask the owner to re-enter existing data.",
            "Include that question in the same message as the short inventory and set expects_reply=true. An inventory without a question is not a completed first setup stage.",
            "A failed or unavailable read means unknown, not empty: explain the limitation without inventing missing data. Do not claim a Telegram connection is configured unless verified.",
            "Verify Telegram with channel_connections: distinguish configured status from observed health and heartbeat freshness. A configured Hermes agent or a tracking link is not evidence that Telegram is connected or healthy.",
            "Collect details in conversation; delegate setup changes to the Administrator for a preview and explicit confirmation. Never claim data is saved before a successful confirmed action.",
            "If all checked topics are populated, briefly summarize and offer one practical test of the connected Telegram bot instead of asking for a new organizational brief.",
          ].join("\n")
        : "Do not ask the owner a question yet; the final stage handles that. Set expects_reply=false.",
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
  historyReady: boolean,
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
  const guestDeployment = useQuery({
    queryKey: ["airhop-welcome-guest", relayUrl, channelId],
    queryFn: () =>
      createAirhopControlPlaneClient().getCurrentHermesDeployment(),
    enabled: isActiveWelcome && !!relayUrl,
    staleTime: 30_000,
    refetchInterval: 10_000,
  });
  const durableHistory = useQuery({
    queryKey: ["airhop-welcome-history", relayUrl, channelId],
    queryFn: ({ signal }) => {
      if (!channelId) throw new Error("Welcome channel is unavailable.");
      return loadWelcomeHistory(channelId, getChannelMessagesBefore, signal);
    },
    enabled: isActiveWelcome && !!channelId && !!relayUrl,
    staleTime: 0,
    // Live delivery is an optimization, not a durable kickoff receipt. In
    // particular, the isolated guest publishes outside the desktop process.
    // Reconcile until setup starts so a missed update cannot strand Welcome.
    refetchInterval: (query) =>
      query.state.data?.some(
        (event) =>
          event.kind === 9 &&
          event.pubkey === welcomeAgents?.fizz.pubkey &&
          event.tags.some(
            (tag) =>
              tag[0] === KICKOFF_STAGE_TAG && tag[1] === "fizz_first_question",
          ),
      )
        ? false
        : 10_000,
  });
  const completeEvents = React.useMemo(() => {
    const combined = new Map(
      (durableHistory.data ?? []).map((event) => [event.id, event]),
    );
    for (const event of channelEvents) combined.set(event.id, event);
    return [...combined.values()];
  }, [durableHistory.data, channelEvents]);
  const completeHistoryReady =
    historyReady && durableHistory.isSuccess && !durableHistory.isFetching;
  const snapshot = React.useMemo(
    () =>
      welcomeAgents
        ? buildWelcomeKickoffSnapshot(
            completeEvents,
            identityQuery.data?.pubkey,
            welcomeAgents,
            inFlightStage,
          )
        : null,
    [completeEvents, identityQuery.data?.pubkey, inFlightStage, welcomeAgents],
  );
  const providerReadiness = React.useMemo(
    () => resolveAgentReadiness(acpRuntimesQuery.data ?? [], globalConfig),
    [acpRuntimesQuery.data, globalConfig],
  );
  const latestSnapshotRef = React.useRef(snapshot);
  latestSnapshotRef.current = snapshot;
  const historyReadyRef = React.useRef(historyReady);
  historyReadyRef.current = completeHistoryReady;
  const guestReadyRef = React.useRef(false);
  guestReadyRef.current = hasWelcomeGuestIntroduction(
    completeEvents,
    guestDeployment.data?.agentPubkey,
  );

  React.useEffect(() => {
    activeChannelIdRef.current = channelId;
    dispatchingStageRef.current = null;
    providerNoticeInFlightRef.current = false;
    setInFlightStage(null);
    return () => {
      activeChannelIdRef.current = null;
    };
  }, [channelId]);

  React.useEffect(() => {
    if (inFlightStage && snapshot?.observedStages.has(inFlightStage)) {
      dispatchingStageRef.current = null;
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
      !completeHistoryReady ||
      configLoading ||
      acpRuntimesQuery.isPending ||
      runtimePairsQuery.isPending
    ) {
      return;
    }
    const dispatchedStage = dispatchingStageRef.current;
    if (dispatchedStage && snapshot.observedStages.has(dispatchedStage)) {
      dispatchingStageRef.current = null;
    }
    const hasUnobservedInFlightStage =
      inFlightStage !== null && !snapshot.observedStages.has(inFlightStage);
    if (hasUnobservedInFlightStage || dispatchingStageRef.current !== null)
      return;
    if (snapshot.pendingOwnerQuestion) return;

    const cacheKey = `${normalizeRelayUrl(relayUrl)}:${channelId}`;

    if (!providerReadiness.ready) {
      if (snapshot.observedStages.size > 0 || providerNoticeInFlightRef.current)
        return;
      providerNoticeInFlightRef.current = true;
      void loadKickoffContext(cacheKey)
        .then((context) => {
          if (activeChannelIdRef.current !== channelId) return;
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
      return;
    }

    const [stage] = nextKickoffStages(snapshot.observedStages);
    if (!stage) return;
    if (
      stage === "fizz_first_question" &&
      !hasWelcomeGuestIntroduction(
        completeEvents,
        guestDeployment.data?.agentPubkey,
      )
    )
      return;
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
    setInFlightStage(stage);
    void loadKickoffContext(cacheKey)
      .then(async (context) => {
        // Nostr timestamps have one-second precision. Leave a full second
        // after the preceding receipt so replay cannot reorder introductions
        // by their random event IDs (including the guest before setup).
        if (stage !== "fizz_intro") {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, stage === "fizz_first_question" ? 2100 : 1100),
          );
        }
        if (activeChannelIdRef.current !== channelId) return;
        // Context loading can finish after history hydration or a live receipt.
        // Never publish the stale stage chosen before that update.
        if (
          !historyReadyRef.current ||
          (stage === "fizz_first_question" && !guestReadyRef.current) ||
          latestSnapshotRef.current?.pendingOwnerQuestion ||
          latestSnapshotRef.current?.observedStages.has(stage)
        ) {
          dispatchingStageRef.current = null;
          setInFlightStage(null);
          return;
        }
        const task = buildKickoffTask(stage, context.locale, {
          channelId,
          ownerName: context.ownerName,
          organization: context.organization,
        });
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
  }, [
    acpRuntimesQuery.isPending,
    channelId,
    configLoading,
    completeHistoryReady,
    completeEvents,
    guestDeployment.data?.agentPubkey,
    inFlightStage,
    isActiveWelcome,
    providerReadiness,
    relayUrl,
    runtimePairsQuery.data,
    runtimePairsQuery.isPending,
    snapshot,
    welcomeAgents,
  ]);

  const awaitingGuest =
    isActiveWelcome &&
    completeHistoryReady &&
    snapshot?.observedStages.has("content_marketer_intro") &&
    !snapshot.observedStages.has("fizz_first_question") &&
    !snapshot.pendingOwnerQuestion &&
    !guestReadyRef.current;
  const guestStatus:
    | "loading"
    | "error"
    | "missing"
    | "paused"
    | "waiting"
    | null = !awaitingGuest
    ? null
    : guestDeployment.isError
      ? "error"
      : guestDeployment.isPending
        ? "loading"
        : !guestDeployment.data
          ? "missing"
          : !guestDeployment.data.enabled || guestDeployment.data.paused
            ? "paused"
            : "waiting";

  return {
    snapshot,
    guestStatus,
    guestPubkey: isActiveWelcome
      ? (guestDeployment.data?.agentPubkey ?? null)
      : null,
    retryGuest: guestDeployment.refetch,
  };
}
