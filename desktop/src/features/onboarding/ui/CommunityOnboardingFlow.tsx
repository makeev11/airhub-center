import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";

import {
  airHopOwnerCopy,
  airHopOwnerError,
  loadAirHopOwnerLocale,
} from "@/features/onboarding/airhopOwnerLocale";
import {
  markCommunityOnboardingComplete,
  useCommunityOnboarding,
} from "@/features/onboarding/communityOnboarding";
import {
  shouldEnterWelcomeAfterOwnerProfile,
  shouldUseAirHopOwnerFirstRunSurface,
} from "@/features/onboarding/airhopOwnerJourney";
import {
  initializeStarterChannels,
  type WelcomeProvisioningStage,
  welcomeProvisioningEligibility,
} from "@/features/onboarding/hooks";
import { useClaimInvite } from "@/features/onboarding/useClaimInvite";
import { welcomeRoleDefinition } from "@/features/onboarding/welcomeTeamLocale";
import { WELCOME_TEAM_PRESENTATIONS } from "@/features/onboarding/welcomeTeamPresentation";
import { CommunityChangeOverlay } from "@/features/communities/ui/CommunityChangeOverlay";
import {
  takePendingWelcomeChannelForDirectEntry,
  WELCOME_SURFACE_READY_EVENT,
} from "@/features/onboarding/welcome";
import { useAvatarPresentation } from "@/features/profile/avatarPresentationStore";
import { registerAvatarWhenReady } from "@/features/profile/avatarProfileSync";
import { profileQueryKey } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import {
  parseEmojiAvatarDataUrl,
  ProfileAvatarEditor,
} from "@/features/profile/ui/ProfileAvatarEditor";
import { getProfile, updateProfile } from "@/shared/api/tauriProfiles";
import { getIdentity, importIdentity } from "@/shared/api/tauriIdentity";
import { relayClient } from "@/shared/api/relayClient";
import { getMyRelayMembershipLookup } from "@/shared/api/relayMembers";
import { AIRHOP_OWNER_BACKGROUND_PATH } from "@/shared/brand/airhopBrand";
import { cn } from "@/shared/lib/cn";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { AirHopMark } from "@/shared/ui/airhop-brand/AirHopBrand";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { MembershipDenied } from "./MembershipDenied";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import {
  ONBOARDING_PRIMARY_CTA_CLASS,
  OnboardingChrome,
} from "./OnboardingChrome";
import { OnboardingFooter, OnboardingFooterProvider } from "./OnboardingFooter";

function isRelayMembershipDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("You must be a relay member") ||
    error.message.includes("relay_membership_required") ||
    error.message.includes("restricted: not a relay member") ||
    error.message.includes("invalid: you are not a relay member")
  );
}

/** Fade duration for the "entering" curtain over the mounting app. */
const ENTERING_CURTAIN_FADE_MS = 500;
/**
 * Safety valve: if Welcome never reports ready (slow relay, failed query),
 * fade anyway rather than stranding the user on the onboarding screen.
 */
const ENTERING_CURTAIN_MAX_WAIT_MS = 8_000;

const NEUTRAL_EMOJI_PICKER_THEME_VARS = {
  "--buzz-emoji-picker-rgb-background":
    "var(--buzz-onboarding-emoji-picker-background)",
  "--buzz-emoji-picker-rgb-color": "var(--buzz-onboarding-emoji-picker-color)",
  "--buzz-emoji-picker-rgb-input": "var(--buzz-onboarding-emoji-picker-input)",
} as React.CSSProperties;

function AvatarCircle({
  avatarUrl,
  onClick,
  previewName,
  triggerRef,
}: {
  avatarUrl: string;
  onClick: () => void;
  previewName: string;
  triggerRef?: React.Ref<HTMLButtonElement>;
}) {
  const emojiAvatar = parseEmojiAvatarDataUrl(avatarUrl);
  const presentation = useAvatarPresentation(avatarUrl);
  const hasAvatar =
    avatarUrl.trim().length > 0 && presentation?.state !== "failed";

  return (
    <button
      aria-label={hasAvatar ? "Change your avatar" : "Add an avatar"}
      className="group block shrink-0 rounded-full"
      data-testid="community-avatar-open"
      onClick={onClick}
      ref={triggerRef}
      type="button"
    >
      {emojiAvatar ? (
        <span
          className="flex h-36 w-36 items-center justify-center overflow-hidden rounded-full text-5xl shadow-xs"
          style={{ backgroundColor: emojiAvatar.color }}
        >
          {emojiAvatar.emoji}
        </span>
      ) : hasAvatar ? (
        <ProfileAvatar
          avatarUrl={avatarUrl}
          className="h-36 w-36 rounded-full text-4xl"
          label={previewName}
          testId="community-avatar-circle"
        />
      ) : (
        <span
          className="flex h-36 w-36 items-center justify-center rounded-full bg-white/30 text-[var(--buzz-onboarding-backup-ink)] transition-colors group-hover:bg-white/40"
          data-testid="community-avatar-empty"
        >
          <Plus className="h-7 w-7" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

function LoadingDots({ label }: { label: string }) {
  return (
    <span
      aria-label={label}
      className="inline-flex items-center justify-center gap-1"
      data-testid="community-team-intro-loading-dots"
      role="status"
    >
      {[0, 1, 2].map((index) => (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-none"
          key={index}
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </span>
  );
}

export function CommunityOnboardingFlow({
  onCancel,
  onConnect,
}: {
  onCancel: () => void;
  onConnect: () => void;
}) {
  const { transaction, update, clear } = useCommunityOnboarding();
  const queryClient = useQueryClient();
  const systemColorScheme = useSystemColorScheme();
  const [displayName, setDisplayName] = React.useState("");
  const [avatarUrl, setAvatarUrl] = React.useState("");
  const avatarPresentation = useAvatarPresentation(avatarUrl);
  const [isUploadingAvatar, setIsUploadingAvatar] = React.useState(false);
  const [isAvatarEditorOpen, setIsAvatarEditorOpen] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);
  const checkedProfileTransactionRef = React.useRef<string | null>(null);
  const [starterChannelFailureCount, setStarterChannelFailureCount] =
    React.useState(0);
  const [deniedPubkey, setDeniedPubkey] = React.useState("");
  const [isMembershipDenied, setIsMembershipDenied] = React.useState(false);
  const [isCommunityChangeOpen, setIsCommunityChangeOpen] =
    React.useState(false);
  const [isCurtainFading, setIsCurtainFading] = React.useState(false);
  const [provisioningStage, setProvisioningStage] = React.useState<
    WelcomeProvisioningStage | "idle"
  >("idle");
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);
  const avatarTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const avatarEditorContentRef = React.useRef<HTMLDivElement | null>(null);
  const [avatarEditorDialogHeight, setAvatarEditorDialogHeight] =
    React.useState<number | null>(null);

  useClaimInvite();

  React.useEffect(() => {
    if (transaction?.stage === "connecting") onConnect();
  }, [onConnect, transaction?.stage]);

  // "Entering" curtain: the app is mounting on the Welcome route underneath.
  // Fade out when Welcome reports its first settled render — or after a
  // safety timeout so a slow load can never strand the user on this screen.
  const isEnteringStage = transaction?.stage === "entering";
  React.useEffect(() => {
    if (!isEnteringStage) return;

    let fadeTimer: number | null = null;
    const beginFade = () => {
      if (fadeTimer !== null) return;
      setIsCurtainFading(true);
      fadeTimer = window.setTimeout(() => {
        clear();
      }, ENTERING_CURTAIN_FADE_MS);
    };

    window.addEventListener(WELCOME_SURFACE_READY_EVENT, beginFade);
    const safetyTimer = window.setTimeout(
      beginFade,
      ENTERING_CURTAIN_MAX_WAIT_MS,
    );
    return () => {
      window.removeEventListener(WELCOME_SURFACE_READY_EVENT, beginFade);
      window.clearTimeout(safetyTimer);
      if (fadeTimer !== null) window.clearTimeout(fadeTimer);
    };
  }, [clear, isEnteringStage]);

  const retry = () =>
    update({
      stage: transaction?.inviteCode ? "claiming" : "connecting",
      error: undefined,
    });
  const relayUrl = transaction?.relayUrl;
  const isAirHopOwnerFirstRun = transaction
    ? shouldUseAirHopOwnerFirstRunSurface(transaction.source)
    : false;
  const finish = React.useCallback(async () => {
    if (!relayUrl) return;
    const identity = await getIdentity();
    markCommunityOnboardingComplete(identity.pubkey, relayUrl);
    clear();
  }, [clear, relayUrl]);
  const provisionWelcome = React.useCallback(async () => {
    if (!relayUrl) return;
    const identity = await getIdentity();
    const membershipLookup = await getMyRelayMembershipLookup();
    const result = await initializeStarterChannels(queryClient, {
      focus: true,
      pubkey: identity.pubkey,
      communityScope: relayUrl,
      eligibility: welcomeProvisioningEligibility(membershipLookup),
      onProgress: setProvisioningStage,
    });
    if (!result.ok) throw new Error(result.reason);
    if (result.focusChannelId) {
      // Direct entry: point the router at the Welcome channel *before* the
      // app mounts, so it never lands on Home first. Consume the pending
      // entry — it exists for the Home-route fallback, and leaving it would
      // yank a later Home visit back to Welcome.
      takePendingWelcomeChannelForDirectEntry();
      window.location.hash = `/channels/${result.focusChannelId}`;
      markCommunityOnboardingComplete(identity.pubkey, relayUrl);
      // Keep this screen mounted as a curtain over the loading app; the
      // "entering" stage fades it out once Welcome reports ready.
      update({ stage: "entering", error: undefined });
      return;
    }
    await finish();
  }, [finish, queryClient, relayUrl, update]);
  const finalize = React.useCallback(async () => {
    if (isPending || !relayUrl) return;
    setIsPending(true);
    update({ stage: "finalizing", error: undefined });
    try {
      await provisionWelcome();
    } catch (error) {
      setStarterChannelFailureCount((count) => count + 1);
      update({
        error: isAirHopOwnerFirstRun
          ? airHopOwnerError(loadAirHopOwnerLocale() ?? "en-US", error)
          : error instanceof Error
            ? error.message
            : String(error),
      });
      setIsPending(false);
    }
  }, [isAirHopOwnerFirstRun, isPending, provisionWelcome, relayUrl, update]);

  const backToProfile = React.useCallback(() => {
    if (isPending) return;
    setStarterChannelFailureCount(0);
    update({ stage: "profile", error: undefined });
  }, [isPending, update]);

  const isProfileStage = transaction?.stage === "profile";
  React.useEffect(() => {
    if (!isProfileStage || !transaction) return;
    if (checkedProfileTransactionRef.current === transaction.id) return;

    checkedProfileTransactionRef.current = transaction.id;
    void getProfile()
      .then((profile) => {
        if (profile.hasProfileEvent) {
          if (shouldEnterWelcomeAfterOwnerProfile(transaction.source)) {
            void finalize();
          } else {
            update({ stage: "team-intro", error: undefined }, transaction.id);
          }
        }
      })
      .catch(() => {
        // Discovery is best-effort. Staying on the profile step preserves the
        // existing path when the relay cannot answer the lookup.
      });
  }, [finalize, isProfileStage, transaction, update]);
  const isTeamStage =
    transaction?.stage === "team-intro" ||
    transaction?.stage === "finalizing" ||
    transaction?.stage === "entering";

  // Seed display name and avatar from the relay profile when the profile step
  // is shown. This covers the case where the skip raced or was bypassed (e.g.,
  // the user navigated Back). Only seeds fields that are still empty so that
  // any user edits are preserved.
  React.useEffect(() => {
    if (!isProfileStage) return;
    void getProfile()
      .then((profile) => {
        if (profile.displayName) {
          setDisplayName((prev) =>
            prev === "" ? (profile.displayName ?? "") : prev,
          );
        }
        if (profile.avatarUrl) {
          setAvatarUrl((prev) =>
            prev === "" ? (profile.avatarUrl ?? "") : prev,
          );
        }
      })
      .catch(() => {
        // Seeding is best-effort; silently ignore failures.
      });
  }, [isProfileStage]);

  React.useLayoutEffect(() => {
    if (isProfileStage && !isAvatarEditorOpen) {
      nameInputRef.current?.focus();
    }
  }, [isAvatarEditorOpen, isProfileStage]);

  React.useLayoutEffect(() => {
    if (!isAvatarEditorOpen) {
      setAvatarEditorDialogHeight(null);
      return;
    }

    const content = avatarEditorContentRef.current;
    if (!content) return;

    const updateHeight = () => {
      setAvatarEditorDialogHeight(content.getBoundingClientRect().height + 64);
    };
    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(content);
    return () => resizeObserver.disconnect();
  }, [isAvatarEditorOpen]);

  if (!transaction) return null;
  const ownerLocale = loadAirHopOwnerLocale() ?? "en-US";
  const ownerCopy = airHopOwnerCopy(ownerLocale);

  if (isMembershipDenied) {
    return (
      <>
        <MembershipDenied
          activeRelayUrl={transaction.relayUrl}
          onBack={() => setIsMembershipDenied(false)}
          onChangeCommunity={() => setIsCommunityChangeOpen(true)}
          onImportKey={async (nsec) => {
            const identity = await importIdentity(nsec);
            relayClient.disconnect();
            queryClient.setQueryData(["identity"], identity);
            queryClient.removeQueries({ queryKey: profileQueryKey });
            setIsMembershipDenied(false);
            update({ stage: "connecting", error: undefined });
          }}
          onRetry={() => {
            setIsMembershipDenied(false);
            update({ stage: "connecting", error: undefined });
          }}
          pubkey={deniedPubkey}
        />
        {isCommunityChangeOpen ? (
          <CommunityChangeOverlay
            onClose={() => setIsCommunityChangeOpen(false)}
            onUpdated={(communityName, updatedRelayUrl) => {
              update({
                communityName,
                relayUrl: updatedRelayUrl,
                stage: "connecting",
                error: undefined,
              });
              setIsMembershipDenied(false);
            }}
          />
        ) : null}
      </>
    );
  }

  const saveProfile = async () => {
    if (!displayName.trim()) return;
    let preparingWelcome = false;
    setIsPending(true);
    try {
      const candidateAvatarUrl = avatarUrl.trim();
      const presentationState = avatarPresentation?.state;
      const shouldSaveCandidate =
        candidateAvatarUrl.length > 0 &&
        presentationState !== "failed" &&
        presentationState !== "pending";

      const deferredAvatar =
        candidateAvatarUrl && presentationState && presentationState !== "ready"
          ? registerAvatarWhenReady({
              avatarUrl: candidateAvatarUrl,
              relayUrl: transaction.relayUrl,
            })
          : null;

      try {
        const profile = await updateProfile({
          displayName: displayName.trim(),
          avatarUrl: shouldSaveCandidate ? candidateAvatarUrl : undefined,
        });
        deferredAvatar?.release({
          expectedPubkey: profile.pubkey,
          expectedAvatarUrl: profile.avatarUrl,
        });
      } catch (error) {
        deferredAvatar?.cancel();
        throw error;
      }
      if (shouldEnterWelcomeAfterOwnerProfile(transaction.source)) {
        preparingWelcome = true;
        update({ stage: "finalizing", error: undefined });
        await provisionWelcome();
      } else {
        update({ stage: "team-intro", error: undefined });
      }
    } catch (error) {
      if (isRelayMembershipDeniedError(error)) {
        try {
          const identity = await getIdentity();
          setDeniedPubkey(identity.pubkey);
        } catch {
          setDeniedPubkey("");
        }
        setIsMembershipDenied(true);
        return;
      }
      if (preparingWelcome) {
        setStarterChannelFailureCount((count) => count + 1);
      }
      update({
        stage: "profile",
        error: isAirHopOwnerFirstRun
          ? airHopOwnerError(ownerLocale, error)
          : error instanceof Error
            ? error.message
            : String(error),
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      className={cn(
        isAirHopOwnerFirstRun
          ? "relative isolate flex h-dvh items-center justify-center overflow-y-auto bg-slate-950 px-4 py-10 text-white sm:px-8"
          : "buzz-onboarding-neutral-theme buzz-startup-shell flex h-dvh justify-center overflow-y-auto px-4 text-foreground",
        !isAirHopOwnerFirstRun && (isProfileStage || isTeamStage)
          ? "items-start pb-36 pt-[106px]"
          : "items-stretch",
        isCurtainFading &&
          "pointer-events-none opacity-0 transition-opacity ease-out motion-reduce:transition-none",
      )}
      data-system-color-scheme={systemColorScheme}
      data-testid="community-onboarding-flow"
      style={
        isCurtainFading
          ? { transitionDuration: `${ENTERING_CURTAIN_FADE_MS}ms` }
          : undefined
      }
    >
      <StartupWindowDragRegion />
      {isAirHopOwnerFirstRun ? (
        <>
          <img
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            data-testid="airhop-owner-profile-background"
            src={AIRHOP_OWNER_BACKGROUND_PATH}
          />
          <div className="absolute inset-0 bg-slate-950/45 backdrop-saturate-125" />
        </>
      ) : null}
      {!isAirHopOwnerFirstRun && (isProfileStage || isTeamStage) ? (
        <OnboardingChrome current={isTeamStage ? 7 : 6} />
      ) : null}
      <OnboardingFooterProvider docked={!isAirHopOwnerFirstRun}>
        <div
          className={cn(
            "relative w-full text-center",
            isAirHopOwnerFirstRun
              ? "z-10 my-auto flex max-w-md flex-col items-center rounded-3xl border border-white/25 bg-slate-950/72 p-6 text-white shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8"
              : isProfileStage
                ? "buzz-onboarding-step-frame flex max-w-[500px] flex-col items-center"
                : isTeamStage
                  ? "buzz-onboarding-step-frame flex max-w-[760px] flex-col items-center"
                  : "flex min-h-dvh max-w-[560px] flex-col justify-center py-8",
          )}
          data-testid="community-onboarding-body"
        >
          {isAirHopOwnerFirstRun ? (
            <AirHopMark
              className="mx-auto size-16 drop-shadow-lg"
              decorative={false}
            />
          ) : null}
          {transaction.stage === "claiming" ||
          transaction.stage === "connecting" ? (
            <>
              {!isAirHopOwnerFirstRun ? (
                <Users className="mx-auto h-10 w-10" />
              ) : null}
              <h1
                className={cn(
                  "text-title font-normal",
                  isAirHopOwnerFirstRun ? "mt-6 text-white" : "mt-5",
                )}
              >
                {isAirHopOwnerFirstRun
                  ? transaction.stage === "claiming"
                    ? ownerCopy.checkingCode
                    : ownerCopy.connecting
                  : `Connecting to ${transaction.communityName}`}
              </h1>
              <p
                className={cn(
                  "mt-3 text-sm",
                  isAirHopOwnerFirstRun
                    ? "text-white/70"
                    : "text-foreground/80",
                )}
              >
                {transaction.error ??
                  (isAirHopOwnerFirstRun
                    ? transaction.stage === "claiming"
                      ? ownerCopy.checkingCode
                      : ownerCopy.connecting
                    : transaction.stage === "claiming"
                      ? "Verifying your code…"
                      : "Connecting securely…")}
              </p>
              <div className="mt-6 flex justify-center gap-3">
                {transaction.error ? (
                  <Button className="rounded-full px-6" onClick={retry}>
                    {isAirHopOwnerFirstRun ? ownerCopy.retry : "Retry"}
                  </Button>
                ) : null}
                <Button
                  className="rounded-full bg-foreground/10 px-5 hover:bg-foreground/15"
                  onClick={onCancel}
                  variant="ghost"
                >
                  {isAirHopOwnerFirstRun ? ownerCopy.back : "Cancel"}
                </Button>
              </div>
            </>
          ) : isProfileStage ? (
            <>
              <div
                className={cn(
                  "flex min-h-0 w-full flex-1 flex-col transition-[filter,opacity] duration-200 ease-out",
                  isAvatarEditorOpen &&
                    "pointer-events-none opacity-45 blur-[3px]",
                )}
                data-testid="community-profile-main"
              >
                <div className="shrink-0">
                  <h1
                    className={cn(
                      "text-title font-normal",
                      isAirHopOwnerFirstRun && "mt-6 text-white",
                    )}
                  >
                    {isAirHopOwnerFirstRun
                      ? ownerCopy.profileTitle
                      : "Build your profile"}
                  </h1>
                  <p
                    className={cn(
                      "mx-auto mt-3 max-w-[380px] text-sm leading-6",
                      isAirHopOwnerFirstRun
                        ? "text-white/70"
                        : "text-foreground/80",
                    )}
                  >
                    {isAirHopOwnerFirstRun
                      ? ownerCopy.profileHint
                      : "Add a name and avatar. They’ll show up on your messages, reactions, and agent handoffs."}
                  </p>
                </div>
                <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center pt-8">
                  <AvatarCircle
                    avatarUrl={avatarUrl}
                    onClick={() => setIsAvatarEditorOpen(true)}
                    previewName={displayName.trim() || "Your profile"}
                    triggerRef={avatarTriggerRef}
                  />
                  <label
                    className="mt-7 block w-full max-w-[412px] text-left"
                    htmlFor="community-display-name"
                  >
                    <span
                      className={cn(
                        "mb-2 block pl-4 text-sm",
                        isAirHopOwnerFirstRun
                          ? "text-white"
                          : "text-foreground",
                      )}
                    >
                      {isAirHopOwnerFirstRun
                        ? ownerCopy.nameLabel
                        : "Your username"}
                    </span>
                    <Input
                      aria-label={
                        isAirHopOwnerFirstRun
                          ? ownerCopy.nameLabel
                          : "Community username"
                      }
                      autoCapitalize="none"
                      autoComplete="username"
                      autoCorrect="off"
                      className={cn(
                        "h-14 rounded-2xl px-5 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-inset md:text-sm",
                        isAirHopOwnerFirstRun
                          ? "border-white/20 bg-white/10 text-white placeholder:text-white/35 focus-visible:ring-white/50"
                          : "border-[color:rgb(var(--buzz-onboarding-avatar-control-fg)_/_0.28)] bg-[rgb(var(--buzz-onboarding-avatar-dialog-bg)/0.95)] placeholder:text-muted-foreground/60 focus-visible:ring-[color:rgb(var(--buzz-onboarding-avatar-control-fg)_/_0.5)]",
                      )}
                      data-testid="community-profile-name-key"
                      disabled={isPending || isUploadingAvatar}
                      id="community-display-name"
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder={
                        isAirHopOwnerFirstRun
                          ? ownerCopy.namePlaceholder
                          : "Enter your username here"
                      }
                      ref={nameInputRef}
                      spellCheck={false}
                      type="text"
                      value={displayName}
                    />
                  </label>
                </div>
                {transaction.error ? (
                  <p className="mt-4 text-sm text-destructive">
                    {transaction.error}
                  </p>
                ) : null}
              </div>
              <OnboardingFooter
                className={cn(
                  "transition-[filter,opacity] duration-200 ease-out",
                  isAirHopOwnerFirstRun && "mt-7",
                  isAvatarEditorOpen &&
                    "pointer-events-none opacity-45 blur-[3px]",
                )}
              >
                <Button
                  className={
                    isAirHopOwnerFirstRun
                      ? "h-12 w-full rounded-xl bg-white text-slate-950 shadow-none hover:bg-white/90"
                      : `${ONBOARDING_PRIMARY_CTA_CLASS} w-20`
                  }
                  data-testid="community-profile-next"
                  disabled={
                    !displayName.trim() || isPending || isUploadingAvatar
                  }
                  onClick={() => void saveProfile()}
                  type="button"
                >
                  {isAirHopOwnerFirstRun ? ownerCopy.next : "Next"}
                </Button>
                <Button
                  className={
                    isAirHopOwnerFirstRun
                      ? "h-10 w-full rounded-xl text-white/65 shadow-none hover:bg-white/10 hover:text-white"
                      : "h-9 w-20 rounded-full bg-foreground/10 px-6 hover:bg-foreground/15"
                  }
                  data-testid="community-profile-back"
                  disabled={isPending || isUploadingAvatar}
                  onClick={onCancel}
                  type="button"
                  variant="ghost"
                >
                  {isAirHopOwnerFirstRun ? ownerCopy.back : "Back"}
                </Button>
              </OnboardingFooter>
              <Dialog
                onOpenChange={(open) => setIsAvatarEditorOpen(open)}
                open={isAvatarEditorOpen}
              >
                <DialogContent
                  className="buzz-onboarding-neutral-theme w-[min(calc(100vw-2rem),560px)] max-w-[560px] gap-0 overflow-hidden rounded-[18px] bg-[rgb(var(--buzz-onboarding-avatar-dialog-bg))] px-8 pb-6 pt-10 text-sm text-foreground shadow-[0_28px_90px_rgb(var(--buzz-onboarding-avatar-dialog-shadow)_/_0.28),0_8px_28px_rgb(var(--buzz-onboarding-avatar-dialog-shadow)_/_0.18)] transition-[height] duration-[250ms] ease-out"
                  closeButtonClassName="right-6 top-6 h-10 w-10 rounded-full bg-[rgb(var(--buzz-onboarding-avatar-action-bg))] text-[rgb(var(--buzz-onboarding-avatar-action-fg))] hover:bg-[rgb(var(--buzz-onboarding-avatar-action-bg)/0.9)] hover:text-[rgb(var(--buzz-onboarding-avatar-action-fg))]"
                  data-system-color-scheme="light"
                  data-testid="community-avatar-editor-key-frame"
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    avatarTriggerRef.current?.focus();
                  }}
                  overlayVariant="transparent"
                  style={
                    avatarEditorDialogHeight === null
                      ? undefined
                      : { height: avatarEditorDialogHeight }
                  }
                >
                  <DialogTitle className="sr-only">
                    Edit your avatar
                  </DialogTitle>
                  <div ref={avatarEditorContentRef}>
                    <ProfileAvatarEditor
                      avatarUrl={avatarUrl}
                      disabled={isPending}
                      donePending={isUploadingAvatar}
                      emojiPickerTheme="auto"
                      emojiPickerThemeVars={NEUTRAL_EMOJI_PICKER_THEME_VARS}
                      onDone={() => setIsAvatarEditorOpen(false)}
                      onUploadingChange={setIsUploadingAvatar}
                      onUrlChange={setAvatarUrl}
                      presentation="onboarding-modal"
                      previewName={displayName.trim() || "Your profile"}
                      testIdPrefix="community-avatar"
                    />
                  </div>
                </DialogContent>
              </Dialog>
            </>
          ) : isAirHopOwnerFirstRun ? (
            <div className="mt-6 grid justify-items-center gap-4 py-8">
              <LoadingDots label={ownerCopy.connecting} />
              <p className="text-sm text-white/70">{ownerCopy.connecting}</p>
            </div>
          ) : (
            <>
              <h1 className="text-title font-normal">Meet your starter team</h1>
              <p className="mx-auto mt-3 max-w-[400px] text-sm leading-6 text-foreground/80">
                AirHop lets you bring multiple agents into the same workspace.
                Your team will help you get started using AirHop.
              </p>
              <div className="flex w-full flex-1 items-center justify-center py-10">
                <div className="flex flex-wrap justify-center gap-8">
                  {WELCOME_TEAM_PRESENTATIONS.map((character) => {
                    const roleName = welcomeRoleDefinition(
                      character.role,
                      "en",
                    ).name;
                    return (
                      <div
                        className="flex w-40 flex-col items-center gap-3"
                        key={character.role}
                      >
                        <img
                          alt={`${roleName} animated character`}
                          className="h-40 w-40 object-contain"
                          data-testid={`starter-persona-${character.role.replaceAll("_", "-")}`}
                          src={character.animationUrl}
                        />
                        <span className="font-mono text-xs font-medium uppercase tracking-[0.15em]">
                          {roleName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {transaction.error ? (
                <p className="text-sm text-destructive">
                  {transaction.error}
                  {starterChannelFailureCount === 1 ? " Try again." : null}
                </p>
              ) : null}
              <OnboardingFooter>
                <Button
                  className={ONBOARDING_PRIMARY_CTA_CLASS}
                  data-testid="community-team-intro-enter"
                  disabled={isPending || transaction.stage === "entering"}
                  data-provisioning-stage={provisioningStage}
                  onClick={() =>
                    void (starterChannelFailureCount >= 2
                      ? finish()
                      : finalize())
                  }
                >
                  {isPending || transaction.stage === "entering" ? (
                    <LoadingDots label="Preparing Welcome" />
                  ) : starterChannelFailureCount >= 2 ? (
                    "Skip for now"
                  ) : (
                    "Take me to Airhop"
                  )}
                </Button>
                <Button
                  className="h-9 rounded-full bg-foreground/10 px-5 hover:bg-foreground/15"
                  data-testid="community-team-intro-back"
                  disabled={isPending || transaction.stage === "entering"}
                  onClick={backToProfile}
                  variant="ghost"
                >
                  Back
                </Button>
              </OnboardingFooter>
            </>
          )}
        </div>
      </OnboardingFooterProvider>
    </div>
  );
}
