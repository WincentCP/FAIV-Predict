"use client";

import { PenTool, Gauge } from "lucide-react";
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
  const segments: { id: PredictView; label: string; icon: typeof PenTool; disabled?: boolean }[] = [
    { id: "compose", label: "Compose", icon: PenTool },
    { id: "insights", label: "Insights", icon: Gauge, disabled: !insightsEnabled },
  ];
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-surface/70 p-1 backdrop-blur">
      {segments.map((s) => {
        const active = view === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => !s.disabled && onChange(s.id)}
            disabled={s.disabled}
            aria-pressed={active}
            title={s.disabled ? "Run an analysis first — insights appear here" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all",
              active
                ? "bg-primary text-primary-foreground shadow-[var(--shadow-glow-purple)]"
                : "text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <s.icon className="h-3.5 w-3.5" />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
