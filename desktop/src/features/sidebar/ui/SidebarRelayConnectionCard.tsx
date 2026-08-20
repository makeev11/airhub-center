import { Check, CloudOff } from "lucide-react";
import { useAirHopLocale } from "@/features/activation/useAirHopLocale";

import {
  SidebarCompactActionCard,
  type SidebarActionCardSurface,
} from "@/shared/ui/sidebar-action-card";
import { Spinner } from "@/shared/ui/spinner";

type SidebarRelayConnectionCardProps = {
  isActionDisabled?: boolean;
  actionTestId?: string;
  className?: string;
  isConnected?: boolean;
  isReconnectPending: boolean;
  isWaitingOnReconnectHook?: boolean;
  onDismiss?: () => void;
  onReconnect: () => void;
  surface?: SidebarActionCardSurface;
  testId?: string;
};

export function SidebarRelayConnectionCard({
  actionTestId,
  className,
  isActionDisabled = false,
  isConnected = false,
  isReconnectPending,
  isWaitingOnReconnectHook = false,
  onDismiss,
  onReconnect,
  surface,
}: SidebarRelayConnectionCardProps) {
  return (
    <SidebarRelayConnectionCompactCard
      actionTestId={actionTestId ?? "sidebar-reconnect"}
      className={className}
      isActionDisabled={isActionDisabled}
      isConnected={isConnected}
      isReconnectPending={isReconnectPending}
      isWaitingOnReconnectHook={isWaitingOnReconnectHook}
      onDismiss={onDismiss}
      onReconnect={onReconnect}
      surface={surface}
      testId="sidebar-relay-unreachable"
    />
  );
}

export function SidebarRelayConnectionCompactCard({
  actionTestId,
  className,
  isActionDisabled = false,
  isConnected = false,
  isReconnectPending,
  isWaitingOnReconnectHook = false,
  onDismiss,
  onReconnect,
  surface,
  testId = "sidebar-relay-unreachable-compact",
}: SidebarRelayConnectionCardProps) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const copy = isRussian
    ? {
        waiting: "Ожидаем подключение",
        connecting: "Подключаемся",
        helper:
          "Завершите действия в открывшемся окне помощника, чтобы продолжить.",
        reconnecting: "Восстанавливаем соединение",
        connected: "Подключено",
        connect: "Подключиться к серверу",
        click: "Нажмите, чтобы подключиться",
        dismiss: "Закрыть уведомление о подключении",
        unreachable: "Нет связи с сервером",
      }
    : {
        waiting: "Waiting to reconnect",
        connecting: "Connecting",
        helper:
          "Complete any prompts opened by the reconnect helper to continue.",
        reconnecting: "Reconnecting",
        connected: "Connected",
        connect: "Connect to relay",
        click: "Click to connect",
        dismiss: "Dismiss relay notification",
        unreachable: "Can't reach the relay",
      };
  const reconnectTitle = isWaitingOnReconnectHook
    ? copy.waiting
    : copy.connecting;
  const reconnectDescription = isWaitingOnReconnectHook
    ? copy.helper
    : copy.reconnecting;

  return (
    <SidebarCompactActionCard
      actionAriaLabel={isConnected ? copy.connected : copy.connect}
      actionDisabled={isActionDisabled || isReconnectPending || isConnected}
      actionTestId={actionTestId}
      description={
        isConnected
          ? undefined
          : isReconnectPending
            ? reconnectDescription
            : copy.click
      }
      dismissLabel={copy.dismiss}
      iconKey={
        isConnected ? "connected" : isReconnectPending ? "pending" : "idle"
      }
      icon={
        isConnected ? (
          <Check aria-hidden="true" className="h-5 w-5" />
        ) : isReconnectPending ? (
          <Spinner aria-hidden="true" className="h-5 w-5 border-2" />
        ) : (
          <CloudOff aria-hidden="true" className="h-5 w-5" />
        )
      }
      className={className}
      onAction={onReconnect}
      onDismiss={onDismiss}
      role={isConnected ? "status" : "alert"}
      surface={surface}
      testId={testId}
      title={
        isConnected
          ? copy.connected
          : isReconnectPending
            ? reconnectTitle
            : copy.unreachable
      }
      tone={isConnected ? "success" : "neutral"}
    />
  );
}
