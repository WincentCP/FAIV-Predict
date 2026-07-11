"use client";

import * as React from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";

interface ConfidenceMeterProps {
  value: number; // 0-100
  size?: number;
  label?: string;
  tier?: "High" | "Average" | "Low" | string;
}

export function ConfidenceMeter({
  value,
  size = 230,
  label = "AI Confidence",
  tier,
}: ConfidenceMeterProps) {
  const stroke = 12;
  const radius = (size - stroke - 30) / 2; // Extra padding for outer decorative rings
  const circumference = 2 * Math.PI * radius;
  const clampedValue = Math.min(100, Math.max(0, value));
  const motionVal = useMotionValue(0);
  const dash = useTransform(motionVal, (v) => circumference - (v / 100) * circumference);
  const prefersReducedMotion = useReducedMotion();
  const gradientId = `confidence-${React.useId().replace(/:/g, "")}`;

  React.useEffect(() => {
    const controls = animate(motionVal, clampedValue, {
      duration: prefersReducedMotion ? 0 : 0.32,
      ease: [0.2, 0, 0, 1],
    });
    return controls.stop;
  }, [clampedValue, motionVal, prefersReducedMotion]);

  // Clean the tier string to match cases
  const parsedTier = React.useMemo(() => {
    if (!tier) return "Default";
    const str = tier.toLowerCase();
    if (str.includes("high")) return "High";
    if (str.includes("average")) return "Average";
    if (str.includes("low")) return "Low";
    return "Default";
  }, [tier]);

  // Dynamic colors and glows based on Tier
  const theme = React.useMemo(() => {
    switch (parsedTier) {
      case "High":
        return {
          colorStart: "#10B981", // Emerald 500
          colorEnd: "#84CC16", // Lime 500
          labelColor: "text-emerald-500 dark:text-emerald-400",
          innerBg: "rgba(16, 185, 129, 0.03)"
        };
      case "Average":
        return {
          colorStart: "#F59E0B", // Amber 500
          colorEnd: "#F97316", // Orange 500
          labelColor: "text-amber-500 dark:text-amber-400",
          innerBg: "rgba(245, 158, 11, 0.03)"
        };
      case "Low":
        return {
          colorStart: "#EF4444", // Red 500
          colorEnd: "#F43F5E", // Rose 500
          labelColor: "text-red-500 dark:text-red-400",
          innerBg: "rgba(239, 68, 68, 0.03)"
        };
      default:
        return {
          colorStart: "hsl(var(--primary))",
          colorEnd: "hsl(var(--primary-glow, 270 91% 65%))",
          labelColor: "text-primary",
          innerBg: "rgba(168, 85, 247, 0.03)"
        };
    }
  }, [parsedTier]);

  return (
    <div
      className="relative grid place-items-center select-none"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clampedValue)}
      aria-valuetext={`${Math.round(clampedValue)} percent${tier ? `, ${parsedTier} potential` : ""}`}
    >

      {/* SVG Dial System */}
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme.colorStart} />
            <stop offset="100%" stopColor={theme.colorEnd} />
          </linearGradient>
        </defs>

        {/* 1. Outer Tech Dotted Ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius + 12}
          fill="none"
          stroke="currentColor"
          className="text-border/30"
          strokeWidth="1"
          strokeDasharray="2 6"
        />

        {/* 2. Outer Thin Guide Circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius + 6}
          fill="none"
          stroke="currentColor"
          className="text-border/10"
          strokeWidth="1"
        />

        {/* 3. Base Track Track Circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted-foreground/10"
          strokeWidth={stroke}
        />

        {/* 4. Interactive Core Score Progress Fill */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ 
            strokeDashoffset: dash,
          }}
          className="transition-all duration-300"
        />

        {/* 5. Inner Concentric Tick Ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius - stroke}
          fill="none"
          stroke="currentColor"
          className="text-border/20"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      </svg>

      {/* Internal Center UI Text Box */}
      <div 
        className="absolute rounded-full border border-border/40 backdrop-blur-xl flex items-center justify-center text-center shadow-inner"
        style={{ 
          width: (radius - stroke) * 2 - 4, 
          height: (radius - stroke) * 2 - 4,
          background: theme.innerBg
        }}
      >
        <div className="space-y-1">
          {/* Animated score number */}
          <div className="font-display text-[42px] font-black leading-none tracking-tight text-foreground flex items-baseline justify-center">
            <span className="tabular-nums">{Math.round(clampedValue)}</span>
            <span className="text-lg font-bold text-muted-foreground ml-0.5">%</span>
          </div>
          
          {/* Metric label */}
          <div className="text-xs uppercase tracking-[0.16em] font-extrabold text-muted-foreground/90">
            {label}
          </div>

          {/* Dynamic Small Badge Indicator inside the core */}
          {tier && (
            <div className={`text-xs uppercase font-black tracking-widest leading-none mt-1.5 ${theme.labelColor}`}>
              {parsedTier} POTENTIAL
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
