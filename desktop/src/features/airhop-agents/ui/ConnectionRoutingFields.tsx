import { useChannelsQuery } from "@/features/channels/hooks";
import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import type { ConnectionRouting } from "../data/airhopControlPlane";

/** Routing is selected once at setup; changing it never moves existing client threads. */
export function ConnectionRoutingFields({
  value,
  onChange,
  disabled,
  ru,
}: {
  value: ConnectionRouting;
  onChange: (value: ConnectionRouting) => void;
  disabled: boolean;
  ru: boolean;
}) {
  const booking = useBookingWorkspace();
  const channels = useChannelsQuery();
  const label = (a: string, b: string) => (ru ? a : b);
  const selectClass =
    "h-9 rounded-md border border-input bg-background px-3 text-sm";
  return (
    <fieldset className="grid gap-3 rounded-lg border p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">
        {label("Куда поступают обращения", "Incoming conversations")}
      </legend>
      <label className="grid gap-1 text-sm">
        {label("Подключение", "Routing mode")}
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
          <option value="">
            {label("Общее для всего центра", "Organization-wide")}
          </option>
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
        {label("Закрытый рабочий канал", "Private work channel")}
        <select
          className={selectClass}
          value={value.buzzChannelId ?? ""}
          onChange={(event) =>
            onChange({ ...value, buzzChannelId: event.target.value || null })
          }
        >
          <option value="">
            {value.branchId
              ? label("Рабочий канал филиала", "Branch default channel")
              : label(
                  "Общий #parents — создать или использовать существующий",
                  "Shared #parents — create or reuse",
                )}
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
        {label(
          "Участники выбранного канала видят все обращения в нём. Гермес и коннектор будут добавлены при настройке. Филиал определяет ответственных, но не скрывает переписку. Для строгого разделения используйте отдельные филиальные подключения.",
          "Channel members can see every conversation in it. Setup adds Hermes and the connector. Branch assignment does not hide messages. Use separate branch connections when strict isolation is required.",
        )}
      </p>
    </fieldset>
  );
}
