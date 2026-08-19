const routes = Object.freeze([
  "home",
  "agents",
  "reminders",
  "settings",
  "messages.new",
  "channels.view",
  "channels.post",
  "booking.public",
  "booking.demo-host",
  "booking.manage",
  "booking.schedule",
  "booking.requests",
  "booking.clients",
  "booking.branches",
  "booking.groups",
  "booking.tariffs",
  "booking.payments",
  "booking.analytics",
  "booking.teachers",
  "booking.settings",
] as const);

const settings = Object.freeze([
  "profile",
  "appearance",
  "notifications",
  "shortcuts",
  "agents",
  "community-members",
  "custom-emoji",
  "mobile",
  "updates",
] as const);

const nativeCapabilities = Object.freeze([
  "identity",
  "keyring",
  "relay",
  "messaging",
  "agents",
  "notifications",
  "updates",
  "pairing",
  "booking",
  "dictation",
  "secure-storage",
] as const);

const relaySurfaces = Object.freeze([
  "health",
  "relay",
  "nip05",
  "media",
  "membership",
  "invites",
  "pairing",
  "notifications",
  "agents",
  "booking",
  "provisioning",
] as const);

const sidecars = Object.freeze([
  "buzz-acp",
  "buzz-agent",
  "airhop-agent-mcp",
  "buzz",
] as const);

export const AIRHOP_PRODUCT = Object.freeze({
  routes,
  settings,
  nativeCapabilities,
  relaySurfaces,
  sidecars,
});

export type AirHopRouteId = (typeof routes)[number];
export type AirHopSettingId = (typeof settings)[number];
export type AirHopNativeCapability = (typeof nativeCapabilities)[number];
export type AirHopRelaySurface = (typeof relaySurfaces)[number];

function includesString(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}

export function isAirHopRouteAllowed(value: unknown): value is AirHopRouteId {
  return includesString(routes, value);
}

export function isAirHopSettingAllowed(
  value: unknown,
): value is AirHopSettingId {
  return includesString(settings, value);
}

export function isAirHopNativeCapabilityAllowed(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const [namespace] = value.split(".", 1);
  return includesString(nativeCapabilities, namespace);
}

export function isAirHopRelaySurfaceAllowed(
  value: unknown,
): value is AirHopRelaySurface {
  return includesString(relaySurfaces, value);
}
