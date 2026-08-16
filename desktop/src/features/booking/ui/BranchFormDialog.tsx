import { Check, Plus, Search } from "lucide-react";
import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import {
  findBuzzWorkChannel,
  normalizeBuzzChannelName,
  suggestBuzzWorkChannels,
} from "@/features/booking/lib/buzzChannelRouting";
import {
  cloneWorkingHours,
  findWorkingHoursOverlaps,
  invalidWorkingPeriods,
} from "@/features/booking/lib/bookingAdmin";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  branchSchema,
  type BookingBranch,
  type WeeklyWorkingHours,
} from "@/features/booking/model/bookingCore";
import { BookingFeedbackBanners } from "@/features/booking/ui/BookingWorkspaceState";
import { WorkingHoursEditor } from "@/features/booking/ui/WorkingHoursEditor";
import { useBookingUnsavedChangesGuard } from "@/features/booking/ui/useBookingUnsavedChangesGuard";
import {
  useChannelsQuery,
  useCreateChannelMutation,
} from "@/features/channels/hooks";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

type BranchForm = {
  id: string;
  name: string;
  address: string;
  buzzChannelName: string;
  originalBuzzChannelId: string;
  workingHours: WeeklyWorkingHours;
};

function createBranchId(): string {
  return `branch-${crypto.randomUUID()}`;
}

function defaultWorkingHours(): WeeklyWorkingHours {
  return {
    monday: [{ startTime: "09:00", endTime: "18:00" }],
    tuesday: [{ startTime: "09:00", endTime: "18:00" }],
    wednesday: [{ startTime: "09:00", endTime: "18:00" }],
    thursday: [{ startTime: "09:00", endTime: "18:00" }],
    friday: [{ startTime: "09:00", endTime: "18:00" }],
    saturday: [],
    sunday: [],
  };
}

function formFromBranch(branch: BookingBranch | null): BranchForm {
  return branch
    ? {
        id: branch.id,
        name: branch.name,
        address: branch.address,
        buzzChannelName: "",
        originalBuzzChannelId: branch.defaultBuzzChannelId ?? "",
        workingHours: cloneWorkingHours(branch.workingHours),
      }
    : {
        id: createBranchId(),
        name: "",
        address: "",
        buzzChannelName: "",
        originalBuzzChannelId: "",
        workingHours: defaultWorkingHours(),
      };
}

function FormField({
  children,
  error,
  hint,
  label,
}: {
  children: React.ReactNode;
  error?: string;
  hint?: string;
  label: string;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      {!error && hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

export function BranchFormDialog({
  branch,
  onOpenChange,
  onSaved,
  open,
}: {
  branch: BookingBranch | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (kind: "created" | "updated") => void;
  open: boolean;
}) {
  const booking = useBookingWorkspace();
  const channelsQuery = useChannelsQuery({ enabled: open });
  const createChannel = useCreateChannelMutation();
  const workspace = booking.workspace;
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const [form, setForm] = React.useState<BranchForm>(() =>
    formFromBranch(branch),
  );
  const [baseline, setBaseline] = React.useState<BranchForm | null>(null);
  const [errors, setErrors] = React.useState<{
    name?: string;
    address?: string;
    channel?: string;
    hours?: string;
  }>({});
  const [overlapConfirmed, setOverlapConfirmed] = React.useState(false);
  const [channelTouched, setChannelTouched] = React.useState(false);
  const freshBranch = branch
    ? (workspace?.branches.find((candidate) => candidate.id === branch.id) ??
      null)
    : null;

  React.useEffect(() => {
    if (!open) return;
    const fresh = formFromBranch(freshBranch);
    setForm(fresh);
    setBaseline(fresh);
    setErrors({});
    setOverlapConfirmed(false);
    setChannelTouched(false);
  }, [freshBranch, open]);

  React.useEffect(() => {
    if (
      !open ||
      channelTouched ||
      !freshBranch?.defaultBuzzChannelId ||
      form.buzzChannelName
    ) {
      return;
    }
    const linkedChannel = channelsQuery.data?.find(
      (channel) => channel.id === freshBranch.defaultBuzzChannelId,
    );
    if (!linkedChannel) return;
    setForm((current) => ({
      ...current,
      buzzChannelName: linkedChannel.name,
    }));
    setBaseline((current) =>
      current ? { ...current, buzzChannelName: linkedChannel.name } : current,
    );
  }, [
    channelTouched,
    channelsQuery.data,
    form.buzzChannelName,
    freshBranch?.defaultBuzzChannelId,
    open,
  ]);

  const normalizedChannelName = normalizeBuzzChannelName(form.buzzChannelName);
  const matchedChannel = findBuzzWorkChannel(
    channelsQuery.data ?? [],
    normalizedChannelName,
  );
  const suggestedChannels = matchedChannel
    ? []
    : suggestBuzzWorkChannels(channelsQuery.data ?? [], normalizedChannelName);

  const overlaps = findWorkingHoursOverlaps(form.workingHours);
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
    const nextErrors: typeof errors = {};
    if (!form.name.trim()) nextErrors.name = messages.requiredField;
    if (!form.address.trim()) nextErrors.address = messages.requiredField;
    if (invalidWorkingPeriods(form.workingHours).length) {
      nextErrors.hours = messages.invalidWorkingPeriod;
    }
    if (overlaps.length && !overlapConfirmed) {
      nextErrors.hours = messages.overlapWarningDescription;
    }
    const baseBranch = branchSchema.safeParse({
      id: form.id,
      organizationId: workspace.organization.id,
      name: form.name,
      address: form.address,
      workingHours: form.workingHours,
      status: freshBranch?.status ?? "active",
    });
    if (!baseBranch.success) {
      for (const issue of baseBranch.error.issues) {
        if (issue.path[0] === "defaultBuzzChannelId") {
          nextErrors.channel = issue.message;
        }
      }
    }
    if (Object.keys(nextErrors).length || !baseBranch.success) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    let channelId =
      !channelTouched && form.originalBuzzChannelId
        ? form.originalBuzzChannelId
        : undefined;
    if (normalizedChannelName) {
      try {
        const refreshedChannels = await channelsQuery.refetch();
        if (refreshedChannels.isError) throw refreshedChannels.error;
        const existingChannel = findBuzzWorkChannel(
          refreshedChannels.data ?? [],
          normalizedChannelName,
        );
        if (existingChannel) {
          channelId = existingChannel.id;
        } else {
          const createdChannel = await createChannel.mutateAsync({
            name: normalizedChannelName,
            channelType: "stream",
            visibility: "private",
            description: messages.buzzChannelDescription(
              form.name.trim() || messages.branchName,
            ),
          });
          channelId = createdChannel.id;
        }
      } catch {
        setErrors({ channel: messages.buzzChannelLookupError });
        return;
      }
    }

    const parsed = branchSchema.safeParse({
      ...baseBranch.data,
      ...(channelId ? { defaultBuzzChannelId: channelId } : {}),
    });
    if (!parsed.success) {
      setErrors({ channel: messages.buzzChannelLookupError });
      return;
    }
    try {
      await booking.save((current) => {
        const { revision: _revision, ...draft } = current;
        const exists = current.branches.some(
          (candidate) => candidate.id === parsed.data.id,
        );
        return {
          ...draft,
          branches: exists
            ? current.branches.map((candidate) =>
                candidate.id === parsed.data.id ? parsed.data : candidate,
              )
            : [...current.branches, parsed.data],
        };
      });
      onSaved(branch ? "updated" : "created");
      onOpenChange(false);
    } catch {
      // Shared feedback keeps the form open for conflict review or retry.
    }
  };

  return (
    <Dialog onOpenChange={requestOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col overflow-hidden p-0"
        data-testid="airhop-branch-form"
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pr-14">
          <DialogTitle>
            {branch ? messages.editBranchTitle : messages.createBranchTitle}
          </DialogTitle>
          <DialogDescription>
            {branch
              ? messages.editBranchDescription
              : messages.createBranchDescription}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={(event) => void submit(event)}
        >
          <div
            className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-2"
            data-testid="airhop-branch-form-scroll"
          >
            <BookingFeedbackBanners />
            <div className="grid gap-4 md:grid-cols-2">
              <FormField error={errors.name} label={messages.branchName}>
                <Input
                  aria-label={messages.branchName}
                  data-testid="airhop-branch-name"
                  maxLength={160}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  value={form.name}
                />
              </FormField>
              <FormField
                error={errors.channel}
                hint={messages.buzzChannelHint}
                label={messages.buzzChannel}
              >
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
                    data-testid="airhop-branch-channel-prefix"
                  >
                    #
                  </span>
                  <Input
                    aria-autocomplete="list"
                    aria-label={messages.buzzChannel}
                    className="pl-7"
                    data-testid="airhop-branch-channel"
                    maxLength={128}
                    onChange={(event) => {
                      setChannelTouched(true);
                      setErrors((current) => ({
                        ...current,
                        channel: undefined,
                      }));
                      setForm((current) => ({
                        ...current,
                        buzzChannelName: normalizeBuzzChannelName(
                          event.target.value,
                        ),
                        originalBuzzChannelId: "",
                      }));
                    }}
                    placeholder={messages.buzzChannelPlaceholder}
                    role="combobox"
                    value={form.buzzChannelName}
                  />
                </div>
                {normalizedChannelName ? (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground"
                    data-testid="airhop-branch-channel-status"
                  >
                    {channelsQuery.isLoading ? (
                      <Search className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : matchedChannel ? (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span>
                      {channelsQuery.isLoading
                        ? messages.buzzChannelSearching
                        : matchedChannel
                          ? messages.buzzChannelFound(matchedChannel.name)
                          : messages.buzzChannelWillCreate(
                              normalizedChannelName,
                            )}
                    </span>
                  </div>
                ) : null}
                {suggestedChannels.length ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{messages.buzzChannelSuggestions}</span>
                    {suggestedChannels.map((channel) => (
                      <button
                        className="rounded-md bg-muted px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent"
                        key={channel.id}
                        onClick={() => {
                          setChannelTouched(true);
                          setForm((current) => ({
                            ...current,
                            buzzChannelName: channel.name,
                            originalBuzzChannelId: "",
                          }));
                        }}
                        type="button"
                      >
                        #{channel.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </FormField>
            </div>
            <FormField error={errors.address} label={messages.branchAddress}>
              <Textarea
                aria-label={messages.branchAddress}
                data-testid="airhop-branch-address"
                maxLength={500}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    address: event.target.value,
                  }))
                }
                value={form.address}
              />
            </FormField>
            <WorkingHoursEditor
              messages={messages}
              onChange={(workingHours) => {
                setOverlapConfirmed(false);
                setForm((current) => ({ ...current, workingHours }));
              }}
              value={form.workingHours}
            />
            {overlaps.length ? (
              <Alert>
                <AlertTitle>{messages.overlapWarningTitle}</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{messages.overlapWarningDescription}</p>
                  <p>
                    {[
                      ...new Set(
                        overlaps.map(
                          ({ weekday }) => messages.weekdayNames[weekday],
                        ),
                      ),
                    ].join(", ")}
                  </p>
                  <div className="flex items-center gap-2 font-medium">
                    <Checkbox
                      aria-label={messages.overlapConfirmation}
                      checked={overlapConfirmed}
                      onCheckedChange={(checked) =>
                        setOverlapConfirmed(checked === true)
                      }
                    />
                    {messages.overlapConfirmation}
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}
            {errors.hours ? (
              <p className="text-sm text-destructive">{errors.hours}</p>
            ) : null}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/70 px-6 py-4">
            <Button
              onClick={() => requestOpenChange(false)}
              type="button"
              variant="outline"
            >
              {messages.cancel}
            </Button>
            <Button
              disabled={booking.isSaving || createChannel.isPending || !dirty}
              type="submit"
            >
              {booking.isSaving || createChannel.isPending
                ? messages.saving
                : messages.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
