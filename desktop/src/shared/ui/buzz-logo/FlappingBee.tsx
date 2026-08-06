import { AirHopLoadingMark } from "@/shared/ui/airhop-brand/AirHopBrand";

/** AirHop compatibility adapter for older cold-start call sites. */
export function FlappingBee({ className }: { className?: string }) {
  return <AirHopLoadingMark ariaLabel="AirHop" className={className} />;
}
