import { ConnectionRoutingFields } from "./ConnectionRoutingFields";
import type { ConnectionRouting } from "../data/airhopControlPlane";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  KeyRound,
  LoaderCircle,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Send,
  Wifi,
  WifiOff,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  type AirhopChannelConnection,
  AirhopControlPlaneError,
  createAirhopControlPlaneClient,
} from "@/features/airhop-agents/data/airhopControlPlane";
import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { truncatePubkey } from "@/shared/lib/pubkey";
import type { AirHopLocale } from "@/shared/locale/airhopLocale";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";

import { WhatsAppOwnMetaSetupDialog } from "./WhatsAppOwnMetaSetupDialog";
import { WhatsAppCredentialRotationDialog } from "./WhatsAppCredentialRotationDialog";

export const airhopConnectionsQueryKey = [
  "airhop",
  "channel-connections",
] as const;

type Copy = {
  title: string;
  description: string;
  addTelegram: string;
  addWhatsApp: string;
  emptyTitle: string;
  emptyDescription: string;
  previewDescription: string;
  loading: string;
  loadError: string;
  retry: string;
  hermes: string;
  hermesHint: string;
  pause: string;
  resume: string;
  savingError: string;
  heartbeat: string;
  never: string;
  connector: string;
  addTitle: string;
  addDescription: string;
  botFather: string;
  token: string;
  tokenPlaceholder: string;
  tokenHint: string;
  unavailable: string;
  cancel: string;
  connect: string;
  connecting: string;
  invalidToken: string;
  connected: string;
  rotateAccess: string;
  status: Record<AirhopChannelConnection["observedStatus"], string>;
};

const COPY: Record<AirHopLocale, Copy> = {
  "ru-RU": {
    title: "Каналы связи",
    description:
      "Подключения Telegram и WhatsApp, через которые центр общается с родителями.",
    addTelegram: "Добавить Telegram",
    addWhatsApp: "Добавить WhatsApp",
    emptyTitle: "Каналы пока не подключены",
    emptyDescription:
      "Добавьте Telegram-бота или официальный WhatsApp Cloud API. Здесь появится фактическое состояние адаптера.",
    previewDescription:
      "Подключения доступны в установленном Airhop Center. В режиме просмотра секреты и серверные настройки не открываются.",
    loading: "Проверяем подключения…",
    loadError: "Не удалось загрузить каналы связи.",
    retry: "Повторить",
    hermes: "Гермес отвечает в этом канале",
    hermesHint:
      "Он использует базу знаний и Booking Core в пределах разрешений центра.",
    pause: "Приостановить",
    resume: "Возобновить",
    savingError: "Не удалось сохранить подключение.",
    heartbeat: "Последняя проверка",
    never: "ещё не было",
    connector: "Идентификатор адаптера",
    addTitle: "Подключить Telegram",
    addDescription:
      "Скопируйте токен у BotFather и вставьте его сюда. Airhop проверит бота и сохранит токен в зашифрованном хранилище.",
    botFather: "Открыть BotFather",
    token: "Токен Telegram-бота",
    tokenPlaceholder: "123456789:AA…",
    tokenHint:
      "Токен передаётся только при подключении, не показывается повторно и не попадает в историю сообщений или логи.",
    unavailable:
      "Безопасное подключение Telegram ещё не настроено на этом сервере.",
    cancel: "Отмена",
    connect: "Подключить",
    connecting: "Подключаем…",
    invalidToken: "Проверьте токен, полученный у BotFather.",
    connected: "Telegram-бот подключён.",
    rotateAccess: "Обновить доступ",
    status: {
      offline: "Не в сети",
      connecting: "Подключается",
      ready: "Работает",
      degraded: "Нужна проверка",
    },
  },
  "en-US": {
    title: "Communication channels",
    description: "Telegram and WhatsApp connections used to talk with parents.",
    addTelegram: "Add Telegram",
    addWhatsApp: "Add WhatsApp",
    emptyTitle: "No channels connected yet",
    emptyDescription:
      "Add a Telegram bot or official WhatsApp Cloud API. The adapter's live status will appear here.",
    previewDescription:
      "Connections are available in the installed Airhop Center. Secrets and server settings stay unavailable in preview mode.",
    loading: "Checking connections…",
    loadError: "Communication channels could not be loaded.",
    retry: "Try again",
    hermes: "Hermes answers in this channel",
    hermesHint:
      "It uses the knowledge base and Booking Core within the center's permissions.",
    pause: "Pause",
    resume: "Resume",
    savingError: "The connection could not be saved.",
    heartbeat: "Last check",
    never: "not yet",
    connector: "Adapter identity",
    addTitle: "Connect Telegram",
    addDescription:
      "Copy the token from BotFather and paste it here. Airhop will verify the bot and store the token in encrypted storage.",
    botFather: "Open BotFather",
    token: "Telegram bot token",
    tokenPlaceholder: "123456789:AA…",
    tokenHint:
      "The token is sent only while connecting, is never shown again, and does not enter message history or logs.",
    unavailable:
      "Secure Telegram provisioning is not configured on this server yet.",
    cancel: "Cancel",
    connect: "Connect",
    connecting: "Connecting…",
    invalidToken: "Check the token issued by BotFather.",
    connected: "Telegram bot connected.",
    rotateAccess: "Update access",
    status: {
      offline: "Offline",
      connecting: "Connecting",
      ready: "Working",
      degraded: "Needs attention",
    },
  },
  "pt-BR": {
    title: "Canais de comunicação",
    description:
      "Conexões do Telegram e WhatsApp usadas para falar com responsáveis.",
    addTelegram: "Adicionar Telegram",
    addWhatsApp: "Adicionar WhatsApp",
    emptyTitle: "Nenhum canal conectado",
    emptyDescription:
      "Adicione um bot do Telegram ou a API oficial do WhatsApp Cloud. O estado real do adaptador aparecerá aqui.",
    previewDescription:
      "As conexões estão disponíveis no Airhop Center instalado. Segredos e configurações do servidor não aparecem no modo de visualização.",
    loading: "Verificando conexões…",
    loadError: "Não foi possível carregar os canais.",
    retry: "Tentar novamente",
    hermes: "Hermes responde neste canal",
    hermesHint:
      "Ele usa a base de conhecimento e o Booking Core dentro das permissões do centro.",
    pause: "Pausar",
    resume: "Retomar",
    savingError: "Não foi possível salvar a conexão.",
    heartbeat: "Última verificação",
    never: "ainda não ocorreu",
    connector: "Identidade do adaptador",
    addTitle: "Conectar Telegram",
    addDescription:
      "Copie o token no BotFather e cole aqui. O Airhop verificará o bot e armazenará o token de forma criptografada.",
    botFather: "Abrir BotFather",
    token: "Token do bot do Telegram",
    tokenPlaceholder: "123456789:AA…",
    tokenHint:
      "O token é enviado somente durante a conexão, não volta a ser exibido e não entra no histórico ou nos logs.",
    unavailable:
      "A conexão segura do Telegram ainda não está configurada neste servidor.",
    cancel: "Cancelar",
    connect: "Conectar",
    connecting: "Conectando…",
    invalidToken: "Verifique o token fornecido pelo BotFather.",
    connected: "Bot do Telegram conectado.",
    rotateAccess: "Atualizar acesso",
    status: {
      offline: "Offline",
      connecting: "Conectando",
      ready: "Funcionando",
      degraded: "Precisa de atenção",
    },
  },
  "tr-TR": {
    title: "İletişim kanalları",
    description:
      "Velilerle iletişim için kullanılan Telegram ve WhatsApp bağlantıları.",
    addTelegram: "Telegram ekle",
    addWhatsApp: "WhatsApp ekle",
    emptyTitle: "Henüz kanal bağlı değil",
    emptyDescription:
      "Bir Telegram botu veya resmi WhatsApp Cloud API ekleyin. Adaptörün canlı durumu burada görünür.",
    previewDescription:
      "Bağlantılar kurulu Airhop Center uygulamasında kullanılabilir. Önizleme modunda sırlar ve sunucu ayarları açılmaz.",
    loading: "Bağlantılar kontrol ediliyor…",
    loadError: "İletişim kanalları yüklenemedi.",
    retry: "Tekrar dene",
    hermes: "Hermes bu kanalda yanıt verir",
    hermesHint:
      "Bilgi tabanını ve Booking Core'u merkezin izinleri dahilinde kullanır.",
    pause: "Duraklat",
    resume: "Devam ettir",
    savingError: "Bağlantı kaydedilemedi.",
    heartbeat: "Son kontrol",
    never: "henüz yok",
    connector: "Adaptör kimliği",
    addTitle: "Telegram bağla",
    addDescription:
      "BotFather'dan tokenı kopyalayıp buraya yapıştırın. Airhop botu doğrular ve tokenı şifreli olarak saklar.",
    botFather: "BotFather'ı aç",
    token: "Telegram bot tokenı",
    tokenPlaceholder: "123456789:AA…",
    tokenHint:
      "Token yalnızca bağlantı sırasında gönderilir, tekrar gösterilmez ve mesaj geçmişine veya günlüklere girmez.",
    unavailable:
      "Bu sunucuda güvenli Telegram bağlantısı henüz yapılandırılmamış.",
    cancel: "İptal",
    connect: "Bağla",
    connecting: "Bağlanıyor…",
    invalidToken: "BotFather tarafından verilen tokenı kontrol edin.",
    connected: "Telegram botu bağlandı.",
    rotateAccess: "Erişimi güncelle",
    status: {
      offline: "Çevrimdışı",
      connecting: "Bağlanıyor",
      ready: "Çalışıyor",
      degraded: "Kontrol gerekiyor",
    },
  },
};

function statusVariant(status: AirhopChannelConnection["observedStatus"]) {
  if (status === "ready") return "success" as const;
  if (status === "degraded") return "warning" as const;
  return "secondary" as const;
}

function ConnectionCard({
  canManage,
  connection,
  copy,
  locale,
  onUpdate,
  onRotate,
  pending,
}: {
  canManage: boolean;
  connection: AirhopChannelConnection;
  copy: Copy;
  locale: AirHopLocale;
  onUpdate: (
    connection: AirhopChannelConnection,
    patch: Partial<
      Pick<AirhopChannelConnection, "hermesEnabled" | "status">
    > & { routing?: ConnectionRouting },
  ) => void;
  onRotate?: () => void;
  pending: boolean;
}) {
  const [routing, setRouting] = React.useState<ConnectionRouting>({
    buzzChannelId: connection.buzzChannelId,
    branchId: connection.branchId,
  });
  React.useEffect(() => {
    setRouting({
      buzzChannelId: connection.buzzChannelId,
      branchId: connection.branchId,
    });
  }, [connection.buzzChannelId, connection.branchId]);
  const StatusIcon = connection.observedStatus === "ready" ? Wifi : WifiOff;
  const isPaused = connection.status === "paused";
  const lastHeartbeat = connection.lastHeartbeatAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(connection.lastHeartbeatAt))
    : copy.never;

  return (
    <Card data-testid={`airhop-channel-${connection.id}`}>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
            {connection.provider === "telegram" ? (
              <Send className="size-5" />
            ) : (
              <MessageCircle className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate text-lg">
              {connection.displayName}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {connection.provider === "telegram" ? "Telegram" : "WhatsApp"}
            </p>
          </div>
        </div>
        <Badge variant={statusVariant(connection.observedStatus)}>
          <StatusIcon className="mr-1 size-3" />
          {copy.status[connection.observedStatus]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {connection.lastErrorCode ? (
          <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>{connection.lastErrorCode}</span>
          </div>
        ) : null}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{copy.heartbeat}</dt>
            <dd className="mt-1 font-medium">{lastHeartbeat}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{copy.connector}</dt>
            <dd
              className="mt-1 font-mono text-xs"
              title={connection.connectorPubkey}
            >
              {truncatePubkey(connection.connectorPubkey)}
            </dd>
          </div>
        </dl>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 p-4">
          <div>
            <p className="text-sm font-medium">{copy.hermes}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {copy.hermesHint}
            </p>
          </div>
          <Switch
            aria-label={copy.hermes}
            checked={connection.hermesEnabled}
            disabled={!canManage || pending || connection.status === "disabled"}
            onCheckedChange={(hermesEnabled) =>
              onUpdate(connection, { hermesEnabled })
            }
          />
        </div>
        <ConnectionRoutingFields
          disabled={!canManage || pending}
          locale={locale}
          onChange={setRouting}
          value={routing}
        />
        {canManage && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {locale.startsWith("ru")
                ? "Изменение канала действует для новых клиентов. Существующие треды остаются на месте; перенос старой истории выполняется отдельно."
                : "A new channel applies to new clients. Existing threads stay in place; legacy migration is a separate operation."}
            </p>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => onUpdate(connection, { routing })}
            >
              {locale.startsWith("ru")
                ? "Сохранить маршрутизацию"
                : "Save routing"}
            </Button>
          </div>
        )}
        {canManage ? (
          <div className="flex justify-end gap-2">
            {connection.provider === "whatsapp_cloud" && onRotate ? (
              <Button
                disabled={pending || connection.status === "disabled"}
                onClick={onRotate}
                size="sm"
                type="button"
                variant="outline"
              >
                <KeyRound />
                {copy.rotateAccess}
              </Button>
            ) : null}
            <Button
              disabled={pending || connection.status === "disabled"}
              onClick={() =>
                onUpdate(connection, {
                  status: isPaused ? "active" : "paused",
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : isPaused ? (
                <Play />
              ) : (
                <Pause />
              )}
              {isPaused ? copy.resume : copy.pause}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AddTelegramDialog({
  copy,
  onAdd,
  onOpenChange,
  open,
  pending,
}: {
  copy: Copy;
  onAdd: (token: string, routing: ConnectionRouting) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending: boolean;
}) {
  const [token, setToken] = React.useState("");
  const locale = useAirHopLocale();
  const [routing, setRouting] = React.useState<ConnectionRouting>({
    buzzChannelId: null,
    branchId: null,
  });
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    if (!open) {
      setToken("");
      setRouting({ buzzChannelId: null, branchId: null });
      setError(undefined);
    }
  }, [open]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedToken = token.trim();
    if (!/^\d{5,20}:[A-Za-z0-9_-]{20,220}$/.test(normalizedToken)) {
      setError(copy.invalidToken);
      return;
    }
    setError(undefined);
    onAdd(normalizedToken, routing);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid="airhop-add-telegram-dialog">
        <DialogHeader>
          <DialogTitle>{copy.addTitle}</DialogTitle>
          <DialogDescription>{copy.addDescription}</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <ConnectionRoutingFields
            disabled={pending}
            locale={locale}
            onChange={setRouting}
            value={routing}
          />
          <a
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            href="https://t.me/BotFather"
            rel="noreferrer"
            target="_blank"
          >
            <Send className="size-4" />
            {copy.botFather}
          </a>
          <label
            className="grid gap-2 text-sm font-medium"
            htmlFor="airhop-telegram-token"
          >
            {copy.token}
            <Input
              autoFocus
              autoCapitalize="none"
              autoComplete="off"
              disabled={pending}
              id="airhop-telegram-token"
              maxLength={256}
              onChange={(event) => setToken(event.target.value)}
              placeholder={copy.tokenPlaceholder}
              spellCheck={false}
              type="password"
              value={token}
            />
            <span className="text-xs font-normal leading-5 text-muted-foreground">
              {copy.tokenHint}
            </span>
            {error ? (
              <span className="text-xs font-normal text-destructive">
                {error}
              </span>
            ) : null}
          </label>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {copy.cancel}
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <KeyRound />
              )}
              {pending ? copy.connecting : copy.connect}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CommunicationChannelsSettings({
  serverEnabled,
}: {
  serverEnabled: boolean;
}) {
  const locale = useAirHopLocale();
  const copy = COPY[locale];
  const [client] = React.useState(() => createAirhopControlPlaneClient());
  const [telegramDialogOpen, setTelegramDialogOpen] = React.useState(false);
  const [whatsAppDialogOpen, setWhatsAppDialogOpen] = React.useState(false);
  const [whatsAppRotationConnection, setWhatsAppRotationConnection] =
    React.useState<AirhopChannelConnection | null>(null);
  const [pendingIds, setPendingIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const queryClient = useQueryClient();
  const membership = useMyRelayMembershipLookupQuery();
  const role = membership.data?.membership?.role ?? null;
  const canManage = role === "owner" || role === "admin";
  const connections = useQuery({
    enabled: serverEnabled,
    queryKey: airhopConnectionsQueryKey,
    queryFn: () => client.getConnectionsOverview(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const saveConnection = useMutation({
    mutationFn: client.putConnection.bind(client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channels"] });
      await queryClient.invalidateQueries({
        queryKey: airhopConnectionsQueryKey,
      });
    },
  });
  const { mutateAsync: save } = saveConnection;
  const connectTelegram = useMutation({
    mutationFn: ({
      token,
      routing,
    }: {
      token: string;
      routing: ConnectionRouting;
    }) => client.connectTelegram(token, routing),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channels"] });
      await queryClient.invalidateQueries({
        queryKey: airhopConnectionsQueryKey,
      });
    },
  });
  const { isPending: isConnecting, mutateAsync: connect } = connectTelegram;

  const updateConnection = React.useCallback(
    async (
      connection: AirhopChannelConnection,
      patch: Partial<
        Pick<AirhopChannelConnection, "hermesEnabled" | "status">
      > & { routing?: ConnectionRouting },
    ) => {
      setPendingIds((current) => new Set(current).add(connection.id));
      try {
        await save({
          id: connection.id,
          provider: connection.provider,
          displayName: connection.displayName,
          connectorPubkey: connection.connectorPubkey,
          status: patch.status ?? connection.status,
          hermesEnabled: patch.hermesEnabled ?? connection.hermesEnabled,
          capabilities: connection.capabilities,
          expectedVersion: connection.version,
          routing: patch.routing,
        });
      } catch {
        toast.error(copy.savingError);
      } finally {
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(connection.id);
          return next;
        });
      }
    },
    [copy.savingError, save],
  );

  const addConnection = React.useCallback(
    async (token: string, routing: ConnectionRouting) => {
      try {
        await connect({ token, routing });
        setTelegramDialogOpen(false);
        toast.success(copy.connected);
      } catch (error) {
        toast.error(
          error instanceof AirhopControlPlaneError && error.status === 400
            ? copy.invalidToken
            : error instanceof AirhopControlPlaneError && error.status === 503
              ? copy.unavailable
              : copy.savingError,
        );
      }
    },
    [
      connect,
      copy.connected,
      copy.invalidToken,
      copy.savingError,
      copy.unavailable,
    ],
  );

  const addWhatsAppConnection = React.useCallback(
    async (input: Parameters<typeof client.connectWhatsAppCloud>[0]) => {
      const result = await client.connectWhatsAppCloud(input);
      await queryClient.invalidateQueries({ queryKey: ["channels"] });
      await queryClient.invalidateQueries({
        queryKey: airhopConnectionsQueryKey,
      });
      return result;
    },
    [client, queryClient],
  );

  const activateWhatsAppConnection = React.useCallback(
    async (connectionId: string) => {
      await client.activateWhatsAppCloud(connectionId);
      await queryClient.invalidateQueries({
        queryKey: airhopConnectionsQueryKey,
      });
    },
    [client, queryClient],
  );

  const rotateWhatsAppCredential = React.useCallback(
    async (
      input: Parameters<typeof client.rotateWhatsAppCloudCredential>[0],
    ) => {
      const result = await client.rotateWhatsAppCloudCredential(input);
      await queryClient.invalidateQueries({
        queryKey: airhopConnectionsQueryKey,
      });
      return result;
    },
    [client, queryClient],
  );

  if (!serverEnabled) {
    return (
      <>
        <Card data-testid="airhop-channels-preview">
          <CardContent className="py-10 text-center">
            <Send className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">{copy.title}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {copy.previewDescription}
            </p>
            <Button
              className="mt-4"
              onClick={() => setWhatsAppDialogOpen(true)}
              type="button"
            >
              <MessageCircle />
              {copy.addWhatsApp}
            </Button>
          </CardContent>
        </Card>
        <WhatsAppOwnMetaSetupDialog
          available={false}
          onActivate={activateWhatsAppConnection}
          onConnect={addWhatsAppConnection}
          onOpenChange={setWhatsAppDialogOpen}
          open={whatsAppDialogOpen}
        />
      </>
    );
  }

  return (
    <section className="space-y-5" data-testid="airhop-communication-channels">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!connections.data?.provisioning.telegram.available}
              onClick={() => setTelegramDialogOpen(true)}
              type="button"
              variant="outline"
            >
              <Plus />
              {copy.addTelegram}
            </Button>
            <Button onClick={() => setWhatsAppDialogOpen(true)} type="button">
              <MessageCircle />
              {copy.addWhatsApp}
            </Button>
          </div>
        ) : null}
      </div>

      {canManage &&
      connections.data &&
      !connections.data.provisioning.telegram.available ? (
        <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>{copy.unavailable}</span>
        </div>
      ) : null}

      {connections.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {copy.loading}
        </div>
      ) : connections.isError ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm">{copy.loadError}</p>
            <Button
              className="mt-4"
              onClick={() => void connections.refetch()}
              size="sm"
              type="button"
              variant="outline"
            >
              {copy.retry}
            </Button>
          </CardContent>
        </Card>
      ) : connections.data?.connections.length ? (
        <div className="grid gap-4">
          {connections.data.connections.map((connection) => (
            <ConnectionCard
              canManage={canManage}
              connection={connection}
              copy={copy}
              key={connection.id}
              locale={locale}
              onUpdate={(current, patch) =>
                void updateConnection(current, patch)
              }
              onRotate={
                connection.provider === "whatsapp_cloud"
                  ? () => setWhatsAppRotationConnection(connection)
                  : undefined
              }
              pending={pendingIds.has(connection.id)}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center">
            <Send className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">{copy.emptyTitle}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {copy.emptyDescription}
            </p>
          </CardContent>
        </Card>
      )}

      <AddTelegramDialog
        copy={copy}
        onAdd={(token, routing) => void addConnection(token, routing)}
        onOpenChange={setTelegramDialogOpen}
        open={telegramDialogOpen}
        pending={isConnecting}
      />
      <WhatsAppOwnMetaSetupDialog
        available={
          connections.data?.provisioning.whatsappCloud.available ?? false
        }
        onActivate={activateWhatsAppConnection}
        onConnect={addWhatsAppConnection}
        onOpenChange={setWhatsAppDialogOpen}
        open={whatsAppDialogOpen}
      />
      <WhatsAppCredentialRotationDialog
        connection={whatsAppRotationConnection}
        onOpenChange={(open) => {
          if (!open) setWhatsAppRotationConnection(null);
        }}
        onRotate={rotateWhatsAppCredential}
        open={whatsAppRotationConnection !== null}
      />
    </section>
  );
}
