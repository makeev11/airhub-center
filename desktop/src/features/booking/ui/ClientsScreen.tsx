import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Search, UsersRound } from "lucide-react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { currentAirhopStaffDataRuntime } from "@/features/booking/data/staffDataRuntime";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { searchFamilySummaries } from "@/features/booking/lib/bookingClients";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { FamilyCreateDialog } from "@/features/booking/ui/FamilyCreateDialog";
import { ServerClientsScreen } from "@/features/booking/ui/ServerClientsScreen";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";

function ClientsContent({ onAdd }: { onAdd: () => void }) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<"active" | "archived">("active");
  const summaries = searchFamilySummaries(workspace, query).filter(
    (summary) => summary.family.status === status,
  );

  return (
    <div className="space-y-4">
      <BookingFeedbackBanners />
      <div className="space-y-3 rounded-xl border border-border/70 bg-card p-3 sm:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={messages.clientSearch}
            className="pl-9"
            data-testid="airhop-client-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={messages.clientSearch}
            value={query}
          />
        </div>
        <fieldset className="flex gap-2">
          <legend className="sr-only">{messages.clientsTitle}</legend>
          {(["active", "archived"] as const).map((value) => (
            <Button
              aria-pressed={status === value}
              key={value}
              onClick={() => setStatus(value)}
              size="sm"
              variant={status === value ? "default" : "outline"}
            >
              {value === "active" ? messages.active : messages.archived}
            </Button>
          ))}
        </fieldset>
      </div>

      {!summaries.length ? (
        <Card className="space-y-3 p-8 text-center">
          <UsersRound className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{messages.noClientsTitle}</h2>
          <p className="text-sm text-muted-foreground">
            {messages.noClientsDescription}
          </p>
          {status === "active" ? (
            <Button onClick={onAdd}>
              <Plus />
              {messages.clientAddFamily}
            </Button>
          ) : null}
        </Card>
      ) : (
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          {summaries.map((summary) => (
            <Card
              asChild
              className="min-w-0 cursor-pointer space-y-4 p-4 transition-colors hover:bg-accent/35 sm:p-5"
              data-testid={`airhop-family-${summary.family.id}`}
              key={summary.family.id}
            >
              <Link
                params={{ familyId: summary.family.id }}
                to="/booking/clients/$familyId"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold">
                      {summary.family.displayName}
                    </h2>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {summary.primaryRepresentative.displayName} ·{" "}
                      {summary.primaryRepresentative.phoneDisplay}
                    </p>
                  </div>
                  {summary.requiresAttention ? (
                    <Badge variant="warning">
                      {messages.requestPossibleDuplicate}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {summary.children.map((child) => (
                    <Badge key={child.id} variant="secondary">
                      {child.displayName}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {messages.familyBookingsCount(summary.bookingCount)}
                </p>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceClientsScreen() {
  const booking = useBookingWorkspace();
  const navigate = useNavigate();
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  const [createOpen, setCreateOpen] = React.useState(false);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
        <PageHeader
          action={
            <Button
              data-testid="airhop-add-family"
              onClick={() => setCreateOpen(true)}
            >
              <Plus />
              {messages.clientAddFamily}
            </Button>
          }
          description={messages.clientsDescription}
          title={messages.clientsTitle}
        />
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6">
        <BookingWorkspaceGate>
          {() => <ClientsContent onAdd={() => setCreateOpen(true)} />}
        </BookingWorkspaceGate>
      </div>
      <FamilyCreateDialog
        onCreated={(familyId) =>
          void navigate({
            to: "/booking/clients/$familyId",
            params: { familyId },
          })
        }
        onOpenChange={setCreateOpen}
        open={createOpen}
      />
    </div>
  );
}

/** Chooses operational server data in production and workspace data in demos. */
export function ClientsScreen() {
  if (currentAirhopStaffDataRuntime() === "server") {
    return <ServerClientsScreen />;
  }
  return <WorkspaceClientsScreen />;
}
