import * as React from "react";
import { useRelayMembersQuery } from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Button } from "@/shared/ui/button";
import { truncatePubkey } from "@/shared/lib/pubkey";
import {
  useAirhopPrincipalDirectory,
  humanMembers,
} from "../data/principalDirectory";
import type { AgentCommunication } from "../model/agentPolicy";
import { agentCommunicationCopy } from "./agentCommunicationCopy";

const fieldClass =
  "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";

/** Edits an explicit policy draft; never changes access merely by mounting. */
export function AgentCommunicationFields({
  value,
  onChange,
  canManage,
}: {
  value: AgentCommunication | null | undefined;
  onChange: (value: AgentCommunication) => void;
  canManage: boolean;
}) {
  const copy = agentCommunicationCopy[useAirHopLocale()];
  const selecting = value?.audience.mode === "selected";
  const roster = useRelayMembersQuery(selecting && canManage);
  const directory = useAirhopPrincipalDirectory(selecting && canManage);
  const people = React.useMemo(
    () =>
      directory.data ? humanMembers(roster.data ?? [], directory.data) : [],
    [roster.data, directory.data],
  );
  const profiles = useUsersBatchQuery(
    people.map((person) => person.pubkey),
    { enabled: selecting && canManage && people.length > 0 },
  );
  const [search, setSearch] = React.useState("");
  const selected =
    value?.audience.mode === "selected" ? value.audience.pubkeys : [];
  const unavailable = roster.isError || directory.isError;
  const loading = roster.isPending || directory.isPending;
  const options = [
    ...people.map((person) => ({
      pubkey: person.pubkey,
      name:
        profiles.data?.profiles?.[person.pubkey]?.displayName?.trim() ||
        truncatePubkey(person.pubkey),
    })),
    ...selected
      .filter((key) => !people.some((person) => person.pubkey === key))
      .map((pubkey) => ({
        pubkey,
        name: `${copy.missing}: ${truncatePubkey(pubkey)}`,
      })),
  ];
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border border-border/60 p-3"
      aria-label={copy.title}
    >
      <h3 className="text-sm font-medium">{copy.title}</h3>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="min-w-0 space-y-1 text-sm">
          <span>{copy.who}</span>
          <select
            className={fieldClass}
            value={value?.audience.mode ?? ""}
            onChange={(event) => {
              const mode = event.target.value;
              if (mode === "staff" || mode === "owner" || mode === "selected")
                onChange({
                  audience:
                    mode === "selected" ? { mode, pubkeys: [] } : { mode },
                  surfaces: value?.surfaces ?? "channels",
                });
            }}
          >
            {!value && (
              <option value="" disabled>
                {copy.legacy}
              </option>
            )}
            <option value="staff">{copy.staff}</option>
            <option value="owner">{copy.owner}</option>
            <option value="selected">{copy.selected}</option>
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          <span>{copy.where}</span>
          <select
            className={fieldClass}
            value={value?.surfaces ?? ""}
            onChange={(event) => {
              const surfaces = event.target.value;
              if (
                surfaces === "both" ||
                surfaces === "channels" ||
                surfaces === "direct_messages"
              )
                onChange({
                  audience: value?.audience ?? { mode: "owner" },
                  surfaces,
                });
            }}
          >
            {!value && (
              <option value="" disabled>
                {copy.legacy}
              </option>
            )}
            <option value="both">{copy.both}</option>
            <option value="channels">{copy.channels}</option>
            <option value="direct_messages">{copy.direct_messages}</option>
          </select>
        </label>
      </div>
      {selecting && (
        <div className="space-y-2">
          {canManage && (
            <input
              className={fieldClass}
              type="search"
              aria-label={copy.search}
              placeholder={copy.search}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          {unavailable ? (
            <p role="status" className="text-sm text-destructive">
              {copy.unavailable}{" "}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void roster.refetch();
                  void directory.refetch();
                }}
              >
                {copy.retry}
              </Button>
            </p>
          ) : loading && canManage ? (
            <p className="text-sm text-muted-foreground">{copy.loading}</p>
          ) : null}
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {options
              .filter((person) =>
                `${person.name} ${person.pubkey}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((person) => (
                <label
                  key={person.pubkey}
                  className="flex items-start gap-2 text-sm"
                  title={person.pubkey}
                >
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={selected.includes(person.pubkey)}
                    onChange={(event) =>
                      onChange({
                        audience: {
                          mode: "selected",
                          pubkeys: event.target.checked
                            ? [...selected, person.pubkey]
                            : selected.filter((key) => key !== person.pubkey),
                        },
                        surfaces: value?.surfaces ?? "channels",
                      })
                    }
                  />
                  <span className="min-w-0 break-words">{person.name}</span>
                </label>
              ))}
          </div>
          {selected.length === 0 && (
            <p role="status" className="text-sm text-destructive">
              {copy.empty}
            </p>
          )}
        </div>
      )}
      <p className="text-xs leading-5 text-muted-foreground">{copy.help}</p>
    </section>
  );
}
