import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  Database,
  Inbox,
  LoaderCircle,
  MapPin,
  Phone,
  RotateCcw,
  UserRound,
} from "lucide-react";

import type { StaffBookingDecision } from "@/features/booking/data/staffBookingDecisionService";
import type { StaffBookingQueueItem } from "@/features/booking/data/staffBookingQueueService";
import {
  type StaffBookingQueueView,
  useStaffBookingQueue,
} from "@/features/booking/data/useStaffBookingQueue";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";

const SERVER_LOCALE = "ru-RU";

type ServerDecision = {
  item: StaffBookingQueueItem;
  decision: StaffBookingDecision;
};

function statusLabel(
  item: StaffBookingQueueItem,
  messages: ReturnType<typeof getBookingAdminMessages>,
): string {
  switch (item.booking.status) {
    case "pending_confirmation":
      return messages.requestStatusPending;
    case "confirmed":
      return messages.requestStatusConfirmed;
    case "rejected":
      return messages.requestStatusRejected;
    case "cancelled_by_parent":
      return messages.requestStatusCancelledByParent;
    case "cancelled_by_center":
      return messages.requestStatusCancelledByCenter;
  }
}

function statusVariant(
  status: StaffBookingQueueItem["booking"]["status"],
): "success" | "destructive" | "secondary" {
  if (status === "confirmed") return "success";
  if (status === "rejected") return "destructive";
  return "secondary";
}

function CenteredServerState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <Card className="max-w-lg space-y-3 p-6 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center text-muted-foreground">
          {icon}
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {action ? <div className="pt-1">{action}</div> : null}
      </Card>
    </div>
  );
}

/** Renders only rows returned by the authoritative Booking Core staff queue. */
export function ServerBookingRequestsScreen() {
  const navigate = useNavigate();
  const messages = getBookingAdminMessages(SERVER_LOCALE);
  const queue = useStaffBookingQueue();
  const [query, setQuery] = React.useState("");
  const [decision, setDecision] = React.useState<ServerDecision | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase(SERVER_LOCALE);
  const queryDigits = query.replace(/\D/g, "");
  const visibleItems = queue.items.filter((item) => {
    if (!normalizedQuery && !queryDigits) return true;
    const text = [
      item.child.displayName,
      item.representative.displayName,
      item.family.displayName,
      item.group.name,
      item.branch.name,
    ]
      .join(" ")
      .toLocaleLowerCase(SERVER_LOCALE);
    return (
      text.includes(normalizedQuery) ||
      (queryDigits.length > 0 &&
        item.representative.phoneNormalized
          .replace(/\D/g, "")
          .includes(queryDigits))
    );
  });

  const filterOptions: Array<{
    value: StaffBookingQueueView;
    label: string;
  }> = [
    { value: "pending", label: messages.requestFilterPending },
    { value: "attention", label: messages.requestFilterAttention },
    { value: "confirmed", label: messages.requestFilterConfirmed },
    { value: "processed", label: messages.requestFilterProcessed },
    { value: "all", label: messages.requestFilterAll },
  ];

  const submitDecision = async () => {
    if (!decision) return;
    try {
      const outcome = await queue.decideBooking({
        bookingId: decision.item.booking.id,
        decision: decision.decision,
      });
      const baseMessage =
        outcome.status === "confirmed"
          ? messages.requestConfirmed
          : messages.requestRejected;
      const notificationMessage =
        outcome.notification.kind === "messenger"
          ? messages.requestMessengerQueued
          : messages.requestStaffCallQueued;
      setSuccessMessage(`${baseMessage}. ${notificationMessage}`);
      setDecision(null);
    } catch {
      // The server error stays visible and the dialog remains open for retry.
    }
  };

  let body: React.ReactNode;
  if (queue.status === "loading" && queue.items.length === 0) {
    body = (
      <CenteredServerState
        description={messages.loadingDescription}
        icon={<LoaderCircle className="h-8 w-8 animate-spin" />}
        title={messages.loadingTitle}
      />
    );
  } else if (queue.status === "error" && queue.items.length === 0) {
    body = (
      <CenteredServerState
        action={
          <Button onClick={() => void queue.reload()} variant="outline">
            <RotateCcw />
            {messages.retry}
          </Button>
        }
        description={messages.loadErrorDescription}
        icon={<AlertTriangle className="h-8 w-8" />}
        title={messages.loadErrorTitle}
      />
    );
  } else {
    body = (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Badge variant="outline">
            <Database className="mr-1 h-3 w-3" />
            {messages.requestSourceBookingCore}
          </Badge>
        </div>
        {queue.error ? (
          <Alert variant="destructive">
            <AlertTitle>{messages.loadErrorTitle}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{messages.loadErrorDescription}</p>
              <Button
                onClick={() => void queue.reload()}
                size="sm"
                variant="outline"
              >
                {messages.retry}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {successMessage ? (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-3 rounded-xl border border-border/70 bg-card p-3 sm:p-4">
          <Input
            aria-label={messages.requestSearch}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={messages.requestSearch}
            value={query}
          />
          <fieldset className="flex max-w-full gap-2 overflow-x-auto pb-1">
            <legend className="sr-only">{messages.requestsTitle}</legend>
            {filterOptions.map((option) => (
              <Button
                aria-pressed={queue.view === option.value}
                className="shrink-0"
                key={option.value}
                onClick={() => queue.setView(option.value)}
                size="sm"
                variant={queue.view === option.value ? "default" : "outline"}
              >
                {option.label}
              </Button>
            ))}
          </fieldset>
        </div>

        {!visibleItems.length ? (
          <Card className="space-y-3 p-8 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {messages.noRequestsTitle}
            </h2>
            <p className="text-sm text-muted-foreground">
              {messages.noRequestsDescription}
            </p>
          </Card>
        ) : (
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            {visibleItems.map((item) => (
              <Card
                className="min-w-0 space-y-4 p-4 sm:p-5"
                data-testid={`airhop-server-request-${item.booking.id}`}
                key={item.booking.id}
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold">
                      {item.child.displayName}
                    </h2>
                    <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <UserRound className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {item.representative.displayName}
                      </span>
                    </p>
                  </div>
                  <Badge variant={statusVariant(item.booking.status)}>
                    {statusLabel(item, messages)}
                  </Badge>
                </div>

                <div className="grid min-w-0 gap-2 text-sm">
                  <p className="min-w-0 font-medium">{item.group.name}</p>
                  <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {new Intl.DateTimeFormat(SERVER_LOCALE, {
                        weekday: "short",
                        day: "numeric",
                        month: "long",
                      }).format(new Date(`${item.occurrence.date}T12:00:00Z`))}
                      , {item.occurrence.startTime}
                    </span>
                  </p>
                  <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.branch.name}</span>
                  </p>
                  <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {item.representative.phoneDisplay}
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {item.booking.transferRequest ? (
                    <Badge variant="warning">
                      {messages.requestTransferPending}
                    </Badge>
                  ) : null}
                  {item.attentionReasons.includes("possible_duplicate") ? (
                    <Badge variant="warning">
                      {messages.requestPossibleDuplicate}
                    </Badge>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
                  {item.booking.status === "pending_confirmation" ? (
                    <>
                      <Button
                        data-testid={`confirm-airhop-server-request-${item.booking.id}`}
                        onClick={() =>
                          setDecision({ item, decision: "confirm" })
                        }
                        size="sm"
                      >
                        {messages.requestConfirm}
                      </Button>
                      <Button
                        onClick={() =>
                          setDecision({ item, decision: "reject" })
                        }
                        size="sm"
                        variant="outline"
                      >
                        {messages.requestReject}
                      </Button>
                    </>
                  ) : null}
                  <Button
                    onClick={() =>
                      void navigate({
                        to: "/booking/clients/$familyId",
                        params: { familyId: item.family.id },
                      })
                    }
                    size="sm"
                    variant="ghost"
                  >
                    {messages.requestOpenFamily}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {queue.hasMore ? (
          <div className="flex justify-center pt-2">
            <Button
              disabled={queue.isLoadingMore}
              onClick={() => void queue.loadMore()}
              variant="outline"
            >
              {queue.isLoadingMore
                ? messages.requestLoadingMore
                : messages.requestLoadMore}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
        <PageHeader
          description={messages.requestsDescription}
          title={messages.requestsTitle}
        />
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6">
        {body}
      </div>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !queue.isDeciding) setDecision(null);
        }}
        open={decision !== null}
      >
        <AlertDialogContent data-testid="airhop-server-decision-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {decision?.decision === "confirm"
                ? messages.requestConfirm
                : messages.requestReject}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {decision
                ? `${decision.item.child.displayName} · ${decision.item.group.name} · ${decision.item.occurrence.date}, ${decision.item.occurrence.startTime}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={queue.isDeciding}>
              {messages.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={queue.isDeciding}
              onClick={(event) => {
                event.preventDefault();
                void submitDecision();
              }}
            >
              {queue.isDeciding
                ? messages.saving
                : decision?.decision === "confirm"
                  ? messages.requestConfirm
                  : messages.requestReject}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
