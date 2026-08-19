import type { ReactNode } from "react";

import {
  type AirHopRouteId,
  type AirHopSettingId,
  isAirHopRouteAllowed,
  isAirHopSettingAllowed,
} from "./airhopProduct";

type ProductGateProps = {
  children: ReactNode;
  fallback?: ReactNode;
} & (
  | { route: AirHopRouteId; setting?: never }
  | { route?: never; setting: AirHopSettingId }
);

export function ProductGate({
  children,
  fallback = null,
  route,
  setting,
}: ProductGateProps) {
  const allowed = route
    ? isAirHopRouteAllowed(route)
    : isAirHopSettingAllowed(setting);
  return allowed ? children : fallback;
}
