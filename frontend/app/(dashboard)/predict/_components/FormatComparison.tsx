"use client";

import { LayoutGrid } from "lucide-react";
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
      highClassScore: formatProbes[0].from_prob_high,
      current: true,
    },
    ...formatProbes.map((probe) => ({
      format: String(probe.to_value),
      highClassScore: probe.to_prob_high,
      current: false,
    })),
  ];

  return (
    <Panel
      title="Compare formats"
      subtitle="A one-feature model sensitivity check. These raw class scores are not calibrated probabilities or guaranteed performance changes."
    >
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-border/60 bg-surface-2/40 p-3 text-xs text-muted-foreground">
        <LayoutGrid className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>Display-only comparison. Changing format can affect production scope, approvals, and budget.</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {cells.map((cell) => {
          const highClassScore = Math.max(0, Math.min(100, cell.highClassScore));
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
                <span className="text-xs text-muted-foreground">Raw High score</span>
                <span className="text-lg font-black text-foreground">{highClassScore}/100</span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
                role="img"
                aria-label={`${cell.format}: raw High class score ${highClassScore} out of 100; not a calibrated probability`}
              >
                <div
                  className={cn("h-full rounded-full", cell.current ? "bg-primary" : "bg-muted-foreground/50")}
                  style={{ width: `${highClassScore}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
