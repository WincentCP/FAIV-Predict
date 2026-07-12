import { cn } from "@/lib/utils";
import { type Tier, TIER_META } from "@/lib/types";

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  const meta = TIER_META[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.02em] ring-1 ring-inset",
        meta.bg,
        meta.color,
        meta.ring,
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

