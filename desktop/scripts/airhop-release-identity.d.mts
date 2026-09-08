export interface AirhopReleaseIdentity {
  schemaVersion: number;
  product: string;
  releaseId: string;
  version: string;
  commit: string;
  tree: string;
  databaseMigration: number;
}

export const repositoryRoot: string;
export function readDesktopVersion(root?: string): string;
export function readReleaseIdentity(
  root: string | undefined,
  expectedCommit: string | undefined,
): AirhopReleaseIdentity;
