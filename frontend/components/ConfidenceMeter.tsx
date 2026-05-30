"use client";

import * as React from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

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
  const motionVal = useMotionValue(0);
  const dash = useTransform(motionVal, (v) => circumference - (v / 100) * circumference);
  const [displayed, setDisplayed] = React.useState(0);

  React.useEffect(() => {
    const controls = animate(motionVal, value, {
      duration: 1.6,
      ease: [0.25, 1, 0.5, 1],
      onUpdate: (v) => setDisplayed(Math.round(v)),
    });
    return controls.stop;
  }, [value, motionVal]);

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
          gradientId: "high-conf-grad",
          colorStart: "#10B981", // Emerald 500
          colorEnd: "#84CC16", // Lime 500
          glow: "rgba(16, 185, 129, 0.4)",
          glowStrong: "rgba(16, 185, 129, 0.8)",
          labelColor: "text-emerald-500 dark:text-emerald-400",
          innerBg: "rgba(16, 185, 129, 0.03)"
        };
      case "Average":
        return {
          gradientId: "average-conf-grad",
          colorStart: "#F59E0B", // Amber 500
          colorEnd: "#F97316", // Orange 500
          glow: "rgba(245, 158, 11, 0.35)",
          glowStrong: "rgba(245, 158, 11, 0.7)",
          labelColor: "text-amber-500 dark:text-amber-400",
          innerBg: "rgba(245, 158, 11, 0.03)"
        };
      case "Low":
        return {
          gradientId: "low-conf-grad",
          colorStart: "#EF4444", // Red 500
          colorEnd: "#F43F5E", // Rose 500
          glow: "rgba(239, 68, 68, 0.35)",
          glowStrong: "rgba(239, 68, 68, 0.7)",
          labelColor: "text-red-500 dark:text-red-400",
          innerBg: "rgba(239, 68, 68, 0.03)"
        };
      default:
        return {
          gradientId: "default-conf-grad",
          colorStart: "hsl(var(--primary))",
          colorEnd: "hsl(var(--primary-glow, 270 91% 65%))",
          glow: "rgba(168, 85, 247, 0.4)",
          glowStrong: "rgba(168, 85, 247, 0.7)",
          labelColor: "text-primary",
          innerBg: "rgba(168, 85, 247, 0.03)"
        };
    }
  }, [parsedTier]);

  return (
    <div className="relative grid place-items-center select-none" style={{ width: size, height: size }}>
      
      {/* Dynamic Glow Sphere in background */}
      <div 
        className="absolute rounded-full filter blur-2xl opacity-20 transition-all duration-1000"
        style={{ 
          width: size - 60, 
          height: size - 60, 
          background: `radial-gradient(circle, ${theme.colorStart} 0%, transparent 70%)`,
          boxShadow: `0 0 40px ${theme.glow}`
        }} 
      />

      {/* SVG Dial System */}
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        <defs>
          <linearGradient id={theme.gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme.colorStart} />
            <stop offset="100%" stopColor={theme.colorEnd} />
          </linearGradient>
          
          {/* Subtle drop shadow filter */}
          <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
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
          stroke={`url(#${theme.gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          filter="url(#neon-glow)"
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
            <span className="tabular-nums transition-all">{displayed}</span>
            <span className="text-lg font-bold text-muted-foreground ml-0.5">%</span>
          </div>
          
          {/* Metric label */}
          <div className="text-[9px] uppercase tracking-[0.2em] font-extrabold text-muted-foreground/90">
            {label}
          </div>

          {/* Dynamic Small Badge Indicator inside the core */}
          {tier && (
            <div className={`text-[8.5px] uppercase font-black tracking-widest leading-none mt-1.5 ${theme.labelColor}`}>
              {parsedTier} POTENTIAL
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
