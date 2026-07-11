"use client";

import { MotionConfig } from "framer-motion";

/**
 * Makes every framer-motion animation respect the OS-level
 * prefers-reduced-motion setting (transform animations are skipped,
 * opacity crossfades remain). The CSS counterpart in globals.css covers
 * keyframe/transition animations; this covers the JS-driven ones.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

