"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hash, AtSign, Smile, MessageCircleQuestion, Target, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export const CAPTION_MAX = 2200;
export const CAPTION_WARN = 1900;

export interface CaptionStats {
  charCount: number;
  wordCount: number;
  hashtags: string[];
  mentions: string[];
  hasCTA: boolean;
  hasQuestion: boolean;
  emojiCount: number;
  hookWords: string;
  /** Detected CTA verbs (lowercased, deduped). */
  ctaTerms: string[];
}

export function analyzeCaption(text: string): CaptionStats {
  const t = text ?? "";
  const words = t.trim().split(/\s+/).filter(Boolean);
  const hashtags = t.match(/#[\w]+/g) || [];
  const mentions = t.match(/@[\w.]+/g) || [];
  // This detector is intentionally identical to the CTA vocabulary used by
  // the deployed ML feature extractor. A broader UI-only vocabulary would
  // claim a CTA is present while the trained model still receives has_cta=0.
  const ctaRegex = /\b(beli|dapatkan|pesan|kunjungi|klik|daftar|hubungi|contact|order|yuk|promo|diskon|check|checkout|tonton|baca|share|follow)\b/gi;
  const ctaMatches = [...t.matchAll(ctaRegex)].map((m) => m[0].toLowerCase());
  const ctaTerms = Array.from(new Set(ctaMatches));
  const hasCTA = ctaTerms.length > 0;
  const hasQuestion = /\?/.test(t);
  const emojiCount = (t.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) || []).length;
  const hookWords = words.slice(0, 8).join(" ");
  return {
    charCount: t.length,
    wordCount: words.length,
    hashtags,
    mentions,
    hasCTA,
    hasQuestion,
    emojiCount,
    hookWords,
    ctaTerms,
  };
}

export type CountTone = "normal" | "warning" | "danger";

export function getCountTone(count: number): CountTone {
  if (count > CAPTION_MAX) return "danger";
  if (count >= CAPTION_WARN) return "warning";
  return "normal";
}

/** Live progress bar + counter for caption length, color shifts normal → warning → danger. */
export function CaptionMeter({ count, className }: { count: number; className?: string }) {
  const tone = getCountTone(count);
  const pct = Math.min(100, (count / CAPTION_MAX) * 100);
  const color =
    tone === "danger"
      ? "hsl(var(--destructive))"
      : tone === "warning"
      ? "hsl(var(--warning))"
      : "hsl(var(--primary))";
  const textTone =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
      ? "text-warning-foreground dark:text-[oklch(0.85_0.16_75)]"
      : "text-muted-foreground";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative h-1 w-24 overflow-hidden rounded-full bg-surface-3">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          initial={false}
          animate={{ width: `${pct}%`, backgroundColor: color }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className={cn("font-mono text-xs font-medium tabular-nums", textTone)}>
        {count}/{CAPTION_MAX}
      </span>
    </div>
  );
}

/** Live row of counters: hashtags, mentions, emoji, CTA detection, question. */
export function CaptionSignals({
  stats,
  className,
}: {
  stats: CaptionStats;
  className?: string;
}) {
  const items = [
    {
      key: "hashtags",
      icon: Hash,
      value: stats.hashtags.length,
      label: "hashtags",
      tone:
        stats.hashtags.length === 0
          ? "muted"
          : stats.hashtags.length > 10
          ? "warning"
          : stats.hashtags.length >= 3
          ? "good"
          : "info",
    },
    {
      key: "mentions",
      icon: AtSign,
      value: stats.mentions.length,
      label: "mentions",
      tone: "muted",
    },
    {
      key: "emoji",
      icon: Smile,
      value: stats.emojiCount,
      label: "emoji",
      tone: stats.emojiCount === 0 ? "muted" : stats.emojiCount > 6 ? "warning" : "info",
    },
    {
      key: "cta",
      icon: Target,
      value: stats.hasCTA ? "✓" : "—",
      label: stats.hasCTA ? `CTA · ${stats.ctaTerms[0]}` : "no CTA",
      tone: stats.hasCTA ? "good" : "warning",
    },
    {
      key: "question",
      icon: MessageCircleQuestion,
      value: stats.hasQuestion ? "✓" : "—",
      label: stats.hasQuestion ? "question" : "no question",
      tone: stats.hasQuestion ? "good" : "muted",
    },
  ] as const;

  const toneClass = (t: string) =>
    t === "good"
      ? "text-[oklch(0.40_0.18_130)] dark:text-[oklch(0.85_0.20_130)] bg-[color-mix(in_oklab,hsl(var(--accent-lime))_14%,transparent)]"
      : t === "warning"
      ? "text-[oklch(0.50_0.16_75)] dark:text-[oklch(0.85_0.16_75)] bg-[color-mix(in_oklab,hsl(var(--warning))_14%,transparent)]"
      : t === "info"
      ? "text-primary bg-[color-mix(in_oklab,hsl(var(--primary))_10%,transparent)]"
      : "text-muted-foreground bg-surface-2";

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <motion.span
            key={it.key}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              toneClass(it.tone),
            )}
          >
            <it.icon className="h-3 w-3" />
            <span className="font-mono tabular-nums">{it.value}</span>
            <span className="text-muted-foreground/80">{it.label}</span>
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Banner shown when the caption exceeds the IG hard limit. */
export function CaptionLimitWarning({ count }: { count: number }) {
  if (count <= CAPTION_MAX) return null;
  const over = count - CAPTION_MAX;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      role="alert"
      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[color-mix(in_oklab,hsl(var(--destructive))_12%,transparent)] px-3 py-2 text-xs font-medium text-destructive ring-1 ring-inset ring-[color-mix(in_oklab,hsl(var(--destructive))_30%,transparent)]"
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      Over Instagram&apos;s 2,200 character limit by{" "}
      <span className="font-mono tabular-nums">{over}</span>
    </motion.div>
  );
}
