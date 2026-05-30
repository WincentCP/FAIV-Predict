"use client";

import * as React from "react";
import { HEATMAP_DATA, HEATMAP_DAYS } from "@/lib/mock-data";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function PostingHeatmap() {
  const [hover, setHover] = React.useState<{ d: number; h: number; v: number } | null>(null);

  // Best slot
  let best = { d: 0, h: 0, v: 0 };
  HEATMAP_DATA.forEach((row, d) =>
    row.forEach((v, h) => {
      if (v > best.v) best = { d, h, v };
    })
  );

  const cellColor = (v: number) => {
    // Blend lime → purple as intensity grows
    if (v < 0.05) return "color-mix(in oklab, var(--surface-3) 100%, transparent)";
    if (v < 0.25)
      return `color-mix(in oklab, var(--accent-lime) ${v * 90}%, var(--surface-2))`;
    if (v < 0.55)
      return `color-mix(in oklab, var(--accent-lime) ${v * 75}%, var(--primary-glow))`;
    return `color-mix(in oklab, var(--primary) ${v * 90}%, var(--accent-lime))`;
  };

  return (
    <div className="relative">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Posting performance
          </div>
          <h3 className="mt-1 font-display text-xl font-semibold tracking-tight">
            When your audience shows up
          </h3>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-muted-foreground sm:flex">
          <span className="font-medium text-foreground">Best slot</span>
          <span className="font-mono">
            {HEATMAP_DAYS[best.d]} · {String(best.h).padStart(2, "0")}:00
          </span>
          <span
            className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
            style={{ background: "var(--gradient-primary)" }}
          >
            {Math.round(best.v * 100)}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* Hour ticks */}
          <div className="ml-10 grid grid-cols-24 gap-[3px] pb-1.5" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
            {HOURS.map((h) => (
              <div
                key={h}
                className={`text-center font-mono text-[9px] text-muted-foreground/60 ${
                  h % 3 === 0 ? "" : "opacity-0"
                }`}
              >
                {String(h).padStart(2, "0")}
              </div>
            ))}
          </div>

          {HEATMAP_DATA.map((row, d) => (
            <div key={d} className="mb-[3px] flex items-center gap-2">
              <div className="w-8 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {HEATMAP_DAYS[d]}
              </div>
              <div
                className="grid flex-1 gap-[3px]"
                style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
              >
                {row.map((v, h) => {
                  const isBest = d === best.d && h === best.h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onMouseEnter={() => setHover({ d, h, v })}
                      onMouseLeave={() => setHover(null)}
                      className="relative aspect-square rounded-[4px] border border-border/40 transition-all duration-150 hover:scale-[1.25] hover:z-10"
                      style={{
                        background: cellColor(v),
                        boxShadow: isBest
                          ? "0 0 0 1.5px var(--primary), 0 0 12px color-mix(in oklab, var(--primary) 50%, transparent)"
                          : undefined,
                      }}
                      aria-label={`${HEATMAP_DAYS[d]} ${h}:00 score ${Math.round(v * 100)}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend + hover */}
      <div className="mt-5 flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Less</span>
          <div className="flex gap-[3px]">
            {[0.05, 0.2, 0.4, 0.6, 0.85].map((v) => (
              <span
                key={v}
                className="h-3 w-3 rounded-[3px] border border-border/40"
                style={{ background: cellColor(v) }}
              />
            ))}
          </div>
          <span>More</span>
        </div>
        <div className="font-mono text-foreground">
          {hover ? (
            <>
              {HEATMAP_DAYS[hover.d]} · {String(hover.h).padStart(2, "0")}:00 ·{" "}
              <span className="text-primary">{Math.round(hover.v * 100)}</span>
            </>
          ) : (
            <span className="text-muted-foreground/60">Hover a cell</span>
          )}
        </div>
      </div>
    </div>
  );
}
