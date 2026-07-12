"use client";

import { FlaskConical, ArrowRight, TrendingUp, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel } from "./Panel";

export interface Counterfactual {
  parameter: string;
  change: string;
  from_value: string | number;
  to_value: string | number;
  from_prob_high: number;
  to_prob_high: number;
  delta_high: number;
  new_predicted_class: string;
  tier_changed: boolean;
}

// Changes the UI can stage automatically for editing the draft.
// Only posting hour can be applied without inventing creative content. The
// model measures CTA presence and hashtag count, but it does not validate the
// wording of a CTA or which hashtags are appropriate for a brand.
const AUTO_APPLICABLE = new Set(["post_hour"]);

/**
 * Counterfactual sensitivity results. These are model simulations, not causal
 * estimates of real engagement uplift. The final edited draft must be scored
 * again because a text edit can change several features at once.
 */
export function MeasuredImprovements({
  counterfactuals,
  note,
  appliedRecs,
  onToggle,
}: {
  counterfactuals: Counterfactual[];
  note: string | null;
  appliedRecs: Record<string, boolean>;
  onToggle: (parameter: string) => void;
}) {
  const gains = counterfactuals.filter((c) => c.delta_high > 0);
  const flat = counterfactuals.filter((c) => c.delta_high <= 0);

  return (
    <Panel
      title="Tested decisions"
      subtitle="One input was changed at a time while the other inputs stayed fixed. Score movements are planning clues—not causal or guaranteed engagement uplift."
    >
      {note ? (
        <p className="rounded-xl border border-border bg-surface-2/50 p-4 text-sm leading-relaxed text-muted-foreground">{note}</p>
      ) : counterfactuals.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface-2/50 p-4 text-sm leading-relaxed text-muted-foreground">
          No supported single-feature scenario increased this draft&apos;s model score.
        </p>
      ) : (
        <div className="space-y-3">
          {gains.map((c) => {
            const canApply = AUTO_APPLICABLE.has(c.parameter);
            const isApplied = appliedRecs[c.parameter] || false;
            return (
              <article
                key={c.parameter + String(c.to_value)}
                className={cn(
                  "rounded-xl border bg-surface p-4 transition-colors",
                  isApplied ? "border-primary bg-primary/[0.03]" : "border-border hover:border-border-strong"
                )}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        <FlaskConical className="h-2.5 w-2.5" />
                        Simulation
                      </span>
                      {c.tier_changed && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          <TrendingUp className="h-2.5 w-2.5" />
                          Tier becomes {c.new_predicted_class}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-foreground">{c.change}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
                      Raw High score {c.from_prob_high}/100
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-bold text-foreground">{c.to_prob_high}/100</span>
                      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                        +{c.delta_high} raw points
                      </span>
                    </p>
                  </div>
                  {canApply ? (
                    <button
                      type="button"
                      onClick={() => onToggle(c.parameter)}
                      aria-pressed={isApplied}
                      aria-label={`${isApplied ? "Remove" : "Stage"} posting-hour change: ${c.change}`}
                      className={cn(
                        "relative inline-flex h-11 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent p-1 transition-colors duration-200 ease-in-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        isApplied ? "bg-foreground" : "bg-surface-3"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                          isApplied ? "translate-x-6" : "translate-x-0"
                        )}
                      />
                    </button>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-1 text-xs font-semibold text-muted-foreground">
                      <Clock3 className="h-3 w-3" /> Edit manually
                    </span>
                  )}
                </div>
              </article>
            );
          })}

          {flat.length > 0 && (
            <p className="rounded-xl border border-border/60 bg-surface-2/30 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
              No model-score increase from:{" "}
              {flat.map((c) => c.change.toLowerCase()).join(" · ")}. This does not prove that the
              change would help or hurt real engagement.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
