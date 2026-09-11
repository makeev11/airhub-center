import {
  publicBookingDraftKey,
  readPublicBookingDraft,
  writePublicBookingDraft,
} from "../lib/publicBookingDraft";
import { publicBookingAgeNotice } from "../lib/publicBookingAgeNotice";
import { PublicBookingContactFields } from "./PublicBookingContactFields";
import { ArrowLeft, MapPin, UsersRound } from "lucide-react";
import * as React from "react";
import { usePublicBookingService } from "@/features/booking/data/PublicBookingProvider";
import {
  PublicBookingUnavailableError,
  PublicBookingValidationError,
  type PublicBookingCatalog,
  type PublicBookingManagementCard,
} from "@/features/booking/data/publicBookingService";
import { formatBookingAgeRange } from "@/features/booking/lib/bookingLocale";
import {
  formatPublicOccurrenceDateTime,
  formatPublicTrialPolicy,
  getPublicBookingMessages,
} from "@/features/booking/lib/publicBookingLocale";
import type { PublicBookingOccurrence } from "@/features/booking/lib/publicBookingAvailability";
import type {
  PreferredContactChannel,
  PublicBookingAppearance,
  PublicBookingPurpose,
} from "@/features/booking/model/bookingCore";
import {
  stableLessonReferenceKey,
  validatePublicApplicantDraft,
  type PublicApplicantDraft,
  type PublicApplicantValidationIssue,
} from "@/features/booking/model/publicBooking";
import {
  PublicBookingBranchContext,
  PublicBookingFooter,
  PublicBookingHeader,
  SummaryRow,
} from "@/features/booking/ui/PublicBookingFlowParts";
import { PublicBookingShell } from "@/features/booking/ui/PublicBookingShell";
import {
  parsePublicAge,
  resolvePublicInitialContext,
} from "@/features/booking/ui/publicBookingFlowState";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { cn } from "@/shared/lib/cn";
import {
  PublicBookingAgeSelector,
  PublicBookingBranchSelector,
} from "@/features/booking/ui/PublicBookingBasics";
import { PublicBookingSuccess } from "@/features/booking/ui/PublicBookingSuccess";
import { useBookingHandoffStatus } from "@/features/booking/ui/useBookingHandoffStatus";
import { usePublicBookingAnalytics } from "@/features/booking/ui/usePublicBookingAnalytics";
type FlowStep = "basics" | "groups" | "occurrences" | "contact" | "preview";
type FlowError = "slot_unavailable" | "load_failed" | "generic" | null;
export type PublicBookingInitialContext = {
  branchId?: string;
  groupId?: string;
  birthYear?: number;
  birthMonth?: number;
  ageYears?: number;
};
export type PublicBookingWidgetConfiguration = {
  purpose?: PublicBookingPurpose;
  appearance?: PublicBookingAppearance;
};
const STEP_NUMBER: Record<FlowStep, number> = {
  basics: 1,
  groups: 2,
  occurrences: 3,
  contact: 4,
  preview: 5,
};
const INITIAL_APPLICANT: PublicApplicantDraft = {
  parentName: "",
  parentLastName: "",
  phone: "",
  childName: "",
  childBirthDate: "",
  consentAccepted: false,
};
export function PublicBookingFlow({
  configuration,
  initialContext = {},
  mode,
}: {
  configuration?: PublicBookingWidgetConfiguration;
  initialContext?: PublicBookingInitialContext;
  mode: "standalone" | "embedded";
}) {
  const service = usePublicBookingService();
  const [initialValues] = React.useState(() => ({
    context: initialContext,
    ageYears:
      initialContext.ageYears === undefined
        ? ""
        : String(initialContext.ageYears),
    branchId: initialContext.branchId ?? "",
    groupId: initialContext.groupId ?? "",
  }));
  const [catalog, setCatalog] = React.useState<PublicBookingCatalog | null>(
    null,
  );
  const [step, setStep] = React.useState<FlowStep>("basics");
  const [ageYears, setAgeYears] = React.useState(initialValues.ageYears);
  const [branchId, setBranchId] = React.useState(initialValues.branchId);
  const [branchPickerOpen, setBranchPickerOpen] = React.useState(
    !initialValues.branchId,
  );
  const [branchOccurrences, setBranchOccurrences] = React.useState<
    PublicBookingOccurrence[]
  >([]);
  const [isLoadingBranches, setIsLoadingBranches] = React.useState(true);
  const [occurrences, setOccurrences] = React.useState<
    PublicBookingOccurrence[]
  >([]);
  const [groupId, setGroupId] = React.useState(initialValues.groupId);
  const [lessonKey, setLessonKey] = React.useState("");
  const [applicant, setApplicant] =
    React.useState<PublicApplicantDraft>(INITIAL_APPLICANT);
  const [applicantIssues, setApplicantIssues] = React.useState<
    PublicApplicantValidationIssue[]
  >([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [flowError, setFlowError] = React.useState<FlowError>(null);
  const [contextFallback, setContextFallback] = React.useState(false);
  const [success, setSuccess] = React.useState<{
    token: string | null;
    card: PublicBookingManagementCard;
  } | null>(null);
  const [isSavingChannel, setIsSavingChannel] = React.useState(false);
  const [channelError, setChannelError] = React.useState(false);
  const {
    context: analytics,
    startNewJourney,
    trackStepCompleted,
    trackSubmit,
  } = usePublicBookingAnalytics({ branchId, mode, step });
  useBookingHandoffStatus(service, success, setSuccess);
  const draftKeyRef = React.useRef<string | null>(null);
  const draftReadyRef = React.useRef(false);
  const idempotencyKeyRef = React.useRef<string>(crypto.randomUUID());
  const flowRef = React.useRef<HTMLElement>(null);
  const catalogRequestRef = React.useRef<{
    service: typeof service;
    promise: Promise<PublicBookingCatalog>;
  } | null>(null);
  // Public copy currently supports Russian; dates and ages use the same fallback.
  const locale = "ru-RU";
  const messages = getPublicBookingMessages(locale);
  const purpose =
    configuration?.purpose ??
    catalog?.organization.publicBooking?.purpose ??
    "trial";
  const appearance =
    configuration?.appearance ??
    catalog?.organization.publicBooking?.appearance ??
    "automatic";

  React.useEffect(() => {
    if (step && flowRef.current) flowRef.current.scrollTop = 0;
  }, [step]);

  const loadOccurrences = React.useCallback(
    async (
      nextBranchId: string,
      nextAgeYears: string,
      nextPurpose: PublicBookingPurpose = purpose,
    ) => {
      const parsedAge = parsePublicAge(nextAgeYears);
      if (parsedAge === null || !nextBranchId) return [];
      return service.findOccurrences({
        branchId: nextBranchId,
        purpose: nextPurpose,
      });
    },
    [purpose, service],
  );

  React.useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const request =
          catalogRequestRef.current?.service === service
            ? catalogRequestRef.current
            : {
                service,
                promise: service.getCatalog(),
              };
        catalogRequestRef.current = request;
        const nextCatalog = await request.promise;
        if (cancelled) return;
        setCatalog(nextCatalog);
        const nextPurpose =
          configuration?.purpose ??
          nextCatalog.organization.publicBooking?.purpose ??
          "trial";
        const draftKey = publicBookingDraftKey(
          nextCatalog.organization.id,
          nextPurpose,
          initialValues.context,
        );
        draftKeyRef.current = draftKey;
        const draft = readPublicBookingDraft(draftKey);
        if (draft) {
          setApplicant(draft.applicant);
          idempotencyKeyRef.current = draft.idempotencyKey;
          if (draft.managementToken) {
            const card = await service.getManagementCard(draft.managementToken);
            if (cancelled) return;
            if (card) {
              setSuccess({ token: draft.managementToken, card });
              draftReadyRef.current = true;
              return;
            }
          }
        }
        const resolvedContext = resolvePublicInitialContext(
          draft
            ? {
                branchId: draft.branchId,
                groupId: draft.groupId,
                ...(draft.ageYears !== ""
                  ? { ageYears: Number(draft.ageYears) }
                  : {}),
              }
            : initialValues.context,
          nextCatalog.branches.map((branch) => branch.id),
          nextCatalog.organization.currentDate,
        );
        setBranchId(resolvedContext.branchId);
        setAgeYears(resolvedContext.ageYears);
        setBranchPickerOpen(!resolvedContext.branchId);
        setGroupId(resolvedContext.groupId);
        setContextFallback(resolvedContext.contextFallback);
        if (!resolvedContext.canLoadOccurrences || draft?.step === "basics") {
          draftReadyRef.current = true;
          setStep("basics");
          return;
        }
        const nextOccurrences = await loadOccurrences(
          resolvedContext.branchId,
          resolvedContext.ageYears,
          nextPurpose,
        );
        if (cancelled) return;
        setOccurrences(nextOccurrences);
        const validGroup = nextOccurrences.some(
          (occurrence) => occurrence.groupId === resolvedContext.groupId,
        );
        if (resolvedContext.groupId && !validGroup) setContextFallback(true);
        const restoredOccurrence =
          draft &&
          nextOccurrences.find(
            (occurrence) =>
              stableLessonReferenceKey(occurrence.lessonRef) ===
                draft.lessonKey &&
              occurrence.groupId === resolvedContext.groupId &&
              occurrence.available,
          );
        if (restoredOccurrence) setLessonKey(draft.lessonKey);
        if (
          validGroup &&
          restoredOccurrence &&
          (draft.step === "contact" || draft.step === "preview")
        ) {
          setLessonKey(draft.lessonKey);
          setStep(
            draft.step === "preview" &&
              validatePublicApplicantDraft(
                draft.applicant,
                nextCatalog.organization.currentDate,
              ).length === 0
              ? "preview"
              : "contact",
          );
        } else if (validGroup)
          setStep(draft?.step === "groups" ? "groups" : "occurrences");
        else {
          setGroupId("");
          setStep("groups");
        }
        draftReadyRef.current = true;
      } catch {
        if (!cancelled) setFlowError("load_failed");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [configuration?.purpose, initialValues, loadOccurrences, service]);

  React.useEffect(() => {
    if (!catalog) return;
    let cancelled = false;
    setIsLoadingBranches(true);
    void service
      .findOccurrences({
        purpose,
      })
      .then((nextOccurrences) => {
        if (!cancelled) setBranchOccurrences(nextOccurrences);
      })
      .catch(() => {
        if (!cancelled) setBranchOccurrences([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBranches(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalog, purpose, service]);

  React.useEffect(() => {
    if (!draftReadyRef.current || !draftKeyRef.current || isLoading) return;
    writePublicBookingDraft(draftKeyRef.current, {
      step,
      branchId,
      groupId,
      ageYears,
      lessonKey,
      applicant,
      idempotencyKey: idempotencyKeyRef.current,
      managementToken: success?.token ?? null,
    });
  }, [
    step,
    branchId,
    groupId,
    ageYears,
    lessonKey,
    applicant,
    success,
    isLoading,
  ]);

  const groups = React.useMemo(() => {
    const byId = new Map<string, PublicBookingOccurrence>();
    for (const occurrence of occurrences) {
      if (!byId.has(occurrence.groupId))
        byId.set(occurrence.groupId, occurrence);
    }
    return [...byId.values()];
  }, [occurrences]);
  const groupOccurrences = occurrences.filter(
    (occurrence) => occurrence.groupId === groupId,
  );
  const selectedOccurrence = occurrences.find(
    (occurrence) =>
      stableLessonReferenceKey(occurrence.lessonRef) === lessonKey,
  );
  const ageNotice = selectedOccurrence
    ? publicBookingAgeNotice(
        selectedOccurrence,
        applicant.childBirthDate,
        Number(ageYears),
        catalog?.organization.currentDate ?? "",
        locale,
      )
    : null;
  const selectedBranch = catalog?.branches.find(
    (branch) => branch.id === branchId,
  );
  const attributionBranchId = catalog?.branches.some(
    (branch) => branch.id === initialValues.branchId,
  )
    ? initialValues.branchId
    : undefined;

  const handleBasics = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!catalog?.branches.some((branch) => branch.id === branchId)) {
      setContextFallback(true);
      return;
    }
    if (parsePublicAge(ageYears) === null) {
      setContextFallback(true);
      return;
    }
    setIsLoading(true);
    setFlowError(null);
    try {
      const nextOccurrences = await loadOccurrences(branchId, ageYears);
      setOccurrences(nextOccurrences);
      setGroupId("");
      setLessonKey("");
      setContextFallback(false);
      trackStepCompleted("basics");
      setStep("groups");
    } catch {
      setFlowError("generic");
    } finally {
      setIsLoading(false);
    }
  };

  const handleContact = (event: React.FormEvent) => {
    event.preventDefault();
    const issues = validatePublicApplicantDraft(
      applicant,
      catalog?.organization.currentDate,
    );
    setApplicantIssues(issues);
    if (issues.length) {
      const fieldByIssue: Record<PublicApplicantValidationIssue, string> = {
        parent_name_required: "public-parent-name",
        parent_last_name_required: "public-parent-last-name",
        phone_invalid: "public-phone",
        child_name_required: "public-child-name",
        birth_date_invalid: "public-child-birth-date",
        birth_date_in_future: "public-child-birth-date",
        consent_required: "public-consent",
      };
      document.getElementById(fieldByIssue[issues[0]])?.focus();
      return;
    }
    setFlowError(null);
    trackStepCompleted("contact");
    setStep("preview");
  };

  const submitBooking = async () => {
    if (!selectedOccurrence || isSubmitting) return;
    setIsSubmitting(true);
    setFlowError(null);
    trackSubmit();
    try {
      const result = await service.createBooking({
        lessonRef: selectedOccurrence.lessonRef,
        applicant,
        idempotencyKey: idempotencyKeyRef.current,
        purpose,
        source: {
          surface: mode,
          ...(attributionBranchId ? { attributionBranchId } : {}),
          analytics,
        },
      });
      setSuccess({ token: result.managementToken, card: result.card });
    } catch (error) {
      if (error instanceof PublicBookingUnavailableError) {
        setFlowError("slot_unavailable");
        const nextOccurrences = await loadOccurrences(branchId, ageYears);
        setOccurrences(nextOccurrences);
        setLessonKey("");
        setStep("occurrences");
      } else if (error instanceof PublicBookingValidationError) {
        setApplicantIssues([...error.issues]);
        setStep("contact");
      } else {
        setFlowError("generic");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const chooseContactChannel = async (channel: PreferredContactChannel) => {
    if (!success?.token || isSavingChannel) return;
    setIsSavingChannel(true);
    setChannelError(false);
    try {
      const card = await service.setPreferredContactChannel(
        success.token,
        channel,
      );
      if (card) {
        setSuccess({ ...success, card });
        if (!card.messengerHandoff && !card.telegramConnected)
          setChannelError(true);
      } else setChannelError(true);
    } catch {
      setChannelError(true);
    } finally {
      setIsSavingChannel(false);
    }
  };

  const startAnotherBooking = async () => {
    const nextAgeYears = mode === "embedded" ? initialValues.ageYears : "";
    const nextBranchId = mode === "embedded" ? initialValues.branchId : "";
    let nextOccurrences: PublicBookingOccurrence[] = [];
    if (nextAgeYears && nextBranchId) {
      try {
        nextOccurrences = await loadOccurrences(nextBranchId, nextAgeYears);
      } catch {
        setFlowError("generic");
      }
    }
    const nextGroupId =
      mode === "embedded" &&
      nextOccurrences.some(
        (occurrence) => occurrence.groupId === initialValues.groupId,
      )
        ? initialValues.groupId
        : "";
    setAgeYears(nextAgeYears);
    setBranchId(nextBranchId);
    setBranchPickerOpen(!nextBranchId);
    setOccurrences(nextOccurrences);
    setGroupId(nextGroupId);
    setLessonKey("");
    setApplicant(INITIAL_APPLICANT);
    setApplicantIssues([]);
    if (nextOccurrences.length || (!nextAgeYears && !nextBranchId)) {
      setFlowError(null);
    }
    setContextFallback(false);
    setSuccess(null);
    startNewJourney();
    setStep(
      nextGroupId
        ? "occurrences"
        : nextAgeYears && nextBranchId
          ? "groups"
          : "basics",
    );
    idempotencyKeyRef.current = crypto.randomUUID();
  };

  if (isLoading && !draftReadyRef.current) {
    return (
      <PublicBookingShell appearance={appearance} mode={mode}>
        <div
          className="flex min-h-80 flex-1 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          {messages.loading}
        </div>
      </PublicBookingShell>
    );
  }

  if (success) {
    return (
      <PublicBookingShell appearance={appearance} mode={mode}>
        <main
          className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto overscroll-contain pb-2"
          data-testid="airhop-public-flow"
        >
          <PublicBookingSuccess
            card={success.card}
            confirmationPreview={service.confirmationPreview}
            channelError={channelError}
            locale={locale}
            isSavingChannel={isSavingChannel}
            managementToken={success.token}
            messages={messages}
            mode={mode}
            onChooseContactChannel={(channel) =>
              void chooseContactChannel(channel)
            }
            onStartAnother={() => void startAnotherBooking()}
            organizationName={catalog?.organization.name ?? messages.brand}
          />
          <PublicBookingFooter messages={messages} />
        </main>
      </PublicBookingShell>
    );
  }

  return (
    <PublicBookingShell appearance={appearance} mode={mode}>
      <PublicBookingHeader
        messages={messages}
        mode={mode}
        organizationName={catalog?.organization.name ?? messages.brand}
        purpose={purpose}
        stepNumber={STEP_NUMBER[step]}
      />

      <main
        className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto overscroll-contain pb-2"
        data-testid="airhop-public-flow"
        ref={flowRef}
      >
        {step !== "basics" && selectedBranch ? (
          <PublicBookingBranchContext
            address={selectedBranch.address}
            branchLabel={messages.branch}
            branchName={selectedBranch.name}
            changeLabel={messages.changeBranch}
            onChange={() => {
              setContextFallback(false);
              setGroupId("");
              setLessonKey("");
              setBranchPickerOpen(true);
              setStep("basics");
            }}
          />
        ) : null}
        {contextFallback ? (
          <Alert className="mb-4">
            <AlertDescription>
              {messages.contextFallbackNotice}
            </AlertDescription>
          </Alert>
        ) : null}
        {flowError ? (
          <Alert className="mb-4" variant="destructive">
            <AlertTitle>
              {flowError === "slot_unavailable"
                ? messages.slotUnavailableTitle
                : flowError === "load_failed"
                  ? messages.loadErrorTitle
                  : messages.genericErrorTitle}
            </AlertTitle>
            <AlertDescription>
              {flowError === "slot_unavailable"
                ? messages.slotUnavailableDescription
                : flowError === "load_failed"
                  ? messages.loadErrorDescription
                  : messages.genericErrorDescription}
            </AlertDescription>
          </Alert>
        ) : null}

        {step === "basics" ? (
          <Card className="min-w-0 bg-card/95 p-5 shadow-sm sm:p-7">
            <h1 className="text-xl font-semibold">{messages.basicsTitle}</h1>
            {messages.basicsDescription ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {messages.basicsDescription}
              </p>
            ) : null}
            <form
              id="public-booking-basics"
              className="mt-6 space-y-5"
              onSubmit={(event) => void handleBasics(event)}
            >
              <PublicBookingBranchSelector
                branchId={branchId}
                branches={catalog?.branches ?? []}
                isLoading={isLoadingBranches}
                messages={messages}
                occurrences={branchOccurrences}
                onOpenChange={setBranchPickerOpen}
                onSelect={(nextBranchId) => {
                  setBranchId(nextBranchId);
                  setBranchPickerOpen(false);
                  setGroupId("");
                  setLessonKey("");
                }}
                open={branchPickerOpen}
              />
              <PublicBookingAgeSelector
                ageYears={ageYears}
                messages={messages}
                onSelect={(age) => {
                  setAgeYears(String(age));
                  setGroupId("");
                  setLessonKey("");
                }}
              />
            </form>
          </Card>
        ) : null}

        {step === "groups" ? (
          <Card className="min-w-0 bg-card/95 p-5 shadow-sm sm:p-7">
            <h1 className="text-xl font-semibold">{messages.groupsTitle}</h1>
            {messages.groupsDescription ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {messages.groupsDescription}
              </p>
            ) : null}
            {groups.length ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {groups.map((group) => {
                  const hasAvailableOccurrence = occurrences.some(
                    (occurrence) =>
                      occurrence.groupId === group.groupId &&
                      occurrence.available,
                  );
                  return (
                    <button
                      aria-pressed={groupId === group.groupId}
                      className={cn(
                        "min-h-11 min-w-0 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                        groupId === group.groupId
                          ? "border-primary bg-primary/10"
                          : "border-border/70 bg-background/70 hover:bg-muted/60",
                      )}
                      data-testid={`airhop-public-group-${group.groupId}`}
                      key={group.groupId}
                      onClick={() => setGroupId(group.groupId)}
                      type="button"
                    >
                      <span className="block text-sm font-semibold">
                        {group.groupName}
                      </span>
                      <span className="mt-2 block text-xs text-muted-foreground">
                        {formatBookingAgeRange({
                          locale,
                          minAgeMonths: group.minAgeMonths,
                          maxAgeMonths: group.maxAgeMonths,
                        })}
                      </span>
                      {group.groupDescription ? (
                        <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                          {group.groupDescription}
                        </span>
                      ) : null}
                      {!hasAvailableOccurrence ? (
                        <span className="mt-3 block text-xs font-semibold text-destructive">
                          {messages.groupFullNotice}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-6 rounded-2xl bg-muted/60 p-5">
                <h3 className="text-sm font-semibold">
                  {messages.noOptionsTitle}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {messages.noOptionsDescription}
                </p>
              </div>
            )}
          </Card>
        ) : null}

        {step === "occurrences" ? (
          <Card className="min-w-0 bg-card/95 p-5 shadow-sm sm:p-7">
            <h1 className="text-xl font-semibold">
              {messages.occurrencesTitle}
            </h1>
            {messages.occurrencesDescription ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {messages.occurrencesDescription}
              </p>
            ) : null}
            <div className="mt-5 space-y-3">
              {groupOccurrences.map((occurrence) => {
                const key = stableLessonReferenceKey(occurrence.lessonRef);
                return (
                  <button
                    aria-disabled={!occurrence.available}
                    aria-pressed={lessonKey === key}
                    className={cn(
                      "grid min-h-11 w-full min-w-0 gap-3 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                      !occurrence.available
                        ? "cursor-not-allowed border-border/50 bg-muted/45 opacity-70"
                        : lessonKey === key
                          ? "border-primary bg-primary/10"
                          : "border-border/70 bg-background/70 hover:bg-muted/60",
                    )}
                    data-testid={`airhop-public-occurrence-${key}`}
                    disabled={!occurrence.available}
                    key={key}
                    onClick={() => setLessonKey(key)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block min-w-0 break-words text-sm font-semibold">
                        {formatPublicOccurrenceDateTime(occurrence, locale)}
                      </span>
                      <span className="mt-2 flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 break-words">
                          {occurrence.branchAddress}
                          {occurrence.roomName
                            ? ` · ${occurrence.roomName}`
                            : ""}
                        </span>
                      </span>
                      <span className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <UsersRound className="h-3.5 w-3.5 shrink-0" />
                        {occurrence.remaining === null
                          ? messages.placesUnlimited
                          : occurrence.remaining === 0
                            ? messages.placesFull
                            : messages.placesRemaining(occurrence.remaining)}
                      </span>
                    </span>
                    {purpose === "trial" ? (
                      <span className="w-fit max-w-full whitespace-normal break-words rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
                        {formatPublicTrialPolicy(
                          occurrence.trialPolicy,
                          locale,
                          messages,
                        )}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Card>
        ) : null}

        {step === "contact" ? (
          <Card className="min-w-0 bg-card/95 p-5 shadow-sm sm:p-7">
            <h1 className="text-xl font-semibold">{messages.contactTitle}</h1>
            {messages.contactDescription ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {messages.contactDescription}
              </p>
            ) : null}
            <form
              id="public-booking-contact"
              className="mt-6 space-y-4"
              onSubmit={handleContact}
            >
              <PublicBookingContactFields
                applicant={applicant}
                setApplicant={setApplicant}
                applicantIssues={applicantIssues}
                messages={messages}
                maximumBirthDate={catalog?.organization.currentDate}
              />
            </form>
          </Card>
        ) : null}

        {step === "preview" && selectedOccurrence && catalog ? (
          <Card
            className="min-w-0 bg-card/95 p-5 shadow-sm sm:p-7"
            data-testid="airhop-public-preview"
          >
            <h1 className="text-xl font-semibold">{messages.previewTitle}</h1>
            {messages.previewDescription ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {messages.previewDescription}
              </p>
            ) : null}
            <dl className="mt-5 rounded-2xl bg-muted/45 px-4">
              <SummaryRow
                label={messages.parentName}
                value={[applicant.parentName, applicant.parentLastName]
                  .filter(Boolean)
                  .join(" ")}
              />
              <SummaryRow label={messages.phone} value={applicant.phone} />
              <SummaryRow
                label={messages.childName}
                value={applicant.childName}
              />
              <SummaryRow
                label={messages.center}
                value={catalog.organization.name}
              />
              <SummaryRow
                label={messages.branch}
                value={selectedOccurrence.branchName}
              />
              <SummaryRow
                label={messages.group}
                value={selectedOccurrence.groupName}
              />
              {ageNotice ? (
                <div
                  className="pb-3 text-xs leading-5 text-muted-foreground"
                  data-testid="airhop-public-age-notice"
                >
                  {ageNotice} Записаться всё равно можно.
                </div>
              ) : null}
              <SummaryRow
                label={messages.dateAndTime}
                value={formatPublicOccurrenceDateTime(
                  selectedOccurrence,
                  locale,
                )}
              />
              <SummaryRow
                label={messages.address}
                value={selectedOccurrence.branchAddress}
              />
              {selectedOccurrence.roomName ? (
                <SummaryRow
                  label={messages.room}
                  value={selectedOccurrence.roomName}
                />
              ) : null}
              {selectedOccurrence.teacherNames.length ? (
                <SummaryRow
                  label={messages.teachers}
                  value={selectedOccurrence.teacherNames.join(", ")}
                />
              ) : null}
              {purpose === "trial" ? (
                <SummaryRow
                  label={messages.trial}
                  value={formatPublicTrialPolicy(
                    selectedOccurrence.trialPolicy,
                    locale,
                    messages,
                  )}
                />
              ) : null}
            </dl>
          </Card>
        ) : null}
        <PublicBookingFooter messages={messages} />
      </main>
      <div
        className="mx-auto flex w-full max-w-3xl shrink-0 gap-2 border-t border-border bg-background pt-3 pb-[env(safe-area-inset-bottom)]"
        data-testid={
          step === "occurrences"
            ? "airhop-public-occurrence-actions"
            : "airhop-public-flow-actions"
        }
      >
        {step !== "basics" ? (
          <Button
            className="min-h-11"
            variant="outline"
            type="button"
            onClick={() =>
              setStep(
                step === "groups"
                  ? "basics"
                  : step === "occurrences"
                    ? "groups"
                    : step === "contact"
                      ? "occurrences"
                      : "contact",
              )
            }
          >
            <ArrowLeft />
            {messages.back}
          </Button>
        ) : null}
        <Button
          key={step}
          className="min-h-11 flex-1"
          type={step === "basics" || step === "contact" ? "submit" : "button"}
          form={
            step === "basics"
              ? "public-booking-basics"
              : step === "contact"
                ? "public-booking-contact"
                : undefined
          }
          disabled={
            step === "basics"
              ? isLoading ||
                !selectedBranch ||
                parsePublicAge(ageYears) === null
              : step === "groups"
                ? !groupId
                : step === "occurrences"
                  ? !selectedOccurrence?.available
                  : step === "preview" && isSubmitting
          }
          data-testid={step === "preview" ? "airhop-public-submit" : undefined}
          onClick={(event) => {
            if (step !== "basics" && step !== "contact") event.preventDefault();
            if (step === "groups") {
              setLessonKey("");
              trackStepCompleted("groups");
              setStep("occurrences");
            } else if (step === "occurrences") {
              setApplicantIssues([]);
              trackStepCompleted("occurrences");
              setStep("contact");
            } else if (step === "preview") void submitBooking();
          }}
        >
          {step === "preview"
            ? isSubmitting
              ? messages.submitting
              : messages.submit
            : messages.continue}
        </Button>
      </div>
    </PublicBookingShell>
  );
}
