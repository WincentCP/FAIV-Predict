"use client";

import { Info } from "lucide-react";
import { TierBadge } from "@/components/TierBadge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  compareRealizedTier,
  formatThreshold,
  type RealizedClassBasis,
} from "@/lib/realized-outcomes";
import type { Tier } from "@/lib/types";
import { cn } from "@/lib/utils";

export function OutcomeComparison({
  predictedTier,
  realizedTier,
  basis,
  compact = false,
}: {
  predictedTier: Tier;
  realizedTier: Tier;
  basis: RealizedClassBasis | null;
  compact?: boolean;
}) {
  const comparison = compareRealizedTier(predictedTier, realizedTier);
  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Predicted</span>
        <TierBadge tier={predictedTier} />
        <span aria-hidden="true" className="text-muted-foreground">→</span>
        <span className="text-xs font-semibold text-muted-foreground">Observed</span>
        <TierBadge tier={realizedTier} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(
          "inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold",
          comparison.kind === "match" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          comparison.kind === "one_off" && "border-warning/30 bg-warning/10 text-warning",
          comparison.kind === "miss" && "border-destructive/25 bg-destructive/10 text-destructive",
        )}>
          {comparison.label}
        </span>
        {basis && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="Show the thresholds used for the observed tier"
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                Threshold basis
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] rounded-xl p-4">
              <p className="text-sm font-semibold text-foreground">Observed tier basis</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Observed under the same thresholds the model was trained with.
              </p>
              <dl className="mt-3 space-y-2 text-xs">
                <Threshold term="Low" value={`Below ${formatThreshold(basis.p33_threshold)}`} />
                <Threshold term="Average" value={`${formatThreshold(basis.p33_threshold)} to ${formatThreshold(basis.p67_threshold)}`} />
                <Threshold term="High" value={`Above ${formatThreshold(basis.p67_threshold)}`} />
              </dl>
              <p className="mt-3 break-all text-xs leading-relaxed text-muted-foreground">
                Model {basis.model_version || basis.model_id}
                {basis.minimum_post_age_days != null ? ` · observed after at least ${basis.minimum_post_age_days} days` : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Computed <time dateTime={basis.computed_at}>{formatDateTime(basis.computed_at)}</time></p>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

function Threshold({ term, value }: { term: string; value: string }) {
  return <div className="flex items-center justify-between gap-4"><dt className="font-semibold text-foreground">{term}</dt><dd className="text-right text-muted-foreground">{value}</dd></div>;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "at an unavailable time" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
