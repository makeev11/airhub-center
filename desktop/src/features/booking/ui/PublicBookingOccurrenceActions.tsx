import { Button } from "@/shared/ui/button";

/** Keeps the selected lesson's next action outside the scrolling booking flow. */
export function PublicBookingOccurrenceActions({
  continueLabel,
  onContinue,
}: {
  continueLabel: string;
  onContinue: () => void;
}) {
  return (
    <div
      className="mx-auto w-full max-w-3xl shrink-0 border-t border-border bg-background pt-3 pb-[env(safe-area-inset-bottom)]"
      data-testid="airhop-public-occurrence-actions"
    >
      <Button className="min-h-11 w-full" onClick={onContinue} type="button">
        {continueLabel}
      </Button>
    </div>
  );
}
