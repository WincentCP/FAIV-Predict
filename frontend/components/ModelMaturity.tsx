"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Brain, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type MaturityState = "low" | "learning" | "personal";

export interface ModelMaturityProps {
  /** Number of training samples collected for this account/model. */
  samples: number;
  /** Threshold for "Personal Model Active". Default 200. */
  target?: number;
  /** Cutoff for "Low Confidence". Default 50. */
  lowThreshold?: number;
  variant?: "compact" | "full";
  className?: string;
}

export function getMaturityState(samples: number, target = 200, low = 50): MaturityState {
  if (samples >= target) return "personal";
  if (samples >= low) return "learning";
  return "low";
}

const META: Record<MaturityState, {
  label: string;
  short: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: string; // tailwind text color class
  ring: string;
  bg: string;
  dot: string;
  description: string;
}> = {
  low: {
    label: "Low confidence",
    short: "Cold start",
    Icon: AlertCircle,
    tone: "text-[oklch(0.55_0.18_45)] dark:text-[oklch(0.82_0.16_75)]",
    ring: "ring-[color-mix(in_oklab,hsl(var(--warning))_40%,transparent)]",
    bg: "bg-[color-mix(in_oklab,hsl(var(--warning))_12%,transparent)]",
    dot: "bg-warning",
    description: "Predictions use niche-level patterns until enough personal data is collected.",
  },
  learning: {
    label: "Learning",
    short: "Learning",
    Icon: Brain,
    tone: "text-primary",
    ring: "ring-[color-mix(in_oklab,hsl(var(--primary))_35%,transparent)]",
    bg: "bg-[color-mix(in_oklab,hsl(var(--primary))_10%,transparent)]",
    dot: "bg-primary",
    description: "Model is blending niche-level data with your account's emerging signal.",
  },
  personal: {
    label: "Personal Model Active",
    short: "Personalized",
    Icon: CheckCircle2,
    tone: "text-[oklch(0.40_0.18_130)] dark:text-[oklch(0.85_0.20_130)]",
    ring: "ring-[color-mix(in_oklab,hsl(var(--accent-lime))_45%,transparent)]",
    bg: "bg-[color-mix(in_oklab,hsl(var(--accent-lime))_18%,transparent)]",
    dot: "bg-accent-lime",
    description: "Predictions are tuned to this account's personal model.",
  },
};

export function ModelMaturity({
  samples,
  target = 200,
  lowThreshold = 50,
  variant = "full",
  className,
}: ModelMaturityProps) {
  const state = getMaturityState(samples, target, lowThreshold);
  const m = META[state];
  const pct = Math.min(100, Math.round((samples / target) * 100));

  if (variant === "compact") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
          m.bg,
          m.tone,
          m.ring,
          className,
        )}
        title={`${samples}/${target} samples · ${m.label}`}
      >
        <m.Icon className="h-3 w-3" />
        {m.short} · <span className="font-mono tabular-nums">{samples}/{target}</span>
      </span>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "grid h-8 w-8 place-items-center rounded-lg ring-1 ring-inset",
              m.bg,
              m.ring,
              m.tone,
            )}
          >
            <m.Icon className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold">
              {m.label}
              <span
                className="inline-flex h-1.5 w-1.5 items-center justify-center"
                aria-hidden
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{samples}</span>
              <span className="text-muted-foreground">/{target} samples</span>
              <span className="mx-1.5 text-muted-foreground/50">·</span>
              <span className="font-mono tabular-nums">{pct}%</span>
            </div>
          </div>
        </div>
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      </div>

      {/* segmented progress */}
      <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-surface-3">
        {Array.from({ length: 20 }).map((_, i) => {
          const fill = pct / 5; // 0..20
          const filled = i < Math.floor(fill);
          const partial = i === Math.floor(fill) ? (fill - Math.floor(fill)) : 0;
          
          let colorClass = "bg-warning";
          if (state === "personal") colorClass = "bg-accent-lime";
          else if (state === "learning") colorClass = "bg-primary";

          return (
            <div key={i} className="relative flex-1 overflow-hidden">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: filled ? 1 : partial }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: i * 0.012 }}
                style={{ transformOrigin: "left" }}
                className={cn("h-full w-full", colorClass)}
              />
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{m.description}</p>
    </div>
  );
}

