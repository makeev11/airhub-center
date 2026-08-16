import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Database,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  UsersRound,
} from "lucide-react";

import { useStaffFamilyDirectory } from "@/features/booking/data/useStaffFamilyDirectory";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";
import { ServerFamilyCreateDialog } from "@/features/booking/ui/ServerFamilyCreateDialog";

/** Production client directory backed exclusively by Booking Core. */
export function ServerClientsScreen() {
  const navigate = useNavigate();
  const messages = getBookingAdminMessages("ru-RU");
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<"active" | "archived">("active");
  const [createOpen, setCreateOpen] = React.useState(false);
  const directory = useStaffFamilyDirectory({ search: query, status });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
        <PageHeader
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge variant="outline">
                <Database className="mr-1 h-3 w-3" />
                {messages.familySourceBookingCore}
              </Badge>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> {messages.clientAddFamily}
              </Button>
            </div>
          }
          description={messages.clientsDescription}
          title={messages.clientsTitle}
        />
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              {messages.clientsServerReadOnly}
            </AlertDescription>
          </Alert>
          <div className="space-y-3 rounded-xl border border-border/70 bg-card p-3 sm:p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={messages.clientSearch}
                className="pl-9"
                data-testid="airhop-server-client-search"
                maxLength={100}
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

          {directory.status === "loading" ? (
            <Card className="space-y-3 p-8 text-center">
              <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
              <h2 className="text-lg font-semibold">{messages.loadingTitle}</h2>
              <p className="text-sm text-muted-foreground">
                {messages.loadingDescription}
              </p>
            </Card>
          ) : directory.status === "error" ? (
            <Card className="space-y-3 p-8 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground" />
              <h2 className="text-lg font-semibold">
                {messages.loadErrorTitle}
              </h2>
              <p className="text-sm text-muted-foreground">
                {messages.loadErrorDescription}
              </p>
              <Button onClick={() => void directory.reload()} variant="outline">
                <RotateCcw /> {messages.retry}
              </Button>
            </Card>
          ) : !directory.items.length ? (
            <Card className="space-y-3 p-8 text-center">
              <UsersRound className="mx-auto h-8 w-8 text-muted-foreground" />
              <h2 className="text-lg font-semibold">
                {messages.noClientsTitle}
              </h2>
              <p className="text-sm text-muted-foreground">
                {messages.noClientsDescription}
              </p>
            </Card>
          ) : (
            <>
              <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                {directory.items.map((family) => (
                  <Card
                    asChild
                    className="min-w-0 cursor-pointer space-y-4 p-4 transition-colors hover:bg-accent/35 sm:p-5"
                    data-testid={`airhop-server-family-${family.id}`}
                    key={family.id}
                  >
                    <Link
                      params={{ familyId: family.id }}
                      to="/booking/clients/$familyId"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-base font-semibold">
                            {family.displayName}
                          </h2>
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {family.primaryRepresentative.displayName} ·{" "}
                            {family.primaryRepresentative.phoneDisplay}
                          </p>
                        </div>
                        {family.hasPendingDuplicate ? (
                          <Badge variant="warning">
                            {messages.requestPossibleDuplicate}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {family.children.map((child) => (
                          <Badge key={child.id} variant="secondary">
                            {child.displayName}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {messages.familyBookingsCount(family.bookingCount)} ·{" "}
                        {messages.familyActiveEnrollmentsCount(
                          family.activeEnrollmentCount,
                        )}
                      </p>
                    </Link>
                  </Card>
                ))}
              </div>
              {directory.hasMore ? (
                <div className="flex justify-center pt-1">
                  <Button
                    disabled={directory.isLoadingMore}
                    onClick={() => void directory.loadMore()}
                    variant="outline"
                  >
                    {directory.isLoadingMore
                      ? messages.requestLoadingMore
                      : messages.requestLoadMore}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      <ServerFamilyCreateDialog
        onCreated={(familyId) => {
          void navigate({
            params: { familyId },
            to: "/booking/clients/$familyId",
          });
        }}
        onOpenChange={setCreateOpen}
        open={createOpen}
      />
    </div>
  );
}
