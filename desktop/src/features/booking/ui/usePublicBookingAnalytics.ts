import * as React from "react";

import {
  createPublicBookingAnalyticsContext,
  trackPublicSiteAnalytics,
  type PublicSiteAnalyticsStep,
} from "@/features/booking/data/publicSiteAnalytics";

export function usePublicBookingAnalytics({
  branchId,
  mode,
  step,
}: {
  branchId: string;
  mode: "standalone" | "embedded";
  step: PublicSiteAnalyticsStep;
}) {
  const [context, setContext] = React.useState(
    createPublicBookingAnalyticsContext,
  );
  const pageViewTrackedRef = React.useRef(false);
  const openedJourneyRef = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    const includePageView =
      mode === "standalone" &&
      !pageViewTrackedRef.current &&
      !window.__AIRHOP_SITE_ANALYTICS_V1__;
    if (includePageView) pageViewTrackedRef.current = true;
    if (openedJourneyRef.current === context.journeyId) return;
    openedJourneyRef.current = context.journeyId;
    trackPublicSiteAnalytics(context, [
      ...(includePageView ? [{ eventType: "site_page_view" as const }] : []),
      { eventType: "booking_opened", journeyId: context.journeyId },
    ]);
  }, [context, mode]);

  React.useEffect(() => {
    trackPublicSiteAnalytics(context, [
      {
        eventType: "booking_step_viewed",
        journeyId: context.journeyId,
        step,
        ...(branchId ? { branchId } : {}),
      },
    ]);
  }, [branchId, context, step]);

  const trackStepCompleted = React.useCallback(
    (completedStep: PublicSiteAnalyticsStep) => {
      trackPublicSiteAnalytics(context, [
        {
          eventType: "booking_step_completed",
          journeyId: context.journeyId,
          step: completedStep,
          ...(branchId ? { branchId } : {}),
        },
      ]);
    },
    [branchId, context],
  );

  const trackSubmit = React.useCallback(() => {
    trackPublicSiteAnalytics(context, [
      {
        eventType: "booking_step_completed",
        journeyId: context.journeyId,
        step: "preview",
        ...(branchId ? { branchId } : {}),
      },
      {
        eventType: "booking_submit",
        journeyId: context.journeyId,
        ...(branchId ? { branchId } : {}),
      },
    ]);
  }, [branchId, context]);

  const startNewJourney = React.useCallback(() => {
    setContext(createPublicBookingAnalyticsContext());
  }, []);

  return { context, startNewJourney, trackStepCompleted, trackSubmit };
}
