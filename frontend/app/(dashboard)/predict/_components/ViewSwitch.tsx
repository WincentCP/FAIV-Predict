"use client";

import { cn } from "@/lib/utils";

export type PredictView = "compose" | "insights";

/**
 * Two-segment switch replacing the old 4-step stepper: Compose (draft the
 * post) and Insights (everything the model has to say, on one screen).
 * Insights unlocks once a prediction exists.
 */
export function ViewSwitch({
  view,
  onChange,
  insightsEnabled,
}: {
  view: PredictView;
  onChange: (v: PredictView) => void;
  insightsEnabled: boolean;
}) {
  const segments: { id: PredictView; label: string; disabled?: boolean }[] = [
    { id: "compose", label: "Draft" },
    { id: "insights", label: "Result", disabled: !insightsEnabled },
  ];
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1" aria-label="Prediction workspace view">
      {segments.map((s) => {
        const active = view === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => !s.disabled && onChange(s.id)}
            disabled={s.disabled}
            aria-pressed={active}
            aria-describedby={s.disabled ? "prediction-result-disabled" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            )}
          >
            {s.label}
          </button>
        );
      })}
      {!insightsEnabled && (
        <span id="prediction-result-disabled" className="sr-only">
          Run a prediction before opening the prediction result.
        </span>
      )}
    </div>
  );
}
