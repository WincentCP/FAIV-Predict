"use client";

import { FlaskConical, ArrowRight, TrendingUp } from "lucide-react";
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
const AUTO_APPLICABLE = new Set(["post_hour", "has_cta", "hashtag_count"]);

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
      title="Model Sensitivity Scenarios"
      subtitle="The model simulated one feature at a time. These score changes are planning clues, not guaranteed or causal engagement uplift."
    >
      {note ? (
        <p className="rounded-xl border border-border bg-surface-2/50 p-4 text-xs text-muted-foreground">{note}</p>
      ) : counterfactuals.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface-2/50 p-4 text-xs text-muted-foreground">
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
                  "rounded-2xl border bg-surface p-4 transition-all",
                  isApplied ? "border-emerald-500/30 bg-emerald-500/[0.02]" : "border-border hover:border-border-strong"
                )}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-primary">
                        <FlaskConical className="h-2.5 w-2.5" />
                        Simulation
                      </span>
                      {c.tier_changed && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-600">
                          <TrendingUp className="h-2.5 w-2.5" />
                          Tier becomes {c.new_predicted_class}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-foreground">{c.change}</p>
                    <p className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                      Raw High score {c.from_prob_high}/100
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-bold text-foreground">{c.to_prob_high}/100</span>
                      <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-xs font-bold text-emerald-600">
                        +{c.delta_high} points
                      </span>
                    </p>
                  </div>
                  {canApply ? (
                    <button
                      type="button"
                      onClick={() => onToggle(c.parameter)}
                      aria-pressed={isApplied}
                      title="Stage this change for Apply to Draft"
                      className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none",
                        isApplied ? "bg-emerald-500" : "bg-surface-3"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                          isApplied ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                  ) : (
                    <span className="shrink-0 rounded-full border border-border px-2 py-1 text-xs font-bold uppercase tracking-wide text-muted-foreground/70">
                      Manual edit
                    </span>
                  )}
                </div>
              </article>
            );
          })}

          {flat.length > 0 && (
            <p className="rounded-xl border border-border/60 bg-surface-2/30 px-4 py-3 text-xs text-muted-foreground">
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
