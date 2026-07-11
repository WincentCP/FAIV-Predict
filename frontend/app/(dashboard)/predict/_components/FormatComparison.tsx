"use client";

import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ContentFormat } from "@/lib/types";
import { Panel } from "./Panel";
import { type Counterfactual } from "./MeasuredImprovements";

export function FormatComparison({
  formatProbes,
  currentFormat,
}: {
  formatProbes: Counterfactual[];
  currentFormat: ContentFormat;
}) {
  if (formatProbes.length === 0) return null;

  const cells = [
    {
      format: currentFormat,
      probability: formatProbes[0].from_prob_high,
      current: true,
    },
    ...formatProbes.map((probe) => ({
      format: String(probe.to_value),
      probability: probe.to_prob_high,
      current: false,
    })),
  ];

  return (
    <Panel
      title="Format Comparison"
      subtitle="Format is fixed by the content calendar. Use this planning intelligence when building the next one, not as a last-minute post change."
    >
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-border/60 bg-surface-2/40 p-3 text-xs text-muted-foreground">
        <CalendarRange className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>Display-only comparison. Changing format can affect production scope, approvals, and budget.</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {cells.map((cell) => {
          const probability = Math.max(0, Math.min(100, cell.probability));
          return (
            <div
              key={cell.format}
              className={cn(
                "rounded-2xl border bg-surface p-4",
                cell.current ? "border-primary ring-2 ring-primary/15" : "border-border"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-foreground">{cell.format}</span>
                {cell.current && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-primary">
                    Current
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-end justify-between font-mono tabular-nums">
                <span className="text-xs text-muted-foreground">P(High)</span>
                <span className="text-lg font-black text-foreground">{probability}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className={cn("h-full rounded-full", cell.current ? "bg-primary" : "bg-muted-foreground/50")}
                  style={{ width: `${probability}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

