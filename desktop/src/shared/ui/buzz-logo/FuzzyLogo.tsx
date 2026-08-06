import { AirHopLoadingMark } from "@/shared/ui/airhop-brand/AirHopBrand";

type LegacyAnimationVariant =
  | "v1"
  | "v2"
  | "v3"
  | "v4"
  | "v5"
  | "v6"
  | "v7"
  | "v8";

export type FuzzyLogoProps = {
  fuzz?: boolean;
  className?: string;
  ariaLabel?: string;
  loop?: boolean;
  loopRestSeconds?: number;
  pulse?: boolean;
  reverse?: boolean;
  variant?: LegacyAnimationVariant;
};

/** AirHop compatibility adapter for older loading-indicator call sites. */
export function FuzzyLogo({ className, ariaLabel = "AirHop" }: FuzzyLogoProps) {
  return <AirHopLoadingMark ariaLabel={ariaLabel} className={className} />;
}
