import {
  buildInstanceInputForDefinition,
  resolveStartRuntimeForDefinition,
} from "@/features/agents/lib/instanceInputForDefinition";
import {
  addChannelMembers,
  createManagedAgent,
  deleteManagedAgent,
  discoverAcpRuntimes,
  getChannelMembers,
  listManagedAgents,
  updateManagedAgent,
} from "@/shared/api/tauri";
import { getGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import { startManagedAgentRuntimesForRelay } from "@/shared/api/tauriManagedAgents";
import { listPersonas, setPersonaActive } from "@/shared/api/tauriPersonas";
import type {
  AcpRuntime,
  AgentPersona,
  CreateManagedAgentInput,
  ManagedAgent,
  UpdateManagedAgentInput,
} from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { registerWelcomeTeam } from "./welcomeTeamRegistration";
import {
  type AirhopWelcomeRole,
  welcomeRoleDefinition,
} from "./welcomeTeamLocale";

export const WELCOME_GUIDE_AGENT_NAME = "Fizz";
export const WELCOME_GUIDE_PERSONA_ID = "builtin:fizz";
export const WELCOME_TEAM_ID = "builtin-team:welcome";
export const WELCOME_GUIDE_INTRO_MARKER = "buzz-welcome-intro.v1";
const LEGACY_WELCOME_GUIDE_AGENT_NAME = "Kit";
const LEGACY_GENERIC_PERSONA_IDS = new Set([
  "builtin:fizz",
  "builtin:honey",
  "builtin:bumble",
]);
export const LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT =
  "You are Kit, Sprout's friendly welcome guide. Help new users understand the community, channels, messages, and agents. Keep introductions concise, practical, and warm.";
export const WELCOME_GUIDE_INTRO_MESSAGE =
  "Hi, I'm Fizz. Welcome to Airhop.\n\nI can help you get oriented, answer questions, and make the first few steps feel less mysterious.\n\nFeel free to ask me what else you can do in Airhop, or just talk through what you want to build.";

export type WelcomeTeamRole = AirhopWelcomeRole;

export type WelcomeTeamStarterDefinition = Readonly<{
  name: string;
  personaId: string;
  role: WelcomeTeamRole;
}>;

export const WELCOME_TEAM_STARTERS = [
  { name: "Fizz", personaId: "builtin:airhop-fizz", role: "fizz" },
  {
    name: "Administrator",
    personaId: "builtin:airhop-administrator",
    role: "administrator",
  },
  { name: "Analyst", personaId: "builtin:airhop-analyst", role: "analyst" },
  {
    name: "Content Marketer",
    personaId: "builtin:airhop-content-marketer",
    role: "content_marketer",
  },
] as const satisfies readonly WelcomeTeamStarterDefinition[];

export type WelcomeTeamAgents = Readonly<
  Record<AirhopWelcomeRole, ManagedAgent>
>;

type WelcomeOrganization = Readonly<{ id: string; locale: string }>;

const welcomeTeamPromises = new Map<string, Promise<WelcomeTeamAgents>>();

function normalizeRelayUrl(relayUrl: string | null | undefined) {
  return relayUrl?.trim().replace(/\/+$/, "") ?? null;
}

function isAgentScopedToRelay(agent: ManagedAgent, relayUrl?: string | null) {
  const targetRelayUrl = normalizeRelayUrl(relayUrl);
  if (!targetRelayUrl) return true;
  return normalizeRelayUrl(agent.relayUrl) === targetRelayUrl;
}

function isBuiltInWelcomeGuideAgent(agent: ManagedAgent) {
  return (
    agent.personaId === WELCOME_GUIDE_PERSONA_ID ||
    agent.personaId === "builtin:airhop-fizz"
  );
}

function isLegacyKitWelcomeGuideAgent(agent: ManagedAgent) {
  return (
    agent.name.trim().toLowerCase() ===
      LEGACY_WELCOME_GUIDE_AGENT_NAME.toLowerCase() &&
    agent.systemPrompt?.trim() === LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT
  );
}

function isWelcomeGuideAgent(agent: ManagedAgent) {
  return (
    isBuiltInWelcomeGuideAgent(agent) || isLegacyKitWelcomeGuideAgent(agent)
  );
}

function pickAgentByStatus(agents: ManagedAgent[]) {
  return (
    agents.find((agent) => agent.status === "running") ??
    agents.find((agent) => agent.status === "deployed") ??
    agents[0] ??
    null
  );
}

export function pickWelcomeGuideAgent(agents: ManagedAgent[]) {
  return pickAgentByStatus(agents.filter(isWelcomeGuideAgent));
}

export function pickWelcomeGuideAgentForRelay(
  agents: ManagedAgent[],
  relayUrl?: string | null,
) {
  return pickAgentByStatus(
    agents.filter(
      (agent) =>
        isWelcomeGuideAgent(agent) && isAgentScopedToRelay(agent, relayUrl),
    ),
  );
}

export function pickWelcomeTeamStarterAgentForRelay(
  agents: ManagedAgent[],
  starter: WelcomeTeamStarterDefinition,
  relayUrl?: string | null,
) {
  return pickAgentByStatus(
    agents.filter(
      (agent) =>
        agent.teamId === WELCOME_TEAM_ID &&
        agent.personaId === starter.personaId &&
        isAgentScopedToRelay(agent, relayUrl),
    ),
  );
}

export async function getWelcomeTeamAgentPubkeys(relayUrl?: string | null) {
  const personaIds = new Set<string>(
    WELCOME_TEAM_STARTERS.map(({ personaId }) => personaId),
  );
  return (await listManagedAgents())
    .filter(
      (agent) =>
        agent.teamId === WELCOME_TEAM_ID &&
        agent.personaId !== null &&
        personaIds.has(agent.personaId) &&
        isAgentScopedToRelay(agent, relayUrl),
    )
    .map((agent) => agent.pubkey);
}

export async function getWelcomeGuideAgentPubkeys(relayUrl?: string | null) {
  return (await listManagedAgents())
    .filter(
      (agent) =>
        isWelcomeGuideAgent(agent) && isAgentScopedToRelay(agent, relayUrl),
    )
    .map((agent) => agent.pubkey);
}

export async function activateWelcomeTeamPersonasSequentially(
  inactivePersonaIds: readonly string[],
  activate: (personaId: string) => Promise<unknown>,
) {
  for (const personaId of inactivePersonaIds) await activate(personaId);
}

async function ensureWelcomeTeamPersonasActive() {
  const personas = await listPersonas();
  const personasById = new Map(
    personas.map((persona) => [persona.id, persona]),
  );
  for (const starter of WELCOME_TEAM_STARTERS) {
    if (!personasById.has(starter.personaId)) {
      throw new Error(`${starter.name} agent not found.`);
    }
  }
  await activateWelcomeTeamPersonasSequentially(
    WELCOME_TEAM_STARTERS.filter(
      ({ personaId }) => !personasById.get(personaId)?.isActive,
    ).map(({ personaId }) => personaId),
    (personaId) => setPersonaActive(personaId, true),
  );
}

async function ensureWelcomeTeamMembership(
  channelId: string,
  agents: WelcomeTeamAgents,
) {
  const members = await getChannelMembers(channelId).catch(() => []);
  const memberPubkeys = new Set(
    members.map((member) => normalizePubkey(member.pubkey)),
  );
  const missingAgents = Object.values(agents).filter(
    (agent) => !memberPubkeys.has(normalizePubkey(agent.pubkey)),
  );
  if (missingAgents.length === 0) return;

  const result = await addChannelMembers({
    channelId,
    pubkeys: missingAgents.map((agent) => agent.pubkey),
    role: "bot",
  });
  const unexpectedError = result.errors.find(
    ({ error }) => !error.toLowerCase().includes("already"),
  );
  if (unexpectedError) throw new Error(unexpectedError.error);
}

export async function buildWelcomeStarterCreateInput(
  starter: WelcomeTeamStarterDefinition,
  persona: AgentPersona,
  runtimes: readonly AcpRuntime[],
  preferredRuntimeId: string | null,
  channelId: string,
  relayUrl?: string | null,
): Promise<CreateManagedAgentInput> {
  const { runtime } = resolveStartRuntimeForDefinition(
    persona,
    runtimes,
    preferredRuntimeId,
  );
  const base = await buildInstanceInputForDefinition(persona, runtime);
  return {
    ...base,
    name: starter.name,
    teamId: WELCOME_TEAM_ID,
    relayUrl: relayUrl ?? undefined,
    mcpCommand: "airhop-agent-mcp",
    envVars: {
      ...(base.envVars ?? {}),
      BUZZ_AIRHOP_ROLE: starter.role,
      BUZZ_AIRHOP_WELCOME_CHANNEL_ID: channelId,
      BUZZ_ACP_KINDS: "9,46010,40007,21021",
      BUZZ_ACP_FLAT_CHANNELS: channelId,
      BUZZ_ACP_ROUTE_GATE: "airhop",
    },
    spawnAfterCreate: false,
    startOnAppLaunch: false,
    respondTo: "owner-only",
    respondToAllowlist: [],
  };
}

function sameArray(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
) {
  const leftEntries = Object.entries(left).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const rightEntries = Object.entries(right).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

export function welcomeStarterRuntimeUpdate(
  existing: ManagedAgent,
  desired: CreateManagedAgentInput,
): UpdateManagedAgentInput | null {
  if (!desired.agentCommand) return null;
  const update: UpdateManagedAgentInput = { pubkey: existing.pubkey };
  const desiredArgs = desired.agentArgs ?? [];
  const desiredModel = desired.model ?? null;
  const desiredProvider = desired.provider ?? null;
  const desiredMcpCommand = desired.mcpCommand ?? "";

  if (existing.name !== desired.name) update.name = desired.name;
  const runtimeChanged =
    existing.agentCommand !== desired.agentCommand ||
    !sameArray(existing.agentArgs, desiredArgs) ||
    existing.model !== desiredModel ||
    existing.provider !== desiredProvider ||
    existing.mcpCommand !== desiredMcpCommand;
  if (runtimeChanged) {
    update.agentCommand = desired.agentCommand;
    update.harnessOverride = true;
    update.agentArgs = desiredArgs;
    update.mcpCommand = desiredMcpCommand;
    update.model = desiredModel;
    update.provider = desiredProvider;
  }
  if (
    desired.envVars !== undefined &&
    !sameRecord(existing.envVars, desired.envVars)
  ) {
    update.envVars = desired.envVars;
  }
  if (
    desired.respondTo !== undefined &&
    existing.respondTo !== desired.respondTo
  ) {
    update.respondTo = desired.respondTo;
  }
  if (
    desired.respondToAllowlist !== undefined &&
    !sameArray(existing.respondToAllowlist, desired.respondToAllowlist)
  ) {
    update.respondToAllowlist = desired.respondToAllowlist;
  }
  if (
    desired.relayUrl !== undefined &&
    normalizeRelayUrl(existing.relayUrl) !== normalizeRelayUrl(desired.relayUrl)
  ) {
    update.relayUrl = desired.relayUrl;
  }
  return Object.keys(update).length === 1 ? null : update;
}

function isLegacyGenericWelcomeAgent(
  agent: ManagedAgent,
  relayUrl?: string | null,
) {
  return (
    agent.teamId === WELCOME_TEAM_ID &&
    agent.personaId !== null &&
    LEGACY_GENERIC_PERSONA_IDS.has(agent.personaId) &&
    isAgentScopedToRelay(agent, relayUrl)
  );
}

async function provisionWelcomeTeam(
  channelId: string,
  organization: WelcomeOrganization,
  ownerPubkey: string,
  relayUrl?: string | null,
): Promise<WelcomeTeamAgents> {
  if (!/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
    throw new Error("Welcome Team provisioning requires a valid owner pubkey.");
  }
  const existingAgents = await listManagedAgents();
  await ensureWelcomeTeamPersonasActive();
  const [personas, runtimeCatalog, globalConfig] = await Promise.all([
    listPersonas(),
    discoverAcpRuntimes(),
    getGlobalAgentConfig(),
  ]);
  const personasById = new Map(
    personas.map((persona) => [persona.id, persona]),
  );
  const runtimes = runtimeCatalog.filter(
    (runtime): runtime is AcpRuntime => runtime.availability === "available",
  );
  const mutableAgents = {} as Record<AirhopWelcomeRole, ManagedAgent>;

  for (const baseStarter of WELCOME_TEAM_STARTERS) {
    const localized = welcomeRoleDefinition(
      baseStarter.role,
      organization.locale,
    );
    const starter: WelcomeTeamStarterDefinition = {
      role: localized.role,
      personaId: localized.personaId,
      name: localized.name,
    };
    const persona = personasById.get(starter.personaId);
    if (!persona) throw new Error(`${starter.name} agent not found.`);

    const desired = await buildWelcomeStarterCreateInput(
      starter,
      persona,
      runtimes,
      globalConfig.preferred_runtime,
      channelId,
      relayUrl,
    );
    const existing = pickWelcomeTeamStarterAgentForRelay(
      existingAgents,
      starter,
      relayUrl,
    );
    if (existing) {
      const update = welcomeStarterRuntimeUpdate(existing, desired);
      mutableAgents[starter.role] = update
        ? (await updateManagedAgent(update)).agent
        : existing;
    } else {
      mutableAgents[starter.role] = (await createManagedAgent(desired)).agent;
    }
  }

  const agents: WelcomeTeamAgents = mutableAgents;
  await ensureWelcomeTeamMembership(channelId, agents);
  await registerWelcomeTeam({
    organizationId: organization.id,
    channelId,
    locale: organization.locale,
    members: {
      fizz: agents.fizz.pubkey,
      administrator: agents.administrator.pubkey,
      analyst: agents.analyst.pubkey,
      content_marketer: agents.content_marketer.pubkey,
    },
  });

  const legacyAgents = existingAgents.filter((agent) =>
    isLegacyGenericWelcomeAgent(agent, relayUrl),
  );
  await Promise.all(
    legacyAgents.map((agent) => deleteManagedAgent(agent.pubkey)),
  );

  const runtimeRelayUrl =
    normalizeRelayUrl(relayUrl) ?? normalizeRelayUrl(agents.fizz.relayUrl);
  if (!runtimeRelayUrl) {
    throw new Error("Welcome Team provisioning requires a relay URL.");
  }
  await startManagedAgentRuntimesForRelay(
    Object.values(agents),
    runtimeRelayUrl,
  );
  return agents;
}

export function ensureWelcomeTeam(
  channelId: string,
  organization: WelcomeOrganization,
  ownerPubkey: string,
  relayUrl?: string | null,
): Promise<WelcomeTeamAgents> {
  const key = [
    normalizeRelayUrl(relayUrl) ?? "",
    channelId,
    organization.id,
    organization.locale,
    normalizePubkey(ownerPubkey),
  ].join(":");
  const current = welcomeTeamPromises.get(key);
  if (current) return current;

  const promise = provisionWelcomeTeam(
    channelId,
    organization,
    ownerPubkey,
    relayUrl,
  ).finally(() => welcomeTeamPromises.delete(key));
  welcomeTeamPromises.set(key, promise);
  return promise;
}
