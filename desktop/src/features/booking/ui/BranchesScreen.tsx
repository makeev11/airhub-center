import * as React from "react";
import { Building2, Copy, MapPin, Plus } from "lucide-react";

import {
  BookingWorkspaceProvider,
  useBookingWorkspace,
} from "@/features/booking/data/BookingWorkspaceProvider";
import { createHttpBookingBranchesRepository } from "@/features/booking/data/httpBookingBranchesRepository";
import { currentAirhopStaffDataRuntime } from "@/features/booking/data/staffDataRuntime";
import {
  branchUsage,
  workingHoursCounts,
} from "@/features/booking/lib/bookingAdmin";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { buildBranchPublicBookingUrlForLocation } from "@/features/booking/lib/publicBookingLink";
import type { BookingBranch } from "@/features/booking/model/bookingCore";
import { BranchFormDialog } from "@/features/booking/ui/BranchFormDialog";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { RoomsDialog } from "@/features/booking/ui/RoomsDialog";
import { BookingSettingsNav } from "@/features/booking/ui/BookingSettingsNav";
import { useChannelsQuery } from "@/features/channels/hooks";
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
import { writeTextToClipboard } from "@/shared/lib/clipboard";

function BranchesContent({ createRequest }: { createRequest: number }) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const channelsQuery = useChannelsQuery();
  const [formOpen, setFormOpen] = React.useState(false);
  const [selectedBranch, setSelectedBranch] =
    React.useState<BookingBranch | null>(null);
  const [archiveTarget, setArchiveTarget] =
    React.useState<BookingBranch | null>(null);
  const [roomsBranch, setRoomsBranch] = React.useState<BookingBranch | null>(
    null,
  );
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const [copyingBranchId, setCopyingBranchId] = React.useState<string | null>(
    null,
  );
  React.useEffect(() => {
    if (!createRequest) return;
    setSelectedBranch(null);
    setFormOpen(true);
  }, [createRequest]);
  const branches = [...workspace.branches].sort((first, second) => {
    if (first.status !== second.status)
      return first.status === "active" ? -1 : 1;
    return first.name.localeCompare(second.name, workspace.organization.locale);
  });

  const setBranchStatus = async (
    branch: BookingBranch,
    status: BookingBranch["status"],
  ) => {
    setSuccessMessage(null);
    setCopyError(null);
    try {
      await booking.save((current) => {
        const { revision: _revision, ...draft } = current;
        return {
          ...draft,
          branches: current.branches.map((candidate) =>
            candidate.id === branch.id ? { ...candidate, status } : candidate,
          ),
        };
      });
      setSuccessMessage(
        status === "archived"
          ? messages.branchArchived
          : messages.branchRestored,
      );
      setArchiveTarget(null);
    } catch {
      // Shared feedback explains storage and revision errors.
    }
  };

  const copyBookingLink = async (branch: BookingBranch) => {
    setSuccessMessage(null);
    setCopyError(null);
    setCopyingBranchId(branch.id);
    try {
      const link = buildBranchPublicBookingUrlForLocation(
        window.location,
        branch.id,
      );
      await writeTextToClipboard(link);
      setSuccessMessage(messages.bookingLinkCopied(branch.name));
    } catch {
      setCopyError(messages.bookingLinkCopyFailed);
    } finally {
      setCopyingBranchId(null);
    }
  };

  const archiveUsage = archiveTarget
    ? branchUsage(workspace, archiveTarget.id)
    : null;

  return (
    <>
      <div className="space-y-4">
        <BookingFeedbackBanners />
        {successMessage ? (
          <Alert data-testid="airhop-branch-link-feedback">
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}
        {copyError ? (
          <Alert
            data-testid="airhop-branch-link-feedback"
            variant="destructive"
          >
            <AlertDescription>{copyError}</AlertDescription>
          </Alert>
        ) : null}
        {!branches.length ? (
          <Card className="space-y-3 p-8 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {messages.noBranchesTitle}
            </h2>
            <p className="text-sm text-muted-foreground">
              {messages.noBranchesDescription}
            </p>
            <Button
              onClick={() => {
                setSelectedBranch(null);
                setFormOpen(true);
              }}
            >
              <Plus />
              {messages.addBranch}
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {branches.map((branch) => {
              const hours = workingHoursCounts(branch.workingHours);
              const usage = branchUsage(workspace, branch.id);
              const buzzChannel = branch.defaultBuzzChannelId
                ? channelsQuery.data?.find(
                    (channel) => channel.id === branch.defaultBuzzChannelId,
                  )
                : null;
              return (
                <Card
                  className="flex min-w-0 flex-col gap-4 p-5"
                  data-testid={`airhop-branch-${branch.id}`}
                  key={branch.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold">
                          {branch.name}
                        </h2>
                        <Badge
                          variant={
                            branch.status === "active" ? "success" : "secondary"
                          }
                        >
                          {branch.status === "active"
                            ? messages.active
                            : messages.archived}
                        </Badge>
                      </div>
                      <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{branch.address}</span>
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <p>
                      {messages.workingDaysSummary(hours.days, hours.periods)}
                    </p>
                    <p>
                      {messages.branchUsage(
                        usage.groups,
                        usage.rooms,
                        usage.rules,
                      )}
                    </p>
                    {branch.defaultBuzzChannelId ? (
                      <p className="sm:col-span-2">
                        {messages.buzzChannel}:{" "}
                        {buzzChannel
                          ? `#${buzzChannel.name}`
                          : messages.buzzChannelUnavailable}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-border/70 pt-4">
                    <Button
                      data-testid={`airhop-manage-rooms-${branch.id}`}
                      onClick={() => setRoomsBranch(branch)}
                      size="sm"
                      variant="outline"
                    >
                      {messages.manageRooms}
                    </Button>
                    {branch.status === "active" ? (
                      <Button
                        data-testid={`airhop-copy-booking-link-${branch.id}`}
                        disabled={copyingBranchId === branch.id}
                        onClick={() => void copyBookingLink(branch)}
                        size="sm"
                        variant="outline"
                      >
                        <Copy />
                        {messages.copyBookingLink}
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => {
                        setSelectedBranch(branch);
                        setFormOpen(true);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {messages.edit}
                    </Button>
                    {branch.status === "active" ? (
                      <Button
                        onClick={() => setArchiveTarget(branch)}
                        size="sm"
                        variant="ghost"
                      >
                        {messages.archive}
                      </Button>
                    ) : (
                      <Button
                        disabled={booking.isSaving}
                        onClick={() => void setBranchStatus(branch, "active")}
                        size="sm"
                        variant="ghost"
                      >
                        {messages.restore}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <BranchFormDialog
        branch={selectedBranch}
        onOpenChange={setFormOpen}
        onSaved={(kind) =>
          setSuccessMessage(
            kind === "created"
              ? messages.branchCreated
              : messages.branchUpdated,
          )
        }
        open={formOpen}
      />

      <RoomsDialog
        branch={roomsBranch}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRoomsBranch(null);
        }}
        open={roomsBranch !== null}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        open={archiveTarget !== null}
      >
        <AlertDialogContent data-testid="airhop-archive-branch-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {messages.archiveBranchTitle(archiveTarget?.name ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>{messages.archiveBranchDescription}</p>
              {archiveUsage ? (
                <p>
                  {messages.branchUsage(
                    archiveUsage.groups,
                    archiveUsage.rooms,
                    archiveUsage.rules,
                  )}
                </p>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={booking.isSaving}
              onClick={(event) => {
                event.preventDefault();
                if (archiveTarget) {
                  void setBranchStatus(archiveTarget, "archived");
                }
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

function BranchesScreenContent() {
  const booking = useBookingWorkspace();
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  const [createRequested, setCreateRequested] = React.useState(0);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-6 py-5">
        <PageHeader
          action={
            <Button
              data-testid="airhop-add-branch"
              onClick={() => setCreateRequested((value) => value + 1)}
            >
              <Plus />
              {messages.addBranch}
            </Button>
          }
          description={messages.branchesDescription}
          title={messages.branchesTitle}
        />
        <BookingSettingsNav active="branches" className="mt-4" />
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <BookingWorkspaceGate>
          {() => <BranchesContent createRequest={createRequested} />}
        </BookingWorkspaceGate>
      </div>
    </div>
  );
}

function ServerBranchesScreen() {
  const [repository] = React.useState(() =>
    createHttpBookingBranchesRepository(),
  );
  return (
    <BookingWorkspaceProvider repository={repository}>
      <BranchesScreenContent />
    </BookingWorkspaceProvider>
  );
}

/** Uses PostgreSQL in Tauri while retaining the isolated demo repository in previews. */
export function BranchesScreen() {
  return currentAirhopStaffDataRuntime() === "server" ? (
    <ServerBranchesScreen />
  ) : (
    <BranchesScreenContent />
  );
}
