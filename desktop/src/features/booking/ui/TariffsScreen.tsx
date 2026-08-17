import * as React from "react";
import { Banknote, Plus } from "lucide-react";

import {
  BookingWorkspaceProvider,
  useBookingWorkspace,
} from "@/features/booking/data/BookingWorkspaceProvider";
import { createHttpBookingTariffsRepository } from "@/features/booking/data/httpBookingTariffsRepository";
import { currentAirhopStaffDataRuntime } from "@/features/booking/data/staffDataRuntime";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import type { BookingTariff } from "@/features/booking/model/bookingCore";
import { setTariffStatus } from "@/features/booking/model/bookingCommerce";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { TariffFormDialog } from "@/features/booking/ui/TariffFormDialog";
import { BookingSettingsNav } from "@/features/booking/ui/BookingSettingsNav";
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
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/PageHeader";

function TariffCard({
  enrollmentCount,
  onArchive,
  onEdit,
  onRestore,
  tariff,
}: {
  enrollmentCount: number;
  onArchive: () => void;
  onEdit: () => void;
  onRestore: () => void;
  tariff: BookingTariff;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const formatters = createBookingFormatters(workspace.organization.locale);
  const paymentDay =
    tariff.paymentDayOfMonth ?? workspace.organization.paymentDayOfMonth;

  return (
    <Card
      className="flex min-w-0 flex-col gap-4 p-5"
      data-testid={`airhop-tariff-${tariff.id}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-base font-semibold">
              {tariff.name}
            </h2>
            <Badge
              variant={tariff.status === "active" ? "success" : "secondary"}
            >
              {tariff.status === "active" ? messages.active : messages.archived}
            </Badge>
          </div>
          {tariff.description ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {tariff.description}
            </p>
          ) : null}
        </div>
        <p className="shrink-0 text-base font-semibold tabular-nums">
          {formatters.money(tariff.priceMinor, tariff.currency)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">
          {messages.tariffPerWeek(tariff.weeklyScheduleLimit)}
        </Badge>
        <Badge variant="outline">
          {tariff.paymentDayOfMonth === undefined
            ? messages.tariffPaymentDayCenterSummary(paymentDay)
            : messages.tariffPaymentDaySummary(paymentDay)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {messages.tariffEnrollmentUsage(enrollmentCount)}
      </p>
      <div className="mt-auto flex flex-wrap gap-2 border-t border-border/70 pt-4">
        <Button onClick={onEdit} size="sm" variant="outline">
          {messages.edit}
        </Button>
        {tariff.status === "active" ? (
          <Button onClick={onArchive} size="sm" variant="ghost">
            {messages.archive}
          </Button>
        ) : (
          <Button
            disabled={booking.isSaving}
            onClick={onRestore}
            size="sm"
            variant="ghost"
          >
            {messages.restore}
          </Button>
        )}
      </div>
    </Card>
  );
}

function TariffsContent({ createRequest }: { createRequest: number }) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const [formOpen, setFormOpen] = React.useState(false);
  const [selectedTariff, setSelectedTariff] =
    React.useState<BookingTariff | null>(null);
  const [archiveTarget, setArchiveTarget] =
    React.useState<BookingTariff | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    if (!createRequest) return;
    setSelectedTariff(null);
    setFormOpen(true);
  }, [createRequest]);

  const activeTariffs = workspace.tariffs
    .filter(({ status }) => status === "active")
    .sort((first, second) =>
      first.name.localeCompare(second.name, workspace.organization.locale),
    );
  const archivedTariffs = workspace.tariffs
    .filter(({ status }) => status === "archived")
    .sort((first, second) =>
      first.name.localeCompare(second.name, workspace.organization.locale),
    );

  const enrollmentCount = (tariffId: string) =>
    workspace.tariffs.find((tariff) => tariff.id === tariffId)
      ?.activeEnrollmentCount ??
    workspace.enrollments.filter(
      (enrollment) =>
        enrollment.assignmentState === "configured" &&
        enrollment.tariffId === tariffId &&
        enrollment.status === "active",
    ).length;

  const changeStatus = async (
    tariff: BookingTariff,
    status: BookingTariff["status"],
  ) => {
    setSuccessMessage(null);
    try {
      await booking.save((current) =>
        setTariffStatus(current, tariff.id, status, new Date().toISOString()),
      );
      setSuccessMessage(
        status === "archived"
          ? messages.tariffArchived
          : messages.tariffRestored,
      );
      setArchiveTarget(null);
    } catch {
      // Shared feedback explains validation and persistence failures.
    }
  };

  const renderTariff = (tariff: BookingTariff) => (
    <TariffCard
      enrollmentCount={enrollmentCount(tariff.id)}
      key={tariff.id}
      onArchive={() => setArchiveTarget(tariff)}
      onEdit={() => {
        setSelectedTariff(tariff);
        setFormOpen(true);
      }}
      onRestore={() => void changeStatus(tariff, "active")}
      tariff={tariff}
    />
  );

  return (
    <>
      <div className="space-y-4" data-testid="airhop-tariffs">
        <BookingFeedbackBanners />
        {successMessage ? (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}
        {!workspace.tariffs.length ? (
          <Card className="space-y-3 p-8 text-center">
            <Banknote className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{messages.noTariffsTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {messages.noTariffsDescription}
            </p>
            <Button
              onClick={() => {
                setSelectedTariff(null);
                setFormOpen(true);
              }}
            >
              <Plus />
              {messages.addTariff}
            </Button>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 xl:grid-cols-2">
              {activeTariffs.map(renderTariff)}
            </div>
            {archivedTariffs.length ? (
              <div className="space-y-4 pt-2">
                <Button
                  data-testid="airhop-toggle-archived-tariffs"
                  onClick={() => setShowArchived((current) => !current)}
                  size="sm"
                  variant="ghost"
                >
                  {showArchived
                    ? messages.hideArchivedTariffs
                    : messages.showArchivedTariffs(archivedTariffs.length)}
                </Button>
                {showArchived ? (
                  <section className="space-y-3">
                    <h2 className="text-sm font-semibold text-muted-foreground">
                      {messages.archivedTariffsTitle}
                    </h2>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {archivedTariffs.map(renderTariff)}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      <TariffFormDialog
        onOpenChange={setFormOpen}
        onSaved={(kind) =>
          setSuccessMessage(
            kind === "created"
              ? messages.tariffCreated
              : messages.tariffUpdated,
          )
        }
        open={formOpen}
        tariff={selectedTariff}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        open={archiveTarget !== null}
      >
        <AlertDialogContent data-testid="airhop-archive-tariff-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {messages.archiveTariffTitle(archiveTarget?.name ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {messages.archiveTariffDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={booking.isSaving}
              onClick={(event) => {
                event.preventDefault();
                if (archiveTarget) void changeStatus(archiveTarget, "archived");
              }}
            >
              {booking.isSaving ? messages.saving : messages.archive}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TariffsScreenContent() {
  const booking = useBookingWorkspace();
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  const [createRequested, setCreateRequested] = React.useState(0);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
        <PageHeader
          action={
            <Button
              data-testid="airhop-add-tariff"
              onClick={() => setCreateRequested((value) => value + 1)}
            >
              <Plus />
              {messages.addTariff}
            </Button>
          }
          className="flex-col sm:flex-row"
          description={messages.tariffsDescription}
          title={messages.tariffsTitle}
        />
        <BookingSettingsNav active="tariffs" className="mt-4" />
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <BookingWorkspaceGate>
          {() => <TariffsContent createRequest={createRequested} />}
        </BookingWorkspaceGate>
      </div>
    </div>
  );
}

function ServerTariffsScreen() {
  const [repository] = React.useState(() =>
    createHttpBookingTariffsRepository(),
  );
  return (
    <BookingWorkspaceProvider repository={repository}>
      <TariffsScreenContent />
    </BookingWorkspaceProvider>
  );
}

/** Uses PostgreSQL tariff commands in Tauri and isolated demo state in previews. */
export function TariffsScreen() {
  return currentAirhopStaffDataRuntime() === "server" ? (
    <ServerTariffsScreen />
  ) : (
    <TariffsScreenContent />
  );
}
