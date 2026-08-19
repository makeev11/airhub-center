import type { CommunityOnboardingSource } from "@/features/onboarding/communityOnboarding";

export function shouldUseAirHopOwnerFirstRunSurface(
  source: CommunityOnboardingSource,
): boolean {
  return source === "first-community";
}

export function shouldEnterWelcomeAfterOwnerProfile(
  source: CommunityOnboardingSource,
): boolean {
  return source === "first-community";
}
