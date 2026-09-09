import * as React from "react";
import { Button } from "@/shared/ui/button";
import type {
  ClientInbox,
  ClientInboxService,
} from "../data/clientInboxService";

/** Routing settings never grant membership or hide other threads in a shared channel. */
export function ClientRoutingSettings({
  data,
  service,
  onSaved,
  ru,
}: {
  data: ClientInbox;
  service: ClientInboxService;
  onSaved: () => Promise<void>;
  ru: boolean;
}) {
  const [branchId, setBranchId] = React.useState("");
  const branch = data.branches.find((item) => item.id === branchId);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setSelected(branch?.responsiblePubkeys ?? []);
  }, [branch]);
  const staff = [
    ...new Map(data.staff.map((item) => [item.pubkey, item])).values(),
  ];
  const save = async () => {
    if (!branch || pending) return;
    setPending(true);
    setError(null);
    try {
      await service.setResponsibles(data.communityId, branch, selected);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        {ru
          ? "Ответственные за обращения филиалов"
          : "Branch responsibility settings"}
      </summary>
      <p className="my-3 max-w-3xl text-sm text-muted-foreground">
        {ru
          ? "Выберите до восьми сотрудников. Уведомления получают только те, у кого уже есть доступ к каналу обращения. Если таких ответственных нет, обращение получит владелец или центральный администратор. Эта настройка не выдаёт доступ к каналам и не переназначает старые обращения."
          : "Choose up to eight staff. Only existing members of the conversation channel receive notifications; otherwise the owner or central administrator handles the conversation. This does not grant channel access or reassign existing conversations."}
      </p>
      <select
        aria-label={ru ? "Филиал для настройки" : "Configure branch"}
        className="h-9 rounded-md border bg-background px-3 text-sm"
        value={branchId}
        disabled={pending}
        onChange={(e) => {
          setBranchId(e.target.value);
          setError(null);
        }}
      >
        <option value="">{ru ? "Выберите филиал" : "Select a branch"}</option>
        {data.branches.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {branch && (
        <fieldset className="mt-3 space-y-2" disabled={pending}>
          <legend className="mb-2 text-sm">
            {ru
              ? "Ответственные (без выбора — владелец)"
              : "Responsible staff (none: owner fallback)"}
          </legend>
          {staff.map((item) => (
            <label
              key={item.pubkey}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(item.pubkey)}
                disabled={
                  selected.length >= 8 && !selected.includes(item.pubkey)
                }
                onChange={(e) =>
                  setSelected((previous) =>
                    e.target.checked
                      ? [...previous, item.pubkey]
                      : previous.filter((key) => key !== item.pubkey),
                  )
                }
              />
              {item.name}
            </label>
          ))}
          {selected
            .filter((key) => !staff.some((item) => item.pubkey === key))
            .map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked
                  onChange={() =>
                    setSelected((previous) =>
                      previous.filter((value) => value !== key),
                    )
                  }
                />
                {ru ? "Недоступный сотрудник" : "Unavailable staff"}:{" "}
                {key.slice(0, 12)}…
              </label>
            ))}
          <Button onClick={() => void save()} disabled={pending}>
            {pending
              ? ru
                ? "Сохраняем…"
                : "Saving…"
              : ru
                ? "Сохранить ответственных"
                : "Save responsible staff"}
          </Button>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}
