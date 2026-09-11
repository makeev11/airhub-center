import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { normalizePubkey } from "@/shared/lib/pubkey";

/** Presentation fallback for the server-registered guest, never inferred from text or tags. */
export function withWelcomeGuestProfile(
  profiles: UserProfileLookup,
  registeredPubkey: string | null | undefined,
  locale: string,
): UserProfileLookup {
  if (!registeredPubkey || !/^[a-f0-9]{64}$/i.test(registeredPubkey))
    return profiles;
  const key = normalizePubkey(registeredPubkey);
  const existing = profiles[key];
  return {
    ...profiles,
    [key]: {
      ...existing,
      displayName:
        existing?.displayName?.trim() ||
        existing?.name?.trim() ||
        (locale.startsWith("ru") ? "Гермес" : "Hermes"),
      avatarUrl: existing?.avatarUrl || "/agents/hermes.png",
      nip05Handle: existing?.nip05Handle ?? null,
      ownerPubkey: existing?.ownerPubkey ?? null,
      isAgent: true,
    },
  };
}
