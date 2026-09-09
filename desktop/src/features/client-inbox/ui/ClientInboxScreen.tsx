import * as React from "react";
import { ClientRoutingSettings } from "./ClientRoutingSettings";
import { ClientMigration } from "./ClientMigration";
import { Link } from "@tanstack/react-router";
import { MessageCircle, RefreshCw, Search } from "lucide-react";
import { useAirHopLocale } from "@/features/activation/useAirHopLocale";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";
import {
  ClientInboxService,
  type ClientInbox,
  type ClientConversation,
  type ClientAction,
} from "../data/clientInboxService";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm";

export function ClientInboxScreen() {
  const ru = useAirHopLocale().startsWith("ru");
  const t = (a: string, b: string) => (ru ? a : b);
  const [service] = React.useState(() => new ClientInboxService());
  const [data, setData] = React.useState<ClientInbox | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [branch, setBranch] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [mine, setMine] = React.useState(false);
  const [assignee, setAssignee] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [connection, setConnection] = React.useState("");
  const [deferredSearch, setDeferredSearch] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setDeferredSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const request = React.useRef(0);
  const filters = React.useMemo(
    () => ({
      branchId: branch === "unknown" ? "" : branch,
      unassignedBranch: branch === "unknown" ? "true" : "",
      status,
      mine: mine ? "true" : "",
      assignee: mine ? "" : assignee,
      search: deferredSearch,
      connectionId: connection,
    }),
    [branch, status, mine, assignee, deferredSearch, connection],
  );
  const load = React.useCallback(
    async (cursor?: ClientInbox["nextCursor"]) => {
      const generation = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const next = await service.load({ ...filters, ...(cursor ?? {}) });
        if (generation !== request.current) return;
        setData((previous) =>
          cursor && previous
            ? {
                ...next,
                items: [
                  ...previous.items,
                  ...next.items.filter(
                    (item) => !previous.items.some((old) => old.id === item.id),
                  ),
                ],
              }
            : next,
        );
      } catch (e) {
        if (generation === request.current)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (generation === request.current) setLoading(false);
      }
    },
    [service, filters],
  );
  React.useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  // Keep the operational queue current without fetching entire message histories.
  React.useEffect(() => {
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !pending &&
        (data?.items.length ?? 0) <= 100
      )
        void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load, pending, data?.items.length]);
  const act = async (item: ClientConversation, action: ClientAction) => {
    if (!data || pending) return;
    setPending(item.id);
    setError(null);
    try {
      await service.command(data.communityId, item, action);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };
  const statusName = (value: string) =>
    value === "waiting_staff"
      ? t("Ждёт сотрудника", "Waiting for staff")
      : value === "waiting_parent"
        ? t("Ждёт клиента", "Waiting for client")
        : t("Завершено", "Resolved");
  const connections = data?.connections ?? [];
  const staffOptions = [
    ...new Map(
      (data?.staff ?? []).map((staff) => [staff.pubkey, staff]),
    ).values(),
  ];
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="airhop-client-inbox"
    >
      <PageHeader title={t("Обращения клиентов", "Client Inbox")} />
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t(
            "Все сообщения клиента, Гермеса и команды — в одном треде. Филиал определяет ответственность, а доступ к переписке — участники канала.",
            "Client, Hermes and staff messages stay in one thread. Branches determine responsibility; channel membership determines access.",
          )}
        </p>
        {data?.canManageRouting && (
          <ClientRoutingSettings
            data={data}
            service={service}
            onSaved={load}
            ru={ru}
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="client-inbox-search"
            className="relative flex min-w-56 flex-1 items-center"
          >
            <Search className="absolute left-3 size-4 text-muted-foreground" />
            <Input
              id="client-inbox-search"
              aria-label={t("Поиск клиента", "Search clients")}
              className="pl-9"
              placeholder={t("Имя клиента или семьи", "Client or family name")}
              maxLength={160}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            aria-label={t("Филиал", "Branch")}
            className={selectClass}
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          >
            <option value="">{t("Все филиалы", "All branches")}</option>
            <option value="unknown">
              {t("Филиал не определён", "Branch not selected")}
            </option>
            {data?.branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Статус", "Status")}
            className={selectClass}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t("Все статусы", "All statuses")}</option>
            {["waiting_staff", "waiting_parent", "resolved"].map((value) => (
              <option key={value} value={value}>
                {statusName(value)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Подключение", "Connection")}
            className={selectClass}
            value={connection}
            onChange={(event) => setConnection(event.target.value)}
          >
            <option value="">{t("Все подключения", "All connections")}</option>
            {connections.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Фильтр по сотруднику", "Filter by assignee")}
            className={selectClass}
            value={assignee}
            disabled={mine}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">{t("Все сотрудники", "All staff")}</option>
            {staffOptions.map((staff) => (
              <option key={staff.pubkey} value={staff.pubkey}>
                {staff.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mine}
              onChange={(event) => setMine(event.target.checked)}
            />
            {t("Назначены мне", "Assigned to me")}
          </label>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void load()}
            aria-label={t("Обновить", "Refresh")}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive p-4 text-sm"
          >
            {error}
            <Button
              className="ml-3"
              variant="outline"
              onClick={() => void load()}
            >
              {t("Обновить данные", "Refresh data")}
            </Button>
          </div>
        )}
        {loading && !data && (
          <p role="status">
            {t("Загружаем обращения…", "Loading conversations…")}
          </p>
        )}
        {!loading && !error && data?.items.length === 0 && (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <MessageCircle className="mx-auto mb-3 size-8 text-muted-foreground" />
            <h2 className="font-medium">
              {t(
                "Здесь появятся обращения клиентов",
                "Client conversations will appear here",
              )}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(
                "Подключите Telegram в настройках каналов или измените фильтры. Новому контакту создаётся тред, а не отдельный канал.",
                "Connect Telegram in channel settings or change the filters. New contacts get a thread, not a separate channel.",
              )}
            </p>
          </div>
        )}
        <div className="space-y-3">
          {data?.items.map((item) => (
            <article
              className="rounded-xl border p-4"
              key={item.id}
              data-testid="client-conversation"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link
                    className="font-medium hover:underline"
                    to="/channels/$channelId"
                    params={{ channelId: item.channelId }}
                    search={
                      item.rootEventId ? { thread: item.rootEventId } : {}
                    }
                  >
                    {item.title}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.provider === "telegram" ? "Telegram" : "WhatsApp"} ·{" "}
                    {item.connectionName} ·{" "}
                    {item.branchName ??
                      t(
                        "Филиал не определён · центральный администратор",
                        "No branch · central administrator",
                      )}
                  </p>
                  {!item.threaded && data.canManageRouting && (
                    <ClientMigration
                      item={item}
                      communityId={data.communityId}
                      service={service}
                      onSaved={load}
                      ru={ru}
                    />
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("Обновлено", "Updated")}{" "}
                    {new Date(item.updatedAt).toLocaleString(
                      ru ? "ru-RU" : "en-US",
                    )}
                    {item.connectionStatus !== "active"
                      ? ` · ${t("Подключение приостановлено", "Connection paused")}`
                      : ""}
                  </p>
                  <p
                    className="mt-2 text-sm"
                    data-testid="client-handler-state"
                  >
                    {item.owner === "human"
                      ? t(
                          "Диалог у сотрудника. Гермес не отвечает автоматически.",
                          "A staff member owns this conversation. Hermes will not reply automatically.",
                        )
                      : t(
                          "Диалог у Гермеса. Ответы зависят от доступности агента и подключения.",
                          "Hermes owns this conversation. Replies depend on agent and connection availability.",
                        )}
                  </p>
                  {!item.threaded && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(
                        "Старый формат: отдельный канал клиента. Назначение филиала не переносит переписку; используйте перенос с сохранением архива.",
                        "Legacy format: a separate client channel. Assigning a branch does not move the history; use migration with archive preservation.",
                      )}
                    </p>
                  )}
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link
                    to="/channels/$channelId"
                    params={{ channelId: item.channelId }}
                    search={
                      item.rootEventId ? { thread: item.rootEventId } : {}
                    }
                  >
                    {t("Открыть тред", "Open thread")}
                  </Link>
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <select
                  className={selectClass}
                  aria-label={`${t("Филиал обращения", "Conversation branch")}: ${item.title}`}
                  disabled={pending !== null}
                  value={item.branchId ?? ""}
                  onChange={(event) =>
                    void act(item, {
                      type: "assign_branch",
                      branchId: event.target.value,
                    })
                  }
                >
                  <option value="" disabled>
                    {t("Указать филиал", "Select branch")}
                  </option>
                  {data.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  aria-label={`${t("Ответственный", "Assignee")}: ${item.title}`}
                  disabled={pending !== null}
                  value={item.assignee ?? ""}
                  onChange={(event) =>
                    void act(item, {
                      type: "assign",
                      pubkey: event.target.value,
                    })
                  }
                >
                  <option value="" disabled>
                    {t("Нет доступного ответственного", "No eligible assignee")}
                  </option>
                  {data.staff
                    .filter((person) => person.channelId === item.channelId)
                    .map((person) => (
                      <option key={person.pubkey} value={person.pubkey}>
                        {person.name}
                      </option>
                    ))}
                </select>
                <select
                  className={selectClass}
                  aria-label={`${t("Статус обращения", "Conversation status")}: ${item.title}`}
                  disabled={pending !== null}
                  value={item.status}
                  onChange={(event) =>
                    void act(item, {
                      type: "set_status",
                      status: event.target
                        .value as ClientConversation["status"],
                    })
                  }
                >
                  {["waiting_staff", "waiting_parent", "resolved"].map(
                    (value) => (
                      <option key={value} value={value}>
                        {statusName(value)}
                      </option>
                    ),
                  )}
                </select>
                {!item.threaded && (
                  <span className="self-center text-xs text-muted-foreground">
                    {t(
                      "Старая история · перенос выполняется администратором после проверки доставок",
                      "Legacy history · administrator migration requires a delivery check",
                    )}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
        {data?.nextCursor && (
          <Button
            disabled={loading}
            variant="outline"
            onClick={() => void load(data.nextCursor)}
          >
            {t("Показать ещё", "Load more")}
          </Button>
        )}
      </div>
    </div>
  );
}
