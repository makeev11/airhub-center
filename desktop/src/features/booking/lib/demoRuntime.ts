const runtimeEnvironment = import.meta.env as
  | { DEV?: boolean; MODE?: string }
  | undefined;

export const isAirhopDemoRuntimeAvailable = Boolean(
  runtimeEnvironment?.DEV || runtimeEnvironment?.MODE === "e2e",
);
