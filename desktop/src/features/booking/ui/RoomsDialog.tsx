import { DoorOpen, Plus } from "lucide-react";
import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { roomUsage } from "@/features/booking/lib/bookingAdmin";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import type {
  BookingBranch,
  BookingRoom,
} from "@/features/booking/model/bookingCore";
import { setBookingRoomStatus } from "@/features/booking/model/bookingMutations";
import { BookingFeedbackBanners } from "@/features/booking/ui/BookingWorkspaceState";
import { RoomFormDialog } from "@/features/booking/ui/RoomFormDialog";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function RoomsDialog({
  branch,
  onOpenChange,
  open,
}: {
  branch: BookingBranch | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const [formOpen, setFormOpen] = React.useState(false);
  const [selectedRoom, setSelectedRoom] = React.useState<BookingRoom | null>(
    null,
  );
  const [archiveTarget, setArchiveTarget] = React.useState<BookingRoom | null>(
    null,
  );
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  if (!workspace || !branch) return null;
  const freshBranch =
    workspace.branches.find((candidate) => candidate.id === branch.id) ??
    branch;
  const rooms = workspace.rooms
    .filter((room) => room.branchId === branch.id)
    .sort((first, second) => {
      if (first.status !== second.status)
        return first.status === "active" ? -1 : 1;
      return first.name.localeCompare(
        second.name,
        workspace.organization.locale,
      );
    });
  const archiveUsage = archiveTarget
    ? roomUsage(workspace, archiveTarget.id)
    : null;

  const setRoomStatus = async (
    room: BookingRoom,
    status: BookingRoom["status"],
  ) => {
    setSuccessMessage(null);
    try {
      await booking.save((current) =>
        setBookingRoomStatus(current, room.id, status),
      );
      setSuccessMessage(
        status === "archived" ? messages.roomArchived : messages.roomRestored,
      );
      setArchiveTarget(null);
    } catch {
      // Shared feedback keeps the dialog open for retry.
    }
  };

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent
          className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col overflow-hidden p-0"
          data-testid="airhop-rooms-dialog"
        >
          <DialogHeader className="shrink-0 px-6 pt-6 pr-14">
            <DialogTitle>
              {messages.roomsForBranch(freshBranch.name)}
            </DialogTitle>
            <DialogDescription>{messages.roomsDescription}</DialogDescription>
          </DialogHeader>
          <div
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-2"
            data-testid="airhop-rooms-dialog-scroll"
          >
            <BookingFeedbackBanners />
            {successMessage ? (
              <Alert>
                <AlertDescription>{successMessage}</AlertDescription>
              </Alert>
            ) : null}
            {!rooms.length ? (
              <Card className="space-y-3 p-6 text-center">
                <DoorOpen className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="font-semibold">{messages.noRoomsTitle}</h3>
                <p className="text-sm text-muted-foreground">
                  {messages.noRoomsDescription}
                </p>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {rooms.map((room) => {
                  const usage = roomUsage(workspace, room.id);
                  return (
                    <Card
                      className="flex min-w-0 flex-col gap-3 p-4"
                      data-testid={`airhop-room-${room.id}`}
                      key={room.id}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 truncate font-semibold">
                          {room.name}
                        </p>
                        <Badge
                          variant={
                            room.status === "active" ? "success" : "secondary"
                          }
                        >
                          {room.status === "active"
                            ? messages.active
                            : messages.archived}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {messages.roomUsage(usage.active, usage.historical)}
                      </p>
                      <div className="mt-auto flex flex-wrap gap-2 border-t border-border/70 pt-3">
                        <Button
                          onClick={() => {
                            setSelectedRoom(room);
                            setFormOpen(true);
                          }}
                          size="sm"
                          variant="outline"
                        >
                          {messages.edit}
                        </Button>
                        {room.status === "active" ? (
                          <Button
                            onClick={() => setArchiveTarget(room)}
                            size="sm"
                            variant="ghost"
                          >
                            {messages.archive}
                          </Button>
                        ) : (
                          <Button
                            disabled={
                              booking.isSaving ||
                              freshBranch.status === "archived"
                            }
                            onClick={() => void setRoomStatus(room, "active")}
                            size="sm"
                            title={
                              freshBranch.status === "archived"
                                ? messages.restoreRoomBlocked
                                : undefined
                            }
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
          <DialogFooter className="shrink-0 border-t border-border/70 px-6 py-4">
            <Button onClick={() => onOpenChange(false)} variant="outline">
              {messages.dismiss}
            </Button>
            <Button
              disabled={freshBranch.status === "archived"}
              onClick={() => {
                setSelectedRoom(null);
                setFormOpen(true);
              }}
            >
              <Plus />
              {messages.addRoom}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RoomFormDialog
        branch={freshBranch}
        onOpenChange={setFormOpen}
        onSaved={(kind) =>
          setSuccessMessage(
            kind === "created" ? messages.roomCreated : messages.roomUpdated,
          )
        }
        open={formOpen}
        room={selectedRoom}
      />

      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setArchiveTarget(null);
        }}
        open={archiveTarget !== null}
      >
        <AlertDialogContent data-testid="airhop-archive-room-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {messages.archiveRoomTitle(archiveTarget?.name ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>{messages.archiveRoomDescription}</p>
              {archiveUsage ? (
                <p>
                  {messages.roomUsage(
                    archiveUsage.active,
                    archiveUsage.historical,
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
                  void setRoomStatus(archiveTarget, "archived");
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
