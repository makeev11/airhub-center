import { useChannelsQuery } from "@/features/channels/hooks";
import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import type { AirHopLocale } from "@/shared/locale/airhopLocale";
import type { ConnectionRouting } from "../data/airhopControlPlane";

const COPY: Record<
  AirHopLocale,
  {
    branchDefault: string;
    hint: string;
    legend: string;
    organizationWide: string;
    privateChannel: string;
    routingMode: string;
    sharedParents: string;
  }
> = {
  "ru-RU": {
    branchDefault: "Рабочий канал филиала",
    hint: "Участники выбранного канала видят все обращения в нём. Гермес и коннектор будут добавлены при настройке. Филиал определяет ответственных, но не скрывает переписку. Для строгого разделения используйте отдельные филиальные подключения.",
    legend: "Куда поступают обращения",
    organizationWide: "Общее для всего центра",
    privateChannel: "Закрытый рабочий канал",
    routingMode: "Подключение",
    sharedParents: "Общий #parents — создать или использовать существующий",
  },
  "en-US": {
    branchDefault: "Branch default channel",
    hint: "Channel members can see every conversation in it. Setup adds Hermes and the connector. Branch assignment does not hide messages. Use separate branch connections when strict isolation is required.",
    legend: "Incoming conversations",
    organizationWide: "Organization-wide",
    privateChannel: "Private work channel",
    routingMode: "Routing mode",
    sharedParents: "Shared #parents — create or reuse",
  },
  "pt-BR": {
    branchDefault: "Canal padrão da unidade",
    hint: "Os integrantes do canal escolhido podem ver todas as conversas nele. A configuração adiciona o Hermes e o conector. Vincular uma unidade define os responsáveis, mas não oculta as mensagens. Para uma separação rígida, use conexões distintas por unidade.",
    legend: "Destino das novas conversas",
    organizationWide: "Todo o centro",
    privateChannel: "Canal de trabalho privado",
    routingMode: "Roteamento",
    sharedParents: "#parents compartilhado — criar ou reutilizar",
  },
  "tr-TR": {
    branchDefault: "Şubenin varsayılan kanalı",
    hint: "Seçilen kanalın üyeleri kanaldaki tüm görüşmeleri görebilir. Kurulum Hermes'i ve bağlayıcıyı ekler. Şube ataması mesajları gizlemez. Kesin ayrım gerektiğinde her şube için ayrı bağlantı kullanın.",
    legend: "Yeni görüşmelerin hedefi",
    organizationWide: "Tüm merkez",
    privateChannel: "Özel çalışma kanalı",
    routingMode: "Yönlendirme",
    sharedParents: "Ortak #parents — oluştur veya yeniden kullan",
  },
};

/** Routing is selected once at setup; changing it never moves existing client threads. */
export function ConnectionRoutingFields({
  value,
  onChange,
  disabled,
  locale,
}: {
  value: ConnectionRouting;
  onChange: (value: ConnectionRouting) => void;
  disabled: boolean;
  locale: AirHopLocale;
}) {
  const booking = useBookingWorkspace();
  const channels = useChannelsQuery();
  const copy = COPY[locale];
  const selectClass =
    "h-9 rounded-md border border-input bg-background px-3 text-sm";
  return (
    <fieldset className="grid gap-3 rounded-lg border p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{copy.legend}</legend>
      <label className="grid gap-1 text-sm">
        {copy.routingMode}
        <select
          className={selectClass}
          value={value.branchId ?? ""}
          onChange={(event) =>
            onChange({
              branchId: event.target.value || null,
              buzzChannelId: null,
            })
          }
        >
          <option value="">{copy.organizationWide}</option>
          {booking.workspace?.branches
            .filter((branch) => branch.status === "active")
            .map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        {copy.privateChannel}
        <select
          className={selectClass}
          value={value.buzzChannelId ?? ""}
          onChange={(event) =>
            onChange({ ...value, buzzChannelId: event.target.value || null })
          }
        >
          <option value="">
            {value.branchId ? copy.branchDefault : copy.sharedParents}
          </option>
          {channels.data
            ?.filter(
              (channel) =>
                channel.channelType === "stream" &&
                channel.visibility === "private" &&
                !channel.archivedAt,
            )
            .map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
        </select>
      </label>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {copy.hint}
      </p>
    </fieldset>
  );
}
