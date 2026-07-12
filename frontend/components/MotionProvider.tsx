"use client";

import { MotionConfig } from "framer-motion";

/** Applies the user's reduced-motion preference to JS-driven animations. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

