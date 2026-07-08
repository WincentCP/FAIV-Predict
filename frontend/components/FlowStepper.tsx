"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PenTool, Gauge, Activity, Lightbulb, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { to: "/predict", label: "Predict", icon: PenTool },
  { to: "/result", label: "Result", icon: Gauge },
  { to: "/diagnose", label: "Diagnose", icon: Activity },
  { to: "/suggest", label: "Optimize", icon: Lightbulb },
] as const;

export function FlowStepper({
  className,
  activeStep,
  onStepClick,
}: {
  className?: string;
  activeStep?: number;
  onStepClick?: (step: number) => void;
}) {
  const pathname = usePathname();
  const currentIdx = activeStep !== undefined 
    ? activeStep - 1 
    : Math.max(
        0,
        STEPS.findIndex((s) => pathname.startsWith(s.to)),
      );

  return (
    <nav
      aria-label="Prediction flow"
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-full border border-border bg-surface/75 p-1.5 shadow-[var(--shadow-soft)] backdrop-blur-xl",
        className,
      )}
    >
      {STEPS.map((step, i) => {
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;
        const Icon = isDone ? Check : step.icon;

        const content = (
          <>
            <span
              className={cn(
                "grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold shrink-0 transition-all",
                isActive
                  ? "bg-white text-primary font-extrabold shadow-sm"
                  : isDone
                  ? "bg-accent-lime text-foreground"
                  : "bg-surface-3 text-muted-foreground",
              )}
            >
              <Icon className="h-3 w-3 stroke-[3]" />
            </span>
            {step.label}
          </>
        );

        const styleClass = cn(
          "group inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95 border",
          isActive
            ? "bg-primary text-primary-foreground border-primary shadow-[var(--shadow-glow-purple)] hover:scale-[1.02]"
            : isDone
            ? "text-foreground bg-accent-lime/10 border-accent-lime/30 hover:bg-accent-lime/20 shadow-[0_0_12px_rgba(132,204,22,0.15)]"
            : "text-muted-foreground/80 hover:text-foreground hover:bg-surface-2 border-transparent",
        );

        return (
          <div key={step.to} className="flex items-center gap-1.5">
            {onStepClick ? (
              <button
                type="button"
                onClick={() => onStepClick(i + 1)}
                className={styleClass}
              >
                {content}
              </button>
            ) : activeStep !== undefined ? (
              <button
                type="button"
                onClick={() => {
                  const targetId = step.label.toLowerCase();
                  const el = document.getElementById(targetId);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                className={styleClass}
              >
                {content}
              </button>
            ) : (
              <Link href={step.to} className={styleClass}>
                {content}
              </Link>
            )}
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-1 w-6 rounded-full transition-colors duration-300",
                  i < currentIdx
                    ? "bg-gradient-to-r from-accent-lime to-primary/80"
                    : "bg-border/60",
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
