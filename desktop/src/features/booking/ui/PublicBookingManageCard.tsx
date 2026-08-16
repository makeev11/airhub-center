import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  Phone,
  UserRound,
} from "lucide-react";
import * as React from "react";

import { usePublicBookingService } from "@/features/booking/data/PublicBookingProvider";
import type {
  PublicBookingCatalog,
  PublicBookingManagementCard,
} from "@/features/booking/data/publicBookingService";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import {
  formatPublicTrialPolicy,
  getPublicBookingMessages,
} from "@/features/booking/lib/publicBookingLocale";
import { PublicBookingShell } from "@/features/booking/ui/PublicBookingShell";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";

function Detail({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted/45 p-4">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="mt-1 text-sm font-medium leading-6">{value}</div>
      </div>
    </div>
  );
}

export function PublicBookingManageCard({ token }: { token: string }) {
  const service = usePublicBookingService();
  const [catalog, setCatalog] = React.useState<PublicBookingCatalog | null>(
    null,
  );
  const [card, setCard] = React.useState<PublicBookingManagementCard | null>(
    null,
  );
  const [status, setStatus] = React.useState<"loading" | "ready" | "invalid">(
    "loading",
  );
  const [error, setError] = React.useState(false);
  const [isCancelling, setIsCancelling] = React.useState(false);
  const [isRequestingTransfer, setIsRequestingTransfer] = React.useState(false);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [transferComment, setTransferComment] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [nextCatalog, nextCard] = await Promise.all([
          service.getCatalog(),
          service.getManagementCard(token),
        ]);
        if (cancelled) return;
        setCatalog(nextCatalog);
        setCard(nextCard);
        setStatus(nextCard ? "ready" : "invalid");
      } catch {
        if (!cancelled) {
          setError(true);
          setStatus("invalid");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [service, token]);

  const locale = catalog?.organization.locale ?? "ru-RU";
  const messages = getPublicBookingMessages(locale);
  const formatters = createBookingFormatters(locale);

  const cancelBooking = async () => {
    setIsCancelling(true);
    setError(false);
    try {
      const next = await service.cancelByParent(token);
      if (next) setCard(next);
      else setStatus("invalid");
    } catch {
      setError(true);
    } finally {
      setIsCancelling(false);
    }
  };

  const requestTransfer = async () => {
    setIsRequestingTransfer(true);
    setError(false);
    try {
      const next = await service.requestTransfer(token, transferComment);
      if (next) {
        setCard(next);
        setTransferOpen(false);
      } else {
        setStatus("invalid");
      }
    } catch {
      setError(true);
    } finally {
      setIsRequestingTransfer(false);
    }
  };

  if (status === "loading") {
    return (
      <PublicBookingShell mode="standalone">
        <div
          className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          {messages.loading}
        </div>
      </PublicBookingShell>
    );
  }

  if (status === "invalid" || !card) {
    return (
      <PublicBookingShell mode="standalone">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-10">
          <Card
            className="bg-card/95 p-7 text-center shadow-sm"
            data-testid="airhop-public-invalid-token"
          >
            <h1 className="text-2xl font-semibold">
              {messages.invalidLinkTitle}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {messages.invalidLinkDescription}
            </p>
            <Button asChild className="mt-6" variant="outline">
              <Link to="/booking">
                <ArrowLeft />
                {messages.startAnotherBooking}
              </Link>
            </Button>
          </Card>
        </div>
      </PublicBookingShell>
    );
  }

  const trial = formatPublicTrialPolicy(card.trialPolicy, locale, messages);

  return (
    <PublicBookingShell mode="standalone">
      <main
        className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-center overflow-y-auto py-5 sm:py-8"
        data-testid="airhop-public-management-card"
      >
        <Card className="bg-card/95 p-5 shadow-lg sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            {messages.brand}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {messages.manageTitle}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {messages.manageDescription}
          </p>

          {error ? (
            <Alert className="mt-5" variant="destructive">
              <AlertTitle>{messages.genericErrorTitle}</AlertTitle>
              <AlertDescription>
                {messages.genericErrorDescription}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {messages.statusLabel}
            </span>
            <span
              className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary"
              data-testid="airhop-public-booking-status"
            >
              {messages.status[card.status]}
            </span>
          </div>

          {card.transferRequest ? (
            <Alert
              className="mt-5"
              data-testid="airhop-public-transfer-requested"
            >
              <AlertTitle>{messages.transferRequested}</AlertTitle>
              <AlertDescription>
                {messages.transferRequestedDescription}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Detail
              icon={<CalendarDays className="h-4 w-4" />}
              label={messages.dateAndTime}
              value={
                <>
                  {formatters.date(card.date)}, {card.startTime}–{card.endTime}
                  <span className="mt-1 block font-normal text-muted-foreground">
                    {card.groupName}
                  </span>
                </>
              }
            />
            <Detail
              icon={<MapPin className="h-4 w-4" />}
              label={messages.address}
              value={
                <>
                  {card.branchName} · {card.branchAddress}
                  {card.roomName ? (
                    <span className="mt-1 block font-normal text-muted-foreground">
                      {card.roomName}
                    </span>
                  ) : null}
                </>
              }
            />
            <Detail
              icon={<UserRound className="h-4 w-4" />}
              label={messages.child}
              value={card.childName}
            />
            <Detail
              icon={<Phone className="h-4 w-4" />}
              label={messages.maskedPhone}
              value={card.maskedPhone}
            />
          </div>

          <dl className="mt-5 rounded-2xl border border-border/60 px-4 py-2 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-border/50 py-3">
              <dt className="text-muted-foreground">{messages.center}</dt>
              <dd className="font-medium">{card.organizationName}</dd>
            </div>
            {card.purpose === "trial" ? (
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-muted-foreground">{messages.trial}</dt>
                <dd className="font-medium">{trial}</dd>
              </div>
            ) : null}
          </dl>

          {card.canCancel || card.canRequestTransfer ? (
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              {card.canRequestTransfer ? (
                <Button
                  className="sm:flex-1"
                  data-testid="airhop-public-request-transfer"
                  disabled={Boolean(card.transferRequest)}
                  onClick={() => setTransferOpen(true)}
                  type="button"
                  variant="outline"
                >
                  {card.transferRequest
                    ? messages.transferRequested
                    : messages.requestTransfer}
                </Button>
              ) : null}
              {card.canCancel ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      className="sm:flex-1"
                      data-testid="airhop-public-cancel"
                      disabled={isCancelling}
                      type="button"
                      variant="destructive"
                    >
                      {messages.cancelBooking}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {messages.cancelTitle}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {messages.cancelDescription}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{messages.back}</AlertDialogCancel>
                      <AlertDialogAction
                        data-testid="airhop-public-cancel-confirm"
                        onClick={() => void cancelBooking()}
                      >
                        {messages.cancelConfirm}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
          ) : null}

          <Button asChild className="mt-5 w-full" variant="ghost">
            <Link to="/booking">
              <ArrowLeft />
              {messages.startAnotherBooking}
            </Link>
          </Button>
        </Card>
      </main>

      <Dialog onOpenChange={setTransferOpen} open={transferOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{messages.transferTitle}</DialogTitle>
            <DialogDescription>
              {messages.transferDescription}
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2" htmlFor="public-transfer-comment">
            <span className="text-sm font-medium">
              {messages.transferComment}
            </span>
            <Textarea
              id="public-transfer-comment"
              maxLength={1_000}
              onChange={(event) => setTransferComment(event.target.value)}
              placeholder={messages.transferCommentPlaceholder}
              value={transferComment}
            />
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.close}
              </Button>
            </DialogClose>
            <Button
              data-testid="airhop-public-transfer-confirm"
              disabled={isRequestingTransfer}
              onClick={() => void requestTransfer()}
              type="button"
            >
              {messages.transferConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PublicBookingShell>
  );
}
