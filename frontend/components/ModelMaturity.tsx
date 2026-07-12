"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Brain, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type MaturityState = "low" | "learning" | "personal";

export interface ModelMaturityProps {
  /** Number of posts currently attributed to this account. */
  samples: number;
  /** Threshold at which an account model can become available. Default 200. */
  target?: number;
  /** Cutoff for the early-history state. Default 50. */
  lowThreshold?: number;
  /** Artifact scope actually available to serve predictions for this brand. */
  activeScope?: "personal" | "cohort" | "none";
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
  tone: string;
  ring: string;
  bg: string;
  dot: string;
  description: string;
}> = {
  low: {
    label: "Limited account history",
    short: "Cold start",
    Icon: AlertCircle,
    tone: "text-[oklch(0.55_0.18_45)] dark:text-[oklch(0.82_0.16_75)]",
    ring: "ring-[color-mix(in_oklab,hsl(var(--warning))_40%,transparent)]",
    bg: "bg-[color-mix(in_oklab,hsl(var(--warning))_12%,transparent)]",
    dot: "bg-warning",
    description: "Predictions use the available niche model while this account builds enough eligible history for a separate personal model.",
  },
  learning: {
    label: "Building personal history",
    short: "Building history",
    Icon: Brain,
    tone: "text-primary",
    ring: "ring-[color-mix(in_oklab,hsl(var(--primary))_35%,transparent)]",
    bg: "bg-[color-mix(in_oklab,hsl(var(--primary))_10%,transparent)]",
    dot: "bg-primary",
    description: "Predictions continue using the available niche model until a separately trained personal model becomes active. The models are selected, not blended.",
  },
  personal: {
    label: "Personal Model Active",
    short: "Personalized",
    Icon: CheckCircle2,
    tone: "text-[oklch(0.40_0.18_130)] dark:text-[oklch(0.85_0.20_130)]",
    ring: "ring-[color-mix(in_oklab,hsl(var(--accent-lime))_45%,transparent)]",
    bg: "bg-[color-mix(in_oklab,hsl(var(--accent-lime))_18%,transparent)]",
    dot: "bg-accent-lime",
    description: "Predictions use a separately trained model based on this account's eligible post history.",
  },
};

export function ModelMaturity({
  samples,
  target = 200,
  lowThreshold = 50,
  activeScope,
  variant = "full",
  className,
}: ModelMaturityProps) {
  const sampleState = getMaturityState(samples, target, lowThreshold);
  // When the caller knows the active artifact, it is authoritative. Reaching a
  // count threshold does not prove that personal training/evaluation passed.
  const state = activeScope === undefined
    ? sampleState
    : activeScope === "personal"
      ? "personal"
      : sampleState === "low"
        ? "low"
        : "learning";
  const m = META[state];
  const pct = Math.min(100, Math.round((samples / target) * 100));
  const description = activeScope === "none"
    ? "No trained model is currently available for this brand. Sync eligible posts and complete retraining before prediction."
    : m.description;
  const shortLabel = activeScope === "none" ? "No active model" : m.short;

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
        title={`${samples}/${target} stored posts · ${m.label}. Eligibility also requires verified mature posts and a successful model evaluation. This is not a confidence score.`}
      >
        <m.Icon className="h-3 w-3" />
        {shortLabel} · <span className="font-mono tabular-nums">{samples}/{target}</span>
      </span>
    );
  }

  return (
    <div className={cn("rounded-xl border border-border bg-surface p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("grid h-8 w-8 place-items-center rounded-lg ring-1 ring-inset", m.bg, m.ring, m.tone)}>
            <m.Icon className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold">
              {m.label}
              <span className="inline-flex h-1.5 w-1.5 items-center justify-center" aria-hidden>
                <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{samples}</span>
              <span>/{target} posts</span>
              <span className="mx-1.5 text-muted-foreground/50">·</span>
              <span className="font-mono tabular-nums">{pct}%</span>
            </div>
          </div>
        </div>
        <Info
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
          aria-label="This indicates data maturity, not prediction confidence"
        />
      </div>

      <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        {Array.from({ length: 20 }).map((_, i) => {
          const fill = pct / 5;
          const filled = i < Math.floor(fill);
          const partial = i === Math.floor(fill) ? fill - Math.floor(fill) : 0;
          const colorClass = state === "personal" ? "bg-accent-lime" : state === "learning" ? "bg-primary" : "bg-warning";

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

      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      <p className="mt-1 text-xs text-muted-foreground/80">
        Stored-post count is only a maturity indicator; model eligibility also requires verified mature posts and successful evaluation.
      </p>
    </div>
  );
}
