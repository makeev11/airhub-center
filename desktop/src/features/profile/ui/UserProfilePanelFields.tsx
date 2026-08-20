import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  Copy,
  Cpu,
  Ear,
  Fingerprint,
  Server,
  Terminal,
  UserRound,
} from "lucide-react";
import * as React from "react";
import { AgentStatusBadge } from "@/features/agents/ui/AgentStatusBadge";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { PubKey } from "@/shared/ui/PubKey";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import type {
  AgentPersona,
  ManagedAgent,
  Profile,
  RelayAgent,
} from "@/shared/api/types";

const RUNTIME_LABELS: Record<string, string> = {
  goose: "Goose",
  "claude-code": "Claude Code",
  "codex-acp": "Codex",
  aider: "Aider",
};

function runtimeLabel(command: string): string {
  return RUNTIME_LABELS[command] ?? command;
}

export type ProfileField = {
  copyValue?: string;
  displayValue: string;
  displayNode?: React.ReactNode;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  testId?: string;
  trailingNode?: React.ReactNode;
};

const AGENT_INFO_LABELS = new Set([
  "Public key",
  "Публичный ключ",
  "Managed by",
  "Ответственный",
  "NIP-05",
  "Agent type",
  "Тип агента",
  "Capabilities",
  "Возможности",
  "Backend",
  "Бэкенд",
]);
const AGENT_SETTINGS_LABELS = new Set([
  "Runtime",
  "Среда запуска",
  "Agent profile",
  "Профиль агента",
  "Who can send instructions",
  "Кто может ставить задачи",
  "ACP command",
  "MCP command",
  "Start on launch",
  "Запускать вместе с приложением",
]);
const DIAGNOSTICS_LABELS = new Set([
  "Status",
  "Статус",
  "Last error",
  "Последняя ошибка",
]);

export function bucketProfileFields(fields: ProfileField[]) {
  return {
    agentInfoFields: fields.filter((field) =>
      AGENT_INFO_LABELS.has(field.label),
    ),
    agentSettingsFields: fields.filter((field) =>
      AGENT_SETTINGS_LABELS.has(field.label),
    ),
    diagnosticsFields: fields.filter((field) =>
      DIAGNOSTICS_LABELS.has(field.label),
    ),
  };
}

export function useProfileFieldBuckets({
  isBot,
  isOwner,
  managedAgent,
  onOpenProfile,
  ownerAvatarUrl,
  ownerDisplayName,
  ownerHandle,
  ownerProfilePubkey,
  ownerPubkey,
  persona,
  presenceLoaded,
  presenceStatus,
  profile,
  pubkey,
  relayAgent,
}: {
  isBot: boolean;
  isOwner: boolean | undefined;
  managedAgent: ManagedAgent | undefined;
  onOpenProfile?: (pubkey: string) => void;
  ownerAvatarUrl: string | null;
  ownerDisplayName: string | null;
  ownerHandle: string | null;
  ownerProfilePubkey: string | null;
  ownerPubkey: string | null;
  persona: AgentPersona | undefined;
  presenceLoaded: boolean;
  presenceStatus: "online" | "away" | "offline" | undefined;
  profile: Profile | undefined;
  pubkey: string | null;
  relayAgent: RelayAgent | undefined;
}) {
  const isRussian = useAirHopLocale() === "ru-RU";
  return React.useMemo(() => {
    const metadataFields = [
      ...buildPublicFields({
        pubkey,
        profile,
        relayAgent,
        isBot,
        persona,
        isRussian,
      }),
      ...(ownerDisplayName || isOwner === true
        ? buildOwnerFields({
            includeOperationalFields: isOwner === true,
            managedAgent,
            onOpenProfile,
            ownerAvatarUrl,
            ownerDisplayName,
            ownerHandle,
            ownerProfilePubkey,
            ownerPubkey,
            persona,
            presenceLoaded,
            presenceStatus,
            relayAgent,
            isRussian,
          })
        : []),
    ];
    return bucketProfileFields(metadataFields);
  }, [
    isBot,
    isRussian,
    isOwner,
    managedAgent,
    onOpenProfile,
    ownerAvatarUrl,
    ownerDisplayName,
    ownerHandle,
    ownerProfilePubkey,
    ownerPubkey,
    persona,
    presenceLoaded,
    presenceStatus,
    profile,
    pubkey,
    relayAgent,
  ]);
}

export function buildPublicFields({
  isBot,
  persona,
  profile,
  pubkey,
  relayAgent,
  isRussian = false,
}: {
  isBot: boolean;
  persona?: AgentPersona;
  profile: Profile | undefined;
  pubkey: string | null;
  relayAgent: RelayAgent | undefined;
  isRussian?: boolean;
}): ProfileField[] {
  const fields: ProfileField[] = [];

  if (pubkey) {
    fields.push({
      displayValue: truncatePubkey(pubkey),
      displayNode: <PubKey pubkey={pubkey} testId="user-profile-copy-pubkey" />,
      icon: Fingerprint,
      label: isRussian ? "Публичный ключ" : "Public key",
    });
  }

  if (profile?.nip05Handle) {
    fields.push({
      copyValue: profile.nip05Handle,
      displayValue: profile.nip05Handle,
      icon: UserRound,
      label: "NIP-05",
      testId: "user-profile-nip05",
    });
  }

  if (isBot && relayAgent?.agentType) {
    fields.push({
      copyValue: relayAgent.agentType,
      displayValue: runtimeLabel(relayAgent.agentType),
      icon: Cpu,
      label: isRussian ? "Тип агента" : "Agent type",
      testId: "user-profile-agent-type",
    });
  }

  if (!pubkey && persona) {
    fields.push({
      displayValue: isRussian ? "Не запущен" : "Not deployed",
      icon: Activity,
      label: isRussian ? "Статус" : "Status",
      testId: "user-profile-agent-status",
    });
  }

  if (relayAgent?.capabilities.length) {
    fields.push({
      copyValue: relayAgent.capabilities.join(", "),
      displayValue: relayAgent.capabilities.join(", "),
      icon: Server,
      label: isRussian ? "Возможности" : "Capabilities",
      testId: "user-profile-capabilities",
    });
  }

  return fields;
}

export function buildOwnerFields({
  includeOperationalFields,
  managedAgent,
  onOpenProfile,
  ownerAvatarUrl,
  ownerDisplayName,
  ownerHandle,
  ownerProfilePubkey,
  ownerPubkey,
  persona,
  presenceLoaded,
  presenceStatus,
  relayAgent,
  isRussian = false,
}: {
  includeOperationalFields: boolean;
  managedAgent: ManagedAgent | undefined;
  onOpenProfile?: (pubkey: string) => void;
  ownerAvatarUrl: string | null;
  ownerDisplayName: string | null;
  ownerHandle: string | null;
  ownerProfilePubkey: string | null;
  ownerPubkey: string | null;
  persona?: AgentPersona;
  presenceLoaded: boolean;
  presenceStatus: "online" | "away" | "offline" | undefined;
  relayAgent: RelayAgent | undefined;
  isRussian?: boolean;
}): ProfileField[] {
  const fields: ProfileField[] = [];
  const respondTo = managedAgent?.respondTo ?? relayAgent?.respondTo ?? null;
  const respondToDisplayValue = respondTo
    ? respondTo === "owner-only"
      ? ownerDisplayName
        ? isRussian
          ? `Только ${ownerDisplayName} (владелец)`
          : `Only ${ownerDisplayName} (owner)`
        : isRussian
          ? "Только владелец"
          : "Only the owner"
      : respondTo === "allowlist"
        ? isRussian
          ? "Выбранные сотрудники"
          : "Selected people"
        : isRussian
          ? "Любой сотрудник"
          : "Anyone"
    : null;

  const ownerClickable = Boolean(onOpenProfile && ownerProfilePubkey);
  const ownerContent = (
    <>
      <UserAvatar
        avatarUrl={ownerAvatarUrl}
        className="shrink-0"
        displayName={ownerHandle ?? ownerDisplayName ?? ""}
        size="xs"
        testId="user-profile-owner-avatar"
      />
      <span className="truncate">{ownerDisplayName}</span>
    </>
  );

  if (ownerDisplayName) {
    fields.push({
      copyValue: ownerClickable
        ? undefined
        : (ownerProfilePubkey ?? ownerPubkey ?? ownerHandle ?? undefined),
      displayValue: ownerDisplayName,
      displayNode: (
        <span className="inline-flex max-w-full items-center gap-2">
          {ownerContent}
        </span>
      ),
      icon: UserRound,
      label: isRussian ? "Ответственный" : "Managed by",
      onClick:
        ownerClickable && ownerProfilePubkey
          ? () => onOpenProfile?.(ownerProfilePubkey)
          : undefined,
      testId: "user-profile-managed-by",
    });
  }

  if (!includeOperationalFields) {
    return fields;
  }

  if (managedAgent?.agentCommand) {
    fields.push({
      copyValue: managedAgent.agentCommand,
      displayValue: runtimeLabel(managedAgent.agentCommand),
      icon: Terminal,
      label: isRussian ? "Среда запуска" : "Runtime",
      testId: "user-profile-runtime",
    });
  } else if (relayAgent?.agentType) {
    fields.push({
      copyValue: relayAgent.agentType,
      displayValue: runtimeLabel(relayAgent.agentType),
      icon: Terminal,
      label: isRussian ? "Среда запуска" : "Runtime",
      testId: "user-profile-runtime",
    });
  } else if (persona?.runtime) {
    fields.push({
      copyValue: persona.runtime,
      displayValue: runtimeLabel(persona.runtime),
      icon: Terminal,
      label: isRussian ? "Среда запуска" : "Runtime",
      testId: "user-profile-runtime",
    });
  } else if (ownerPubkey) {
    fields.push({
      copyValue: ownerPubkey,
      displayValue: isRussian
        ? "Владелец агента подтверждён"
        : "Declared owner verified",
      icon: UserRound,
      label: isRussian ? "Профиль агента" : "Agent profile",
      testId: "user-profile-agent-profile",
    });
  }

  if (managedAgent) {
    fields.push({
      displayValue: managedAgent.status
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char: string) => char.toUpperCase()),
      displayNode: (
        <AgentStatusBadge
          presenceLoaded={presenceLoaded}
          presenceStatus={presenceStatus}
          status={managedAgent.status}
        />
      ),
      icon: Activity,
      label: isRussian ? "Статус" : "Status",
      testId: "user-profile-agent-status",
    });
  }

  if (managedAgent?.acpCommand) {
    fields.push({
      copyValue: managedAgent.acpCommand,
      displayValue: managedAgent.acpCommand,
      icon: Terminal,
      label: "ACP command",
      testId: "user-profile-acp",
    });
  }

  if (managedAgent?.mcpCommand) {
    fields.push({
      copyValue: managedAgent.mcpCommand,
      displayValue: managedAgent.mcpCommand,
      icon: Terminal,
      label: "MCP command",
      testId: "user-profile-mcp",
    });
  }

  if (managedAgent?.backend.type === "provider") {
    const backendLabel = managedAgent.backend.id;
    fields.push({
      copyValue: backendLabel,
      displayValue: backendLabel,
      icon: Server,
      label: isRussian ? "Бэкенд" : "Backend",
      testId: "user-profile-backend",
    });
  }

  if (managedAgent) {
    fields.push({
      displayValue: managedAgent.startOnAppLaunch
        ? isRussian
          ? "Да"
          : "Yes"
        : isRussian
          ? "Нет"
          : "No",
      icon: Server,
      label: isRussian ? "Запускать вместе с приложением" : "Start on launch",
      testId: "user-profile-start-on-launch",
    });
  }

  if (respondToDisplayValue) {
    fields.push({
      displayValue: respondToDisplayValue,
      icon: Ear,
      label: isRussian
        ? "Кто может ставить задачи"
        : "Who can send instructions",
      testId: "user-profile-respond-to",
    });
  }

  if (managedAgent?.lastError) {
    fields.push({
      copyValue: managedAgent.lastError,
      displayValue: managedAgent.lastError,
      icon: Activity,
      label: isRussian ? "Последняя ошибка" : "Last error",
      testId: "user-profile-last-error",
    });
  }

  return fields;
}

function orderProfileFields(fields: ProfileField[]) {
  const visibilityLabels = new Set(["Visibility", "Видимость"]);
  const publicKeyLabels = new Set(["Public key", "Публичный ключ"]);
  const managedByLabels = new Set(["Managed by", "Ответственный"]);
  const statusLabels = new Set(["Status", "Статус"]);
  return [
    ...fields.filter((field) => visibilityLabels.has(field.label)),
    ...fields.filter((field) => publicKeyLabels.has(field.label)),
    ...fields.filter((field) => managedByLabels.has(field.label)),
    ...fields.filter(
      (field) =>
        !visibilityLabels.has(field.label) &&
        !publicKeyLabels.has(field.label) &&
        !managedByLabels.has(field.label) &&
        field.copyValue,
    ),
    ...fields.filter((field) => statusLabels.has(field.label)),
    ...fields.filter((field) => {
      if (
        visibilityLabels.has(field.label) ||
        publicKeyLabels.has(field.label) ||
        managedByLabels.has(field.label) ||
        statusLabels.has(field.label)
      ) {
        return false;
      }
      return !field.copyValue;
    }),
  ];
}

export function ProfileFieldRows({ fields }: { fields: ProfileField[] }) {
  return (
    <>
      {orderProfileFields(fields).map((field) => (
        <ProfileFieldRow field={field} key={field.testId ?? field.label} />
      ))}
    </>
  );
}

export function ProfileFieldGroup({ fields }: { fields: ProfileField[] }) {
  return (
    <section>
      <div className="overflow-hidden rounded-2xl bg-muted/20">
        <ProfileFieldRows fields={fields} />
      </div>
    </section>
  );
}

function ProfileFieldRow({ field }: { field: ProfileField }) {
  const Icon = field.icon;
  const isCopyable = Boolean(field.copyValue);
  const isActionable = Boolean(field.onClick);

  const content = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/60">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-xs font-medium text-foreground">
          {field.label}
        </span>
        <span
          className="mt-0.5 block truncate text-sm text-muted-foreground"
          title={field.displayValue}
        >
          {field.displayNode ?? field.displayValue}
        </span>
      </span>
      {field.trailingNode}
      {isActionable ? (
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : isCopyable ? (
        <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );

  if (isActionable) {
    return (
      <button
        aria-label={`Open ${field.label}`}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        data-testid={field.testId}
        onClick={field.onClick}
        title={`Open ${field.label}`}
        type="button"
      >
        {content}
      </button>
    );
  }

  if (isCopyable && field.copyValue) {
    return (
      <button
        aria-label={`Copy ${field.label}`}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        data-testid={field.testId}
        onClick={() =>
          copyTextToClipboard(field.copyValue ?? "", `Copied ${field.label}`)
        }
        title={`Copy ${field.label}`}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      data-testid={field.testId}
    >
      {content}
    </div>
  );
}
