import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WhyReason {
  label: string;
  detail: string;
  weight: number; // 0..1
  direction: "positive" | "negative" | "neutral";
}

export interface WhyThisScoreProps {
  reasons: WhyReason[];
  /** Short context line, e.g. "Based on niche-level data + 124 personal samples." */
  context?: string;
}

export function WhyThisScore({ reasons, context }: WhyThisScoreProps) {
  const sorted = [...reasons].sort((a, b) => b.weight - a.weight).slice(0, 3);
  const max = Math.max(...reasons.map((r) => r.weight), 0.001);

  return (
    <section
      aria-labelledby="why-score-heading"
      className="rounded-xl border border-border bg-surface p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
            Why this score
          </div>
          <h3
            id="why-score-heading"
            className="font-display mt-2 text-sm font-bold tracking-tight"
          >
            Top Contributing Signals
          </h3>
          {context && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {context}
            </p>
          )}
        </div>
      </div>

      <ul className="mt-5 space-y-3">
        {sorted.map((r, i) => {
          const positive = r.direction === "positive";
          const neutral = r.direction === "neutral";
          const pct = Math.round((r.weight / max) * 100);
          return (
            <li key={r.label} className="grid grid-cols-[24px_1fr_auto] items-start gap-3">
              <span
                className={`mt-0.5 grid h-6 w-6 place-items-center rounded-md text-xs font-mono font-semibold ${
                  neutral
                    ? "bg-surface-3 text-muted-foreground"
                    : positive
                    ? "bg-[color-mix(in_oklab,hsl(var(--accent-lime))_18%,transparent)] text-[oklch(0.40_0.18_130)] dark:text-[oklch(0.85_0.20_130)]"
                    : "bg-[color-mix(in_oklab,hsl(var(--destructive))_15%,transparent)] text-destructive"
                }`}
              >
                {i + 1}
              </span>
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  {neutral ? (
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/60" />
                  ) : positive ? (
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                  )}
                  {r.label}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{r.detail}</p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-700",
                      neutral ? "bg-muted-foreground/40" : positive ? "bg-accent-lime" : "bg-destructive"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div
                className={cn(
                  "pt-0.5 font-mono text-[11px] font-semibold tabular-nums",
                  neutral ? "text-muted-foreground" : positive ? "text-success" : "text-destructive"
                )}
              >
                {neutral ? "" : positive ? "+" : "−"}
                {(r.weight * 100).toFixed(0)}%
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
