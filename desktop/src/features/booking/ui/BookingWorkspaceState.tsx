import type * as React from "react";
import { AlertTriangle, Database, LoaderCircle, RotateCcw } from "lucide-react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import type { BookingWorkspace } from "@/features/booking/model/bookingCore";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

function CenteredState({
  description,
  icon,
  title,
  action,
}: {
  description: string;
  icon: React.ReactNode;
  title: string;
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

export function BookingWorkspaceGate({
  children,
}: {
  children: (workspace: BookingWorkspace) => React.ReactNode;
}) {
  const state = useBookingWorkspace();
  const messages = getBookingAdminMessages(
    state.workspace?.organization.locale ?? "ru-RU",
  );

  if (state.status === "unavailable") {
    return (
      <CenteredState
        description={messages.unavailableDescription}
        icon={<Database className="h-8 w-8" />}
        title={messages.unavailableTitle}
      />
    );
  }
  if (state.status === "loading") {
    return (
      <CenteredState
        description={messages.loadingDescription}
        icon={<LoaderCircle className="h-8 w-8 animate-spin" />}
        title={messages.loadingTitle}
      />
    );
  }
  if (state.status === "error" || !state.workspace) {
    return (
      <CenteredState
        action={
          <Button onClick={() => void state.reload()} variant="outline">
            <RotateCcw />
            {messages.retry}
          </Button>
        }
        description={messages.loadErrorDescription}
        icon={<AlertTriangle className="h-8 w-8" />}
        title={messages.loadErrorTitle}
      />
    );
  }
  return children(state.workspace);
}

export function BookingFeedbackBanners() {
  const state = useBookingWorkspace();
  const messages = getBookingAdminMessages(
    state.workspace?.organization.locale ?? "ru-RU",
  );

  return (
    <div className="space-y-3">
      {state.conflict ? (
        <Alert data-testid="airhop-revision-conflict">
          <AlertTitle>{messages.revisionConflictTitle}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{messages.revisionConflictDescription}</p>
            <Button onClick={state.dismissConflict} size="sm" variant="outline">
              {messages.dismiss}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state.notice ? (
        <Alert>
          <AlertTitle>{messages.recoveredDataTitle}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{messages.recoveredDataDescription}</p>
            <Button onClick={state.dismissNotice} size="sm" variant="outline">
              {messages.dismiss}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state.error && state.workspace ? (
        <Alert variant="destructive">
          <AlertTitle>{messages.saveErrorTitle}</AlertTitle>
          <AlertDescription>{messages.saveErrorDescription}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
