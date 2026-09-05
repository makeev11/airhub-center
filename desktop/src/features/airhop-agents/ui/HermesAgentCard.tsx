import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  type AirhopHermesDeployment,
  createAirhopControlPlaneClient,
} from "@/features/airhop-agents/data/airhopControlPlane";
import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import type { AirHopLocale } from "@/shared/locale/airhopLocale";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Switch } from "@/shared/ui/switch";

export const airhopHermesDeploymentQueryKey = [
  "airhop",
  "hermes-deployment",
] as const;

type HermesState = "running" | "stopped" | "attention" | "unavailable";

const COPY: Record<
  AirHopLocale,
  {
    name: string;
    role: string;
    description: string;
    capability: string;
    capabilityHint: string;
    autoConfirm: string;
    autoConfirmHint: string;
    model: string;
    managed: string;
    savingError: string;
    state: Record<HermesState, string>;
  }
> = {
  "ru-RU": {
    name: "Администратор Гермес",
    role: "Внешний администратор",
    description:
      "Общается с родителями в подключённых каналах, отвечает на вопросы и помогает с занятиями.",
    capability: "Управлять текущими записями",
    autoConfirm: "Подтверждать онлайн-записи",
    autoConfirmHint:
      "После перехода родителя в Telegram Гермес проверяет запись и подтверждает её. Если выключено, он зовёт сотрудника.",
    capabilityHint:
      "Гермес может отменить запись или передать запрос на перенос от подтверждённого родителя. Каждое действие проверяет Booking Core.",
    model: "Модель",
    managed: "Управляется Airhop",
    savingError: "Не удалось изменить настройки Гермеса.",
    state: {
      running: "Работает",
      stopped: "Выключен",
      attention: "Нужно внимание",
      unavailable: "Ещё не подключён",
    },
  },
  "en-US": {
    name: "Administrator Hermes",
    role: "External administrator",
    description:
      "Talks with parents in connected channels, answers questions, and helps with classes.",
    capability: "Manage current bookings",
    autoConfirm: "Confirm online bookings",
    autoConfirmHint:
      "After a parent connects Telegram, Hermes checks and confirms their booking. If disabled, he asks a staff member.",
    capabilityHint:
      "Hermes can cancel a booking or submit a transfer request for a verified parent. Booking Core checks every action.",
    model: "Model",
    managed: "Managed by Airhop",
    savingError: "Hermes settings could not be changed.",
    state: {
      running: "Active",
      stopped: "Disabled",
      attention: "Needs attention",
      unavailable: "Not connected yet",
    },
  },
  "pt-BR": {
    name: "Administrador Hermes",
    role: "Administrador externo",
    description:
      "Conversa com responsáveis nos canais conectados, responde perguntas e ajuda com as aulas.",
    capability: "Gerenciar reservas atuais",
    autoConfirm: "Confirmar reservas online",
    autoConfirmHint:
      "Depois que o responsável conectar o Telegram, Hermes verifica e confirma a reserva. Se desativado, chama um funcionário.",
    capabilityHint:
      "Hermes pode cancelar uma reserva ou enviar um pedido de transferência para um responsável verificado. O Booking Core valida cada ação.",
    model: "Modelo",
    managed: "Gerenciado pela Airhop",
    savingError: "Não foi possível alterar as configurações do Hermes.",
    state: {
      running: "Ativo",
      stopped: "Desativado",
      attention: "Precisa de atenção",
      unavailable: "Ainda não conectado",
    },
  },
  "tr-TR": {
    name: "Yönetici Hermes",
    role: "Harici yönetici",
    description:
      "Bağlı kanallarda velilerle konuşur, soruları yanıtlar ve derslere yardımcı olur.",
    capability: "Mevcut kayıtları yönet",
    autoConfirm: "Çevrimiçi kayıtları onayla",
    autoConfirmHint:
      "Veli Telegram'a bağlandıktan sonra Hermes kaydı kontrol edip onaylar. Kapalıysa bir çalışanı çağırır.",
    capabilityHint:
      "Hermes doğrulanmış bir velinin kaydını iptal edebilir veya taşıma talebi iletebilir. Booking Core her işlemi kontrol eder.",
    model: "Model",
    managed: "Airhop tarafından yönetilir",
    savingError: "Hermes ayarları değiştirilemedi.",
    state: {
      running: "Etkin",
      stopped: "Devre dışı",
      attention: "İlgilenilmesi gerekiyor",
      unavailable: "Henüz bağlı değil",
    },
  },
};

function deploymentState(
  deployment: AirhopHermesDeployment | null | undefined,
  failed: boolean,
): HermesState {
  if (failed || deployment?.paused) return "attention";
  if (!deployment) return "unavailable";
  return deployment.enabled ? "running" : "stopped";
}

export function HermesAgentCard({ serverEnabled }: { serverEnabled: boolean }) {
  const locale = useAirHopLocale();
  const copy = COPY[locale];
  const [client] = React.useState(() => createAirhopControlPlaneClient());
  const queryClient = useQueryClient();
  const membership = useMyRelayMembershipLookupQuery();
  const role = membership.data?.membership?.role ?? null;
  const canManage = role === "owner" || role === "admin";
  const deployment = useQuery({
    enabled: serverEnabled,
    queryKey: airhopHermesDeploymentQueryKey,
    queryFn: () => client.getCurrentHermesDeployment(),
    staleTime: 15_000,
  });
  const save = useMutation({
    mutationFn: ({
      current,
      patch,
    }: {
      current: AirhopHermesDeployment;
      patch: Partial<
        Pick<
          AirhopHermesDeployment,
          "enabled" | "manageBookings" | "autoConfirmOnlineBookings"
        >
      >;
    }) => client.putHermesDeployment(current, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(airhopHermesDeploymentQueryKey, updated);
    },
  });
  const { isPending: isSaving, mutateAsync: saveDeployment } = save;
  const current = deployment.data;
  const state = deploymentState(current, deployment.isError);

  const update = React.useCallback(
    async (
      patch: Partial<
        Pick<
          AirhopHermesDeployment,
          "enabled" | "manageBookings" | "autoConfirmOnlineBookings"
        >
      >,
    ) => {
      if (!current) return;
      try {
        await saveDeployment({ current, patch });
      } catch {
        toast.error(copy.savingError);
      }
    },
    [copy.savingError, current, saveDeployment],
  );

  return (
    <article
      className="grid gap-5 rounded-2xl border border-primary/25 bg-primary/5 p-5 shadow-xs sm:grid-cols-[88px_minmax(0,1fr)_auto]"
      data-testid="airhop-agent-card-hermes"
    >
      <img
        alt=""
        className="size-[88px] rounded-2xl border border-primary/20 bg-muted object-cover"
        draggable={false}
        src="/agents/hermes.png"
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{copy.name}</h2>
          <span className="rounded-md border border-border/70 bg-background/70 px-2 py-0.5 text-xs text-muted-foreground">
            {copy.state[state]}
          </span>
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {copy.role}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{copy.model}</dt>
            <dd className="font-medium">
              {current?.modelRevision ?? copy.managed}
            </dd>
          </div>
        </dl>
        {current ? (
          <div className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background/60 p-4">
            <div>
              <p className="text-sm font-medium">{copy.capability}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {copy.capabilityHint}
              </p>
            </div>
            <Switch
              aria-label={copy.capability}
              checked={current.manageBookings}
              disabled={!canManage || isSaving}
              onCheckedChange={(manageBookings) =>
                void update({ manageBookings })
              }
            />
          </div>
        ) : null}
        {current ? (
          <div className="mt-3 flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background/60 p-4">
            <div>
              <p className="text-sm font-medium">{copy.autoConfirm}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {copy.autoConfirmHint}
              </p>
            </div>
            <Switch
              aria-label={copy.autoConfirm}
              checked={current.autoConfirmOnlineBookings}
              disabled={!canManage || isSaving || !current.manageBookings}
              onCheckedChange={(autoConfirmOnlineBookings) =>
                void update({ autoConfirmOnlineBookings })
              }
            />
          </div>
        ) : null}
      </div>
      <div className="flex items-start justify-end">
        {deployment.isLoading ? (
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            aria-label={`${copy.name}: ${copy.state[current?.enabled ? "running" : "stopped"]}`}
            checked={current?.enabled ?? false}
            disabled={!current || !canManage || isSaving}
            onCheckedChange={(enabled) => void update({ enabled })}
          />
        )}
      </div>
    </article>
  );
}
