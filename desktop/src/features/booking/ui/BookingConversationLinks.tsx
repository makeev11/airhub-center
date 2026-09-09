import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  ClientInboxService,
  type ClientConversation,
} from "@/features/client-inbox/data/clientInboxService";
import { Button } from "@/shared/ui/button";

/** Load only on request, using the booking's exact family and representative. */
export function BookingConversationLinks({
  familyId,
  representativeId,
}: {
  familyId: string;
  representativeId: string;
}) {
  const [service] = React.useState(() => new ClientInboxService());
  const [items, setItems] = React.useState<ClientConversation[] | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState(false);
  const load = async () => {
    setPending(true);
    setError(false);
    try {
      const data = await service.load({ familyId, representativeId });
      setItems(data.items);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items === null && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void load()}
        >
          {pending
            ? "Ищем переписку…"
            : error
              ? "Повторить поиск переписки"
              : "Переписка с клиентом"}
        </Button>
      )}
      {items?.map((item) => (
        <Button asChild key={item.id} size="sm" variant="outline">
          <Link
            to="/channels/$channelId"
            params={{ channelId: item.channelId }}
            search={item.rootEventId ? { thread: item.rootEventId } : {}}
          >
            Открыть чат · {item.connectionName}
          </Link>
        </Button>
      ))}
      {items?.length === 0 && (
        <span className="text-xs text-muted-foreground">
          Нет подключённой переписки, доступной вам
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          Не удалось проверить переписку
        </span>
      )}
    </div>
  );
}
