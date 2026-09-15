import { relayOrigin, VAULT_KEY, type ChatIdentity } from "./identity.ts";

export type ChatCenter = { id: string; name: string; origin: string };

/** Only explicitly published Center entries may be selected by the shared app. */
export function parseCenters(value: unknown): ChatCenter[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new Error("Список Центров недоступен.");
  const ids = new Set<string>();
  const origins = new Set<string>();
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(entry.id) ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      entry.name.length > 120 ||
      typeof entry.origin !== "string"
    )
      throw new Error("Некорректная конфигурация Центра.");
    const origin = relayOrigin(entry.origin);
    if (
      !origin.startsWith("https://") ||
      ids.has(entry.id) ||
      origins.has(origin)
    )
      throw new Error("Некорректная конфигурация Центра.");
    ids.add(entry.id);
    origins.add(origin);
    return { id: entry.id, name: entry.name, origin };
  });
}

/** Each Center gets its own encrypted vault; selecting one never migrates another's key. */
export function centerVaultKey(origin: string): string {
  return `${VAULT_KEY}.${encodeURIComponent(relayOrigin(origin))}`;
}

/** A same-origin, fixed edge route handles HTTP only; the signed identity stays canonical. */
export function centerIdentity(
  identity: ChatIdentity,
  center: ChatCenter,
): ChatIdentity {
  if (identity.origin !== center.origin)
    throw new Error("Подключение относится к другому Центру.");
  return { ...identity, httpBase: `/centers/${center.id}` };
}

/** Never route an absolute or unvalidated path through the Center HTTP bridge. */
export function centerHttpUrl(identity: ChatIdentity, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Некорректный путь Центра.");
  return `${identity.httpBase ?? identity.origin}${path}`;
}
