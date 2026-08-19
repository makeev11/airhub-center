import { useSyncExternalStore } from "react";

import {
  resolveAirHopLocale,
  subscribeAirHopLocale,
  type AirHopLocale,
} from "./airhopLocale";

/** Reactive source of truth for all private Airhop interface copy. */
export function useAirHopLocale(): AirHopLocale {
  return useSyncExternalStore(
    subscribeAirHopLocale,
    resolveAirHopLocale,
    resolveAirHopLocale,
  );
}
