import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import {
  formatFullDateTime,
  formatTime,
  formatTimeWithoutDayPeriod,
} from "@/features/messages/lib/dateFormatters";
import { cn } from "@/shared/lib/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";

const TIMESTAMP_TOOLTIP_DELAY_MS = 500;

export function MessageTimestamp({
  className,
  createdAt,
  hideDayPeriod = false,
  time,
}: {
  className?: string;
  createdAt: number;
  hideDayPeriod?: boolean;
  time: string;
}) {
  const locale = useAirHopLocale();
  const localTime = locale === "en-US" ? time : formatTime(createdAt);
  const displayTime = hideDayPeriod
    ? formatTimeWithoutDayPeriod(localTime)
    : localTime;

  return (
    <TooltipProvider
      delayDuration={TIMESTAMP_TOOLTIP_DELAY_MS}
      skipDelayDuration={0}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <p
            className={cn(
              "shrink-0 cursor-default whitespace-nowrap text-xs font-normal leading-4 tabular-nums text-muted-foreground/55",
              className,
            )}
            data-testid="message-timestamp"
          >
            {displayTime}
          </p>
        </TooltipTrigger>
        <TooltipContent side="top">
          {formatFullDateTime(createdAt)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
