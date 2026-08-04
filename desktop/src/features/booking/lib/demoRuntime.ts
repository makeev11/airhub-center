export const isAirhopDemoRuntimeAvailable =
  import.meta.env.DEV || import.meta.env.MODE === "e2e";

export function shouldUseAirhopDemo(demo: unknown) {
  return isAirhopDemoRuntimeAvailable && demo === "airhop";
}
