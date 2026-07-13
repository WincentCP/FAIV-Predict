"use client";

import { motion, useReducedMotion } from "framer-motion";
import { type Tier } from "@/lib/types";
import { SCORE_DISCLAIMER } from "@/lib/vocab";
import { cn } from "@/lib/utils";

const TIER_STROKE: Record<Tier, string> = {
  High: "stroke-tier-high",
  Average: "stroke-tier-average",
  Low: "stroke-tier-low",
};

const TIER_TEXT: Record<Tier, string> = {
  High: "text-tier-high",
  Average: "text-tier-average",
  Low: "text-tier-low",
};

const SIZES = {
  sm: { box: 44, stroke: 4, text: "text-[11px]" },
  md: { box: 64, stroke: 5, text: "text-base" },
  lg: { box: 148, stroke: 10, text: "text-4xl" },
} as const;

/**
 * Circular relative-model-score indicator. The ring color always follows the
 * predicted tier so a high number on a Low prediction cannot read as success,
 * and the accessible label repeats that the value is not a probability.
 */
export function ScoreRing({
  value,
  tier,
  size = "md",
  className,
}: {
  /** Raw winning-class score, 0–100 (uncalibrated). */
  value: number;
  tier: Tier;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const { box, stroke, text } = SIZES[size];
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      role="img"
      aria-label={`${clamped} out of 100. ${SCORE_DISCLAIMER}`}
      title={SCORE_DISCLAIMER}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: box, height: box }}
    >
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} className="-rotate-90" aria-hidden="true">
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-3"
        />
        <motion.circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={reduceMotion ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.7, ease: [0.2, 0, 0, 1] }}
          className={TIER_STROKE[tier]}
        />
      </svg>
      <span
        aria-hidden="true"
        className={cn("absolute inset-0 grid place-items-center font-display font-bold tabular-nums", text, TIER_TEXT[tier])}
      >
        {clamped}
      </span>
    </div>
  );
}
