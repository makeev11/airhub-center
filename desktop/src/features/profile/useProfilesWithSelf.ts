import * as React from "react";
import { useProfileQuery, useSelfProfileCache } from "./hooks";
import {
  mergeCurrentProfileIntoLookup,
  type UserProfileLookup,
} from "./lib/identity";
import { normalizePubkey } from "@/shared/lib/pubkey";

/** Include the current profile and its cached photo in a participant lookup. */
export function useProfilesWithSelf(
  profiles: UserProfileLookup | undefined,
  currentPubkey?: string,
) {
  const profile = useProfileQuery().data;
  const cache = useSelfProfileCache();
  return React.useMemo(() => {
    if (
      !profile ||
      !currentPubkey ||
      normalizePubkey(profile.pubkey) !== normalizePubkey(currentPubkey)
    ) {
      return profiles;
    }
    return mergeCurrentProfileIntoLookup(profiles, {
      ...profile,
      avatarUrl: cache?.avatarDataUrl ?? profile.avatarUrl,
    });
  }, [profiles, profile, currentPubkey, cache?.avatarDataUrl]);
}
