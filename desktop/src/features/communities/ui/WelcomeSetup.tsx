import * as React from "react";

import { useCommunityOnboarding } from "@/features/onboarding/communityOnboarding";
import { AirHopOwnerSetup } from "@/features/onboarding/ui/AirHopOwnerSetup";

type WelcomeSetupPage = "welcome" | "existing" | "join" | "member" | "owned";
type WelcomeTransitionMode = "initial" | "forward" | "backward";

type WelcomeSetupProps = {
  defaultRelayUrl: string;
  initialPage?: WelcomeSetupPage;
  initialTransitionMode?: WelcomeTransitionMode;
  onBack: () => void;
};

/**
 * AirHop has one first-owner path: choose a language and enter the organization
 * code. The signed claim then continues through the shared profile/Welcome
 * transaction; inherited Buzz community choices are intentionally unreachable.
 */
export function WelcomeSetup({ defaultRelayUrl }: WelcomeSetupProps) {
  const communityOnboarding = useCommunityOnboarding();
  const startOwnerClaim = React.useCallback(
    (relayUrl: string, code: string) => {
      communityOnboarding.start({
        source: "first-community",
        firstCommunityPage: "join",
        relayUrl,
        inviteCode: code,
      });
    },
    [communityOnboarding],
  );

  return (
    <AirHopOwnerSetup
      defaultRelayUrl={defaultRelayUrl}
      onStart={startOwnerClaim}
    />
  );
}
