import * as React from "react";
import { Bot, Power } from "lucide-react";
import { toast } from "sonner";

import {
  useManagedAgentsQuery,
  useSetManagedAgentStartOnAppLaunchMutation,
  useStartManagedAgentMutation,
  useStopManagedAgentMutation,
} from "@/features/agents/hooks";
import {
  materializeAirhopAgentCards,
  type AirhopAgentCardModel,
} from "@/features/airhop-agents/model/airhopAgentCatalog";
import type { AirHopLocale } from "@/shared/locale/airhopLocale";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";

const COPY: Record<
  AirHopLocale,
  {
    title: string;
    description: string;
    loading: string;
    loadError: string;
    retry: string;
    allOn: string;
    allOff: string;
    actionError: string;
    state: Record<AirhopAgentCardModel["state"], string>;
    access: Record<"owner-only" | "allowlist" | "anyone" | "unknown", string>;
    accessLabel: string;
    modelLabel: string;
    managedModel: string;
  }
> = {
  "ru-RU": {
    title: "Команда Airhop",
    description:
      "Физ руководит командой, а специалисты отвечают за свои рабочие области. Можно обращаться к Физу или сразу к нужному агенту.",
    loading: "Подключаем команду…",
    loadError: "Не удалось загрузить агентов.",
    retry: "Повторить",
    allOn: "Включить всех",
    allOff: "Выключить всех",
    actionError: "Не удалось изменить состояние агента.",
    state: {
      running: "Работает",
      stopped: "Выключен",
      attention: "Нужно внимание",
      unavailable: "Ещё не подключён",
    },
    access: {
      "owner-only": "Только владелец",
      allowlist: "Выбранные сотрудники",
      anyone: "Все сотрудники",
      unknown: "Не настроен",
    },
    accessLabel: "Кто может обращаться",
    modelLabel: "Модель",
    managedModel: "Управляется Airhop",
  },
  "en-US": {
    title: "Airhop team",
    description:
      "Fizz leads the team, while each specialist owns their work area. You can ask Fizz or address a specialist directly.",
    loading: "Connecting your team…",
    loadError: "Agents could not be loaded.",
    retry: "Try again",
    allOn: "Enable all",
    allOff: "Disable all",
    actionError: "The agent state could not be changed.",
    state: {
      running: "Active",
      stopped: "Disabled",
      attention: "Needs attention",
      unavailable: "Not connected yet",
    },
    access: {
      "owner-only": "Owner only",
      allowlist: "Selected employees",
      anyone: "All employees",
      unknown: "Not configured",
    },
    accessLabel: "Who can ask",
    modelLabel: "Model",
    managedModel: "Managed by Airhop",
  },
  "tr-TR": {
    title: "Airhop ekibi",
    description:
      "Fizz ekibi yönetir; her uzman kendi çalışma alanından sorumludur. Fizz'e veya doğrudan bir uzmana yazabilirsiniz.",
    loading: "Ekibiniz bağlanıyor…",
    loadError: "Temsilciler yüklenemedi.",
    retry: "Tekrar dene",
    allOn: "Tümünü etkinleştir",
    allOff: "Tümünü devre dışı bırak",
    actionError: "Temsilcinin durumu değiştirilemedi.",
    state: {
      running: "Etkin",
      stopped: "Devre dışı",
      attention: "İlgilenilmesi gerekiyor",
      unavailable: "Henüz bağlı değil",
    },
    access: {
      "owner-only": "Yalnızca işletme sahibi",
      allowlist: "Seçili çalışanlar",
      anyone: "Tüm çalışanlar",
      unknown: "Yapılandırılmadı",
    },
    accessLabel: "Kimler yazabilir",
    modelLabel: "Model",
    managedModel: "Airhop tarafından yönetilir",
  },
  "pt-BR": {
    title: "Equipe Airhop",
    description:
      "Fizz lidera a equipe, e cada especialista cuida da sua área. Você pode falar com Fizz ou diretamente com um especialista.",
    loading: "Conectando sua equipe…",
    loadError: "Não foi possível carregar os agentes.",
    retry: "Tentar novamente",
    allOn: "Ativar todos",
    allOff: "Desativar todos",
    actionError: "Não foi possível alterar o estado do agente.",
    state: {
      running: "Ativo",
      stopped: "Desativado",
      attention: "Precisa de atenção",
      unavailable: "Ainda não conectado",
    },
    access: {
      "owner-only": "Somente o proprietário",
      allowlist: "Funcionários selecionados",
      anyone: "Todos os funcionários",
      unknown: "Não configurado",
    },
    accessLabel: "Quem pode solicitar",
    modelLabel: "Modelo",
    managedModel: "Gerenciado pela Airhop",
  },
};

export function AirhopAgentsScreen({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const locale = useAirHopLocale();
  const copy = COPY[locale];
  const managedAgents = useManagedAgentsQuery();
  const { mutateAsync: startAgent } = useStartManagedAgentMutation();
  const { mutateAsync: stopAgent } = useStopManagedAgentMutation();
  const { mutateAsync: setStartOnLaunch } =
    useSetManagedAgentStartOnAppLaunchMutation();
  const [pending, setPending] = React.useState<Set<string>>(() => new Set());
  const cards = React.useMemo(
    () => materializeAirhopAgentCards(managedAgents.data ?? [], locale),
    [locale, managedAgents.data],
  );
  const available = cards.filter((card) => card.pubkey !== null);
  const allRunning =
    available.length > 0 && available.every((card) => card.state === "running");

  const toggle = React.useCallback(
    async (card: AirhopAgentCardModel, enable: boolean) => {
      if (!card.pubkey) return false;
      const pubkey = card.pubkey;
      setPending((current) => new Set(current).add(pubkey));
      try {
        if (enable) {
          // The simple Airhop switch represents an enabled service, not a
          // one-off process launch. Persist the choice before spawning so the
          // agent survives app restarts and the runtime reconciler keeps the
          // pair warm for this organization.
          await setStartOnLaunch({ pubkey, startOnAppLaunch: true });
          try {
            await startAgent(pubkey);
          } catch (error) {
            // Do not leave a failed start silently armed for the next launch.
            await setStartOnLaunch({
              pubkey,
              startOnAppLaunch: false,
            }).catch(() => undefined);
            throw error;
          }
        } else {
          // Disarm auto-start first so a concurrent reconciliation cannot
          // immediately recreate the process the user is turning off.
          await setStartOnLaunch({ pubkey, startOnAppLaunch: false });
          await stopAgent(pubkey);
        }
        return true;
      } catch {
        toast.error(copy.actionError);
        return false;
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(pubkey);
          return next;
        });
      }
    },
    [copy.actionError, setStartOnLaunch, startAgent, stopAgent],
  );

  const toggleAll = React.useCallback(async () => {
    await Promise.all(available.map((card) => toggle(card, !allRunning)));
  }, [allRunning, available, toggle]);

  return (
    <section
      className={
        embedded
          ? "space-y-6"
          : "min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10"
      }
      data-testid="airhop-agents-screen"
    >
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-border/70 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="size-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {copy.title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {copy.description}
            </p>
          </div>
          <Button
            disabled={available.length === 0 || pending.size > 0}
            onClick={() => void toggleAll()}
            variant="outline"
          >
            <Power />
            {allRunning ? copy.allOff : copy.allOn}
          </Button>
        </header>

        {managedAgents.isLoading ? (
          <p className="py-10 text-sm text-muted-foreground">{copy.loading}</p>
        ) : managedAgents.isError ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
            <p className="text-sm">{copy.loadError}</p>
            <Button
              className="mt-4"
              onClick={() => void managedAgents.refetch()}
              size="sm"
              variant="outline"
            >
              {copy.retry}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {cards.map((card) => {
              const enabled =
                card.state === "running" || card.state === "attention";
              const access = card.respondTo ?? "unknown";
              return (
                <article
                  className="grid gap-5 rounded-2xl border border-border/70 bg-card p-5 shadow-xs sm:grid-cols-[88px_minmax(0,1fr)_auto]"
                  data-testid={`airhop-agent-card-${card.role}`}
                  key={card.personaId}
                >
                  <img
                    alt=""
                    className="size-[88px] rounded-2xl border border-border/70 bg-muted object-cover"
                    draggable={false}
                    src={card.avatarUrl}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{card.name}</h2>
                      <span className="rounded-md border border-border/70 bg-muted/45 px-2 py-0.5 text-xs text-muted-foreground">
                        {copy.state[card.state]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {card.roleLabel}
                    </p>
                    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">
                          {copy.accessLabel}
                        </dt>
                        <dd className="font-medium">{copy.access[access]}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          {copy.modelLabel}
                        </dt>
                        <dd className="font-medium">
                          {card.model ?? copy.managedModel}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex items-start justify-end">
                    <Switch
                      aria-label={`${card.name}: ${copy.state[enabled ? "running" : "stopped"]}`}
                      checked={enabled}
                      disabled={!card.pubkey || pending.has(card.pubkey)}
                      onCheckedChange={(checked) => void toggle(card, checked)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
