import * as React from "react";
import { Button } from "@/shared/ui/button";
import type {
  ClientConversation,
  ClientInboxService,
} from "../data/clientInboxService";

/** Preview is read-only; only an explicit second action requests an atomic cutover. */
export function ClientMigration({
  item,
  communityId,
  service,
  onSaved,
  ru,
}: {
  item: ClientConversation;
  communityId: string;
  service: ClientInboxService;
  onSaved: () => Promise<void>;
  ru: boolean;
}) {
  const [preview, setPreview] = React.useState<Awaited<
    ReturnType<ClientInboxService["migrationPreview"]>
  > | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inspect = async () => {
    setPending(true);
    setError(null);
    try {
      setPreview(await service.migrationPreview(item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const apply = async () => {
    if (!preview || pending) return;
    setPending(true);
    setError(null);
    try {
      await service.command(
        communityId,
        { id: item.id, version: preview.version },
        { type: "migrate_legacy", expectedRouteVersion: preview.routeVersion },
      );
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setPending(false);
    }
  };
  const blocked =
    !preview?.targetChannelId ||
    preview.targetChannelId === item.channelId ||
    preview.threaded ||
    preview.pendingDeliveries > 0 ||
    preview.unpublishedReplies > 0 ||
    preview.liveTurns > 0;
  return (
    <div className="mt-2 text-sm">
      {!preview && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void inspect()}
        >
          {ru
            ? "Проверить перенос старого разговора"
            : "Preview legacy migration"}
        </Button>
      )}
      {preview && (
        <div className="mt-2 max-w-2xl space-y-2 rounded-md border p-3">
          <p>
            {ru
              ? "Будет создана новая ветка в настроенном канале подключения. Старая подписанная история останется в архиве со ссылкой из новой ветки. Семья, записи и разговор сохранятся. Это не перенос отдельных сообщений."
              : "A new thread will be created in the connection’s configured channel. Original signed history remains linked in its archived channel. Family, bookings and conversation identity are preserved; individual messages are not moved."}
          </p>
          <p className="text-xs text-muted-foreground">
            {ru ? "Канал назначения" : "Destination channel"}:{" "}
            {preview.targetChannelId ?? (ru ? "не настроен" : "not configured")}
          </p>
          {blocked && (
            <p role="status">
              {ru
                ? "Сначала настройте канал и завершите активную работу. Ожидают доставки / публикации / ходы Гермеса:"
                : "Configure the destination and drain active work first. Pending deliveries / publications / Hermes turns:"}{" "}
              {preview.pendingDeliveries} / {preview.unpublishedReplies} /{" "}
              {preview.liveTurns}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending || blocked}
              onClick={() => void apply()}
            >
              {ru
                ? "Перенести и сохранить архив"
                : "Migrate and preserve archive"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setPreview(null)}
            >
              {ru ? "Отмена" : "Cancel"}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
