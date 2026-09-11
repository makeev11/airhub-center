import { useProfilesWithSelf } from "@/features/profile/useProfilesWithSelf";
import { useMemo } from "react";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { buildDirectMessageIntro } from "./dmParticipantDisplay";

/** Keeps participant summaries reactive when only the interface locale changes. */
export function useDirectMessageIntro({
  channel,
  currentPubkey,
  profiles,
}: Parameters<typeof buildDirectMessageIntro>[0]) {
  const locale = useAirHopLocale();
  const resolvedProfiles = useProfilesWithSelf(profiles, currentPubkey);
  return useMemo(
    () =>
      buildDirectMessageIntro({
        channel,
        currentPubkey,
        profiles: resolvedProfiles,
        locale,
      }),
    [channel, currentPubkey, resolvedProfiles, locale],
  );
}
