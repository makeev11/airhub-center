import * as React from "react";

import { useAirHopLocale } from "@/features/activation/useAirHopLocale";
import {
  BookingRevisionConflictError,
  type BookingRepository,
  type BookingRepositoryNotice,
} from "@/features/booking/data/bookingRepository";
import { createDemoBookingRepository } from "@/features/booking/data/demoBookingRepository";
import type {
  StaffBookingDecisionOutcome,
  StaffBookingDecisionService,
} from "@/features/booking/data/staffBookingDecisionService";
import type {
  BookingWorkspace,
  BookingWorkspaceDraft,
} from "@/features/booking/model/bookingCore";
import { setStaffBookingStatus } from "@/features/booking/model/bookingMutations";

type BookingWorkspaceStatus = "loading" | "ready" | "error" | "unavailable";

type BookingConflict = {
  expectedRevision: number;
  actualRevision: number;
};

type BookingWorkspaceContextValue = {
  status: BookingWorkspaceStatus;
  workspace: BookingWorkspace | null;
  error: Error | null;
  notice: BookingRepositoryNotice | null;
  conflict: BookingConflict | null;
  isSaving: boolean;
  save: (
    update: (workspace: BookingWorkspace) => BookingWorkspaceDraft,
  ) => Promise<BookingWorkspace>;
  decideBooking: (
    bookingId: string,
    status: "confirmed" | "rejected",
  ) => Promise<StaffBookingDecisionOutcome | null>;
  reload: () => Promise<void>;
  dismissNotice: () => void;
  dismissConflict: () => void;
};

const BookingWorkspaceContext = React.createContext<
  BookingWorkspaceContextValue | undefined
>(undefined);

function defaultRepository(storageScope?: string): {
  repository: BookingRepository | null;
  error: Error | null;
} {
  try {
    return {
      repository: createDemoBookingRepository(storageScope),
      error: null,
    };
  } catch (error) {
    return {
      repository: null,
      error:
        error instanceof Error
          ? error
          : new Error("Booking repository could not be created"),
    };
  }
}

export function BookingWorkspaceProvider({
  children,
  decisionService,
  repository: repositoryOverride,
  storageScope,
}: {
  children: React.ReactNode;
  decisionService?: StaffBookingDecisionService;
  repository?: BookingRepository | null;
  storageScope?: string;
}) {
  const interfaceLocale = useAirHopLocale();
  const [repositoryState] = React.useState(() =>
    repositoryOverride === undefined
      ? defaultRepository(storageScope)
      : { repository: repositoryOverride, error: null },
  );
  const repository = repositoryState.repository;
  const [workspace, setWorkspace] = React.useState<BookingWorkspace | null>(
    null,
  );
  const workspaceRef = React.useRef<BookingWorkspace | null>(null);
  const [status, setStatus] = React.useState<BookingWorkspaceStatus>(() =>
    repositoryState.error ? "error" : repository ? "loading" : "unavailable",
  );
  const [error, setError] = React.useState<Error | null>(repositoryState.error);
  const [notice, setNotice] = React.useState<BookingRepositoryNotice | null>(
    null,
  );
  const [conflict, setConflict] = React.useState<BookingConflict | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const mountedRef = React.useRef(false);
  const loadedLocaleRef = React.useRef<string | null>(null);
  const pendingLoadRef = React.useRef<Promise<BookingWorkspace> | null>(null);
  const pendingSaveRef = React.useRef<Promise<BookingWorkspace> | null>(null);

  const applyWorkspace = React.useCallback((next: BookingWorkspace) => {
    workspaceRef.current = next;
    setWorkspace(next);
    setStatus("ready");
    setError(null);
  }, []);

  const load = React.useCallback(
    async (force = false) => {
      if (!repository) {
        setStatus(repositoryState.error ? "error" : "unavailable");
        return;
      }
      let pending = pendingLoadRef.current;
      if (!pending || force) {
        setStatus("loading");
        setError(null);
        pending = repository.load();
        pendingLoadRef.current = pending;
      }
      try {
        const next = await pending;
        if (!mountedRef.current) return;
        applyWorkspace(next);
        setNotice(repository.takeNotice?.() ?? null);
      } catch (loadError) {
        if (!mountedRef.current) return;
        setError(
          loadError instanceof Error
            ? loadError
            : new Error("Booking workspace could not be loaded"),
        );
        setStatus("error");
      } finally {
        if (pendingLoadRef.current === pending) pendingLoadRef.current = null;
      }
    },
    [applyWorkspace, repository, repositoryState.error],
  );

  React.useEffect(() => {
    const forceReload =
      loadedLocaleRef.current !== null &&
      loadedLocaleRef.current !== interfaceLocale;
    loadedLocaleRef.current = interfaceLocale;
    mountedRef.current = true;
    void load(forceReload);
    return () => {
      mountedRef.current = false;
    };
  }, [interfaceLocale, load]);

  const save = React.useCallback(
    async (
      update: (current: BookingWorkspace) => BookingWorkspaceDraft,
    ): Promise<BookingWorkspace> => {
      if (!repository) throw new Error("Booking repository is unavailable");
      if (pendingSaveRef.current) {
        throw new Error("Booking workspace save is already in progress");
      }
      const current = workspaceRef.current;
      if (!current) throw new Error("Booking workspace is not loaded");

      setIsSaving(true);
      setError(null);
      setConflict(null);
      let savePromise: Promise<BookingWorkspace> | null = null;
      try {
        const draft = update(current);
        savePromise = repository.save(draft, current.revision);
        pendingSaveRef.current = savePromise;
        const saved = await savePromise;
        if (mountedRef.current) {
          applyWorkspace(saved);
          setNotice(repository.takeNotice?.() ?? null);
        }
        return saved;
      } catch (saveError) {
        if (saveError instanceof BookingRevisionConflictError) {
          if (mountedRef.current) {
            setConflict({
              expectedRevision: saveError.expectedRevision,
              actualRevision: saveError.actualRevision,
            });
          }
          try {
            const latest = await repository.load();
            if (mountedRef.current) applyWorkspace(latest);
          } catch {
            // Keep the conflict as the primary actionable error. A manual
            // reload remains available if fetching the latest revision fails.
          }
        } else if (mountedRef.current) {
          setError(
            saveError instanceof Error
              ? saveError
              : new Error("Booking workspace could not be saved"),
          );
        }
        throw saveError;
      } finally {
        if (savePromise && pendingSaveRef.current === savePromise) {
          pendingSaveRef.current = null;
        }
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [applyWorkspace, repository],
  );

  const decideBooking = React.useCallback(
    async (
      bookingId: string,
      nextStatus: "confirmed" | "rejected",
    ): Promise<StaffBookingDecisionOutcome | null> => {
      if (!decisionService) {
        await save((current) =>
          setStaffBookingStatus(
            current,
            bookingId,
            nextStatus,
            new Date().toISOString(),
          ),
        );
        return null;
      }
      if (!repository) throw new Error("Booking repository is unavailable");
      if (pendingSaveRef.current) {
        throw new Error("Booking workspace save is already in progress");
      }

      setIsSaving(true);
      setError(null);
      setConflict(null);
      try {
        const outcome = await decisionService.decideBooking({
          bookingId,
          decision: nextStatus === "confirmed" ? "confirm" : "reject",
        });
        // A server command is never projected by mutating the client cache.
        // Reload the authoritative read model after the command is accepted.
        const latest = await repository.load();
        const projected = latest.bookings.find(
          (booking) => booking.id === bookingId,
        );
        if (!projected || projected.status !== outcome.status) {
          throw new Error(
            "The booking decision was accepted, but the read model has not caught up yet. Reload the requests.",
          );
        }
        if (mountedRef.current) applyWorkspace(latest);
        return outcome;
      } catch (decisionError) {
        if (mountedRef.current) {
          setError(
            decisionError instanceof Error
              ? decisionError
              : new Error("Booking decision could not be saved"),
          );
        }
        throw decisionError;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [applyWorkspace, decisionService, repository, save],
  );

  const value = React.useMemo<BookingWorkspaceContextValue>(
    () => ({
      status,
      workspace,
      error,
      notice,
      conflict,
      isSaving,
      save,
      decideBooking,
      reload: () => load(true),
      dismissNotice: () => setNotice(null),
      dismissConflict: () => setConflict(null),
    }),
    [
      conflict,
      decideBooking,
      error,
      isSaving,
      load,
      notice,
      save,
      status,
      workspace,
    ],
  );

  return (
    <BookingWorkspaceContext.Provider value={value}>
      {children}
    </BookingWorkspaceContext.Provider>
  );
}

export function useBookingWorkspace(): BookingWorkspaceContextValue {
  const value = React.useContext(BookingWorkspaceContext);
  if (!value) {
    throw new Error(
      "useBookingWorkspace must be used inside BookingWorkspaceProvider",
    );
  }
  return value;
}
