import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  roomSchema,
  type BookingBranch,
  type BookingRoom,
} from "@/features/booking/model/bookingCore";
import { upsertBookingRoom } from "@/features/booking/model/bookingMutations";
import { BookingFeedbackBanners } from "@/features/booking/ui/BookingWorkspaceState";
import { useBookingUnsavedChangesGuard } from "@/features/booking/ui/useBookingUnsavedChangesGuard";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

type RoomForm = { id: string; name: string };

function createRoomId(): string {
  return `room-${crypto.randomUUID()}`;
}

function formFromRoom(room: BookingRoom | null): RoomForm {
  return room
    ? { id: room.id, name: room.name }
    : { id: createRoomId(), name: "" };
}

export function RoomFormDialog({
  branch,
  onOpenChange,
  onSaved,
  open,
  room,
}: {
  branch: BookingBranch;
  onOpenChange: (open: boolean) => void;
  onSaved: (kind: "created" | "updated") => void;
  open: boolean;
  room: BookingRoom | null;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const workspaceRef = React.useRef(workspace);
  workspaceRef.current = workspace;
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const [form, setForm] = React.useState<RoomForm>(() => formFromRoom(room));
  const [baseline, setBaseline] = React.useState<RoomForm | null>(null);
  const [nameError, setNameError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!open) return;
    const currentWorkspace = workspaceRef.current;
    const freshRoom = room
      ? (currentWorkspace?.rooms.find(
          (candidate) => candidate.id === room.id,
        ) ?? null)
      : null;
    const fresh = formFromRoom(freshRoom);
    setForm(fresh);
    setBaseline(fresh);
    setNameError(undefined);
  }, [open, room]);

  const dirty =
    open &&
    baseline !== null &&
    JSON.stringify(form) !== JSON.stringify(baseline);
  useBookingUnsavedChangesGuard(dirty, messages.unsavedChangesConfirm);
  if (!workspace) return null;

  const requestOpenChange = (nextOpen: boolean) => {
    if (nextOpen || !dirty || window.confirm(messages.unsavedChangesConfirm)) {
      onOpenChange(nextOpen);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const currentRoom = workspace.rooms.find(
      (candidate) => candidate.id === form.id,
    );
    const parsed = roomSchema.safeParse({
      id: form.id,
      organizationId: workspace.organization.id,
      branchId: branch.id,
      name: form.name,
      status: currentRoom?.status ?? "active",
    });
    if (!form.name.trim() || !parsed.success) {
      setNameError(messages.requiredField);
      return;
    }
    setNameError(undefined);
    try {
      await booking.save((current) => upsertBookingRoom(current, parsed.data));
      onSaved(room ? "updated" : "created");
      onOpenChange(false);
    } catch {
      // The shared banner keeps the current draft visible for retry.
    }
  };

  return (
    <Dialog onOpenChange={requestOpenChange} open={open}>
      <DialogContent className="max-w-xl" data-testid="airhop-room-form">
        <DialogHeader>
          <DialogTitle>
            {room ? messages.editRoomTitle : messages.createRoomTitle}
          </DialogTitle>
          <DialogDescription>
            {room
              ? messages.editRoomDescription
              : messages.createRoomDescription}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          <BookingFeedbackBanners />
          <div className="grid gap-1.5 text-sm">
            <span className="font-medium">{messages.roomName}</span>
            <Input
              aria-label={messages.roomName}
              data-testid="airhop-room-name"
              maxLength={160}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              value={form.name}
            />
            {nameError ? (
              <span className="text-xs text-destructive">{nameError}</span>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              onClick={() => requestOpenChange(false)}
              type="button"
              variant="outline"
            >
              {messages.cancel}
            </Button>
            <Button disabled={booking.isSaving || !dirty} type="submit">
              {booking.isSaving ? messages.saving : messages.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
