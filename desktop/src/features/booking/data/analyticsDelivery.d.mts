/** Bounded first-party delivery queue shared with the managed-site collector. */
export function createAnalyticsDelivery(env: Window & typeof globalThis): {
  capture(events: object[]): void;
  flush(): Promise<void>;
  dispose(): void;
};
