import {
  parseBookingWorkspace,
  type BookingWorkspace,
  type BookingWorkspaceDraft,
} from "@/features/booking/model/bookingCore";

export interface BookingRepository {
  load(): Promise<BookingWorkspace>;
  save(
    draft: BookingWorkspaceDraft,
    expectedRevision: number,
  ): Promise<BookingWorkspace>;
  takeNotice?(): BookingRepositoryNotice | null;
}

export type BookingRepositoryNotice = "corrupt-data-recovered";

export class BookingRevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Booking workspace changed: expected revision ${expectedRevision}, actual revision ${actualRevision}`,
    );
    this.name = "BookingRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class BookingStorageUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BookingStorageUnavailableError";
  }
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface BookingLockCoordinator {
  runExclusive<T>(name: string, task: () => Promise<T>): Promise<T>;
}

function cloneWorkspace(workspace: BookingWorkspace): BookingWorkspace {
  return parseBookingWorkspace(JSON.parse(JSON.stringify(workspace)));
}

function withNextRevision(
  draft: BookingWorkspaceDraft,
  revision: number,
): BookingWorkspace {
  return parseBookingWorkspace({ ...draft, revision });
}

export class InMemoryBookingRepository implements BookingRepository {
  private workspace: BookingWorkspace;

  constructor(initialWorkspace: BookingWorkspace) {
    this.workspace = cloneWorkspace(initialWorkspace);
  }

  async load(): Promise<BookingWorkspace> {
    return cloneWorkspace(this.workspace);
  }

  async save(
    draft: BookingWorkspaceDraft,
    expectedRevision: number,
  ): Promise<BookingWorkspace> {
    if (this.workspace.revision !== expectedRevision) {
      throw new BookingRevisionConflictError(
        expectedRevision,
        this.workspace.revision,
      );
    }
    this.workspace = withNextRevision(draft, expectedRevision + 1);
    return cloneWorkspace(this.workspace);
  }
}

export class BrowserPreviewBookingRepository implements BookingRepository {
  private readonly storage: StorageLike;
  private readonly storageKey: string;
  private readonly initialWorkspace: BookingWorkspace;
  private readonly lockCoordinator?: BookingLockCoordinator;
  private coordination: "web-locks" | "best-effort";
  private notice: BookingRepositoryNotice | null = null;

  constructor({
    storage,
    storageKey,
    initialWorkspace,
    lockCoordinator,
  }: {
    storage: StorageLike;
    storageKey: string;
    initialWorkspace: BookingWorkspace;
    lockCoordinator?: BookingLockCoordinator;
  }) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.initialWorkspace = cloneWorkspace(initialWorkspace);
    this.lockCoordinator = lockCoordinator;
    this.coordination = lockCoordinator ? "web-locks" : "best-effort";
  }

  get writeCoordination(): "web-locks" | "best-effort" {
    return this.coordination;
  }

  async load(): Promise<BookingWorkspace> {
    let stored: string | null;
    try {
      stored = this.storage.getItem(this.storageKey);
    } catch (error) {
      throw new BookingStorageUnavailableError(
        "Browser preview storage could not be read",
        { cause: error },
      );
    }
    if (!stored) return cloneWorkspace(this.initialWorkspace);

    try {
      return parseBookingWorkspace(JSON.parse(stored));
    } catch {
      try {
        this.storage.setItem(`${this.storageKey}.corrupt-backup`, stored);
        this.storage.setItem(
          this.storageKey,
          JSON.stringify(this.initialWorkspace),
        );
      } catch (storageError) {
        throw new BookingStorageUnavailableError(
          "Browser preview storage is damaged and could not be recovered",
          { cause: storageError },
        );
      }
      this.notice = "corrupt-data-recovered";
      return cloneWorkspace(this.initialWorkspace);
    }
  }

  async save(
    draft: BookingWorkspaceDraft,
    expectedRevision: number,
  ): Promise<BookingWorkspace> {
    if (!this.lockCoordinator) {
      // The revision is re-read immediately before writing, but localStorage
      // has no compare-and-swap primitive. Without Web Locks this remains an
      // explicit best-effort guard against cross-tab races.
      return this.saveWithRevisionCheck(draft, expectedRevision);
    }

    let enteredLock = false;
    try {
      return await this.lockCoordinator.runExclusive(
        `buzz-airhop:booking:${this.storageKey}`,
        async () => {
          enteredLock = true;
          return this.saveWithRevisionCheck(draft, expectedRevision);
        },
      );
    } catch (error) {
      if (enteredLock) throw error;
      // A present-but-unusable Web Locks implementation should not make the
      // local preview unwritable. Fall back visibly in the repository's
      // capability state; the revision check is then best effort.
      this.coordination = "best-effort";
      return this.saveWithRevisionCheck(draft, expectedRevision);
    }
  }

  private async saveWithRevisionCheck(
    draft: BookingWorkspaceDraft,
    expectedRevision: number,
  ): Promise<BookingWorkspace> {
    const current = await this.load();
    if (current.revision !== expectedRevision) {
      throw new BookingRevisionConflictError(
        expectedRevision,
        current.revision,
      );
    }
    const next = withNextRevision(draft, expectedRevision + 1);
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(next));
    } catch (error) {
      throw new BookingStorageUnavailableError(
        "Browser preview storage could not save changes",
        { cause: error },
      );
    }
    return cloneWorkspace(next);
  }

  takeNotice(): BookingRepositoryNotice | null {
    const notice = this.notice;
    this.notice = null;
    return notice;
  }
}
