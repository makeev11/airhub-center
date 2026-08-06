import { AirHopMark } from "@/shared/ui/airhop-brand/AirHopBrand";

/**
 * Compatibility adapter for established callers in the Buzz-derived shell.
 * The centers product must render the AirHop mark on every product surface.
 */
export function BuzzMark({ className }: { className?: string }) {
  return <AirHopMark className={className} />;
}
