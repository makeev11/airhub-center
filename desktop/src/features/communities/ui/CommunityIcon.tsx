import { cn } from "@/shared/lib/cn";

/** Render the community’s chosen logo, or a sunflower without a background. */
export function CommunityIcon({
  className,
  iconUrl,
}: {
  className: string;
  iconUrl?: string | null;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center leading-none",
        className,
      )}
    >
      {iconUrl ? (
        <img
          alt=""
          className="h-full w-full rounded-md object-cover"
          draggable={false}
          src={iconUrl}
        />
      ) : (
        "🌻"
      )}
    </span>
  );
}
