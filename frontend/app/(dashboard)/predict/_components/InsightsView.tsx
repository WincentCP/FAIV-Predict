"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useState } from "react";
import { format as formatDate } from "date-fns";
import {
  FileText, Calendar, Clock, Check, AlertTriangle, HelpCircle, Activity, ChevronDown,
} from "lucide-react";
import { TierBadge } from "@/components/TierBadge";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { WhyThisScore, type WhyReason } from "@/components/WhyThisScore";
import { type Tier, type ContentFormat } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Panel } from "./Panel";
import { TrustStrip } from "./TrustStrip";
import { MeasuredImprovements, type Counterfactual } from "./MeasuredImprovements";
import { FormatComparison } from "./FormatComparison";

const FeatureAttributionChart = dynamic(() => import("@/components/FeatureAttributionChart"), {
  ssr: false,
  loading: () => <div className="h-56 w-full motion-safe:animate-pulse bg-muted/40 rounded-xl" />,
});

export interface InsightsPrediction {
  tier: Tier;
  confidence: number;
  probs: Array<{ tier: Tier; prob: number }>;
  isPersonalModel: boolean;
  modelAccuracy: number | null;
  modelVersion: string | null;
  trainedSamples: number | null;
  savedId: string | null;
  outOfRange: string[];
  counterfactuals: Counterfactual[];
  counterfactualsNote: string | null;
}

export function InsightsView(props: {
  prediction: InsightsPrediction;
  isPredictionStale: boolean;
  brandName?: string;
  scheduledAt: Date;
  contentFormat: ContentFormat;
  whyReasons: WhyReason[];
  mdiChartData: { name: string; importance: number; rawPct: number }[];
  appliedRecs: Record<string, boolean>;
  onToggleRec: (parameter: string) => void;
  anyRecsApplied: boolean;
  onApply: () => void;
  onEditDraft: () => void;
}) {
  const {
    prediction, isPredictionStale, brandName, scheduledAt, contentFormat,
    whyReasons, mdiChartData, appliedRecs, onToggleRec, anyRecsApplied, onApply, onEditDraft,
  } = props;

  const [showModelThinking, setShowModelThinking] = useState(false);
  const formatProbes = prediction.counterfactuals.filter((probe) => probe.parameter === "format");
  const improvementProbes = prediction.counterfactuals.filter((probe) => probe.parameter !== "format");

  const tierColorClass =
    prediction.tier === "High"
      ? "text-emerald-500 dark:text-emerald-400"
      : prediction.tier === "Average"
      ? "text-amber-500 dark:text-amber-400"
      : "text-rose-500 dark:text-rose-400";

  return (
    <motion.div
      key="view-insights"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ type: "spring", stiffness: 350, damping: 28 }}
      className="space-y-6"
    >
      {isPredictionStale && (
        <div className="rounded-2xl border border-warning/30 bg-warning/[0.03] p-4 flex items-center gap-3 shadow-sm">
          <AlertTriangle className="h-4.5 w-4.5 text-warning shrink-0" />
          <div className="text-xs font-semibold text-warning">
            Inputs changed since this prediction — re-analyze to refresh.
          </div>
        </div>
      )}

      {/* Verdict header */}
      <div className="grid gap-6 rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur shadow-[var(--shadow-soft)] md:grid-cols-12">
        <div className="flex items-center justify-center md:col-span-4">
          <ConfidenceMeter value={prediction.confidence} tier={prediction.tier} size={160} label="Model Confidence" />
        </div>
        <div className="flex flex-col justify-center space-y-3 md:col-span-8">
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={prediction.tier} />
            {prediction.savedId && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-600 uppercase tracking-wide">
                <Check className="h-2.5 w-2.5" />
                Saved to History
              </span>
            )}
          </div>
          <h4 className="text-2xl font-black font-display leading-tight text-foreground">
            Predicted tier: <span className={tierColorClass}>{prediction.tier.toUpperCase()}</span>
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-[62ch]">
            This draft is predicted to earn <strong className="text-foreground">
            {prediction.tier.toLowerCase()}-tier engagement</strong> (likes + comments relative to this
            brand&apos;s own history — not reach or sales), with {prediction.confidence}% model confidence.
          </p>

          {/* Inline probability bars */}
          <div className="grid gap-2 sm:grid-cols-3">
            {prediction.probs.map((c) => {
              const pct = Math.round(c.prob * 100);
              const active = c.tier === prediction.tier;
              const colorClass =
                c.tier === "High" ? "bg-emerald-500" : c.tier === "Average" ? "bg-amber-500" : "bg-rose-500";
              return (
                <div key={c.tier} className={cn("space-y-1", !active && "opacity-60")}>
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="font-bold text-foreground">{c.tier}</span>
                    <span className="font-extrabold text-foreground tabular-nums">{pct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3 border border-border/30">
                    <div className={cn("h-full rounded-full transition-all duration-700", colorClass)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input summary */}
          <div className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-semibold"><FileText className="h-3 w-3" />{brandName || "—"}</span>
            <span className="inline-flex items-center gap-1.5"><Calendar className="h-3 w-3" />{formatDate(scheduledAt, "MMM d, yyyy")}</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3 w-3" />{formatDate(scheduledAt, "HH:mm")}</span>
            <span className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-xs font-bold">{contentFormat}</span>
          </div>
        </div>
      </div>

      <TrustStrip
        isPersonalModel={prediction.isPersonalModel}
        trainedSamples={prediction.trainedSamples}
        modelAccuracy={prediction.modelAccuracy}
        modelVersion={prediction.modelVersion}
        outOfRange={prediction.outOfRange}
      />

      <MeasuredImprovements
        counterfactuals={improvementProbes}
        note={prediction.counterfactualsNote}
        appliedRecs={appliedRecs}
        onToggle={onToggleRec}
      />

      <FormatComparison formatProbes={formatProbes} currentFormat={contentFormat} />

      <section className="overflow-hidden rounded-2xl border border-border bg-surface/50">
        <button
          type="button"
          aria-expanded={showModelThinking}
          onClick={() => setShowModelThinking((open) => !open)}
          className="flex w-full items-center justify-between gap-4 p-5 text-left hover:bg-surface-2/40"
        >
          <div>
            <h3 className="font-display text-sm font-bold text-foreground">How the model thinks</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Inspect the observed inputs and the model&apos;s global feature importance. Direction is shown only where measured.
            </p>
          </div>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", showModelThinking && "rotate-180")}
          />
        </button>

        {showModelThinking && (
          <div className="grid gap-6 border-t border-border p-5 md:grid-cols-2">
            <WhyThisScore
              reasons={whyReasons}
              context="Observed input values, weighted by the model's global feature importance. Importance is magnitude, not positive/negative direction."
            />
            <Panel
              title="Model Feature Importance"
              subtitle="How much each input drives this model's decisions overall (Mean Decrease in Impurity)."
            >
              <div className="h-56 w-full mt-2">
                {mdiChartData.length === 0 ? (
                  <div className="h-full w-full flex flex-col items-center justify-center border border-dashed border-border rounded-xl bg-surface-2/40 p-5 text-center">
                    <Activity className="h-7 w-7 text-muted-foreground/50 mb-2" />
                    <p className="text-xs font-semibold text-foreground">No model weights loaded</p>
                  </div>
                ) : (
                  <FeatureAttributionChart data={mdiChartData} />
                )}
              </div>
              <div className="mt-4 text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5 p-3 rounded-lg bg-surface-2 border border-border/40">
                <HelpCircle className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
                <span>
                  Importance shows global influence magnitude. For measured effects on this draft, see
                  Measured Improvements above.
                </span>
              </div>
            </Panel>
          </div>
        )}
      </section>

      {/* Sticky action bar */}
      <div className="sticky bottom-4 z-10 flex gap-3 rounded-2xl border border-border bg-surface/90 p-4 shadow-[var(--shadow-elevated)] backdrop-blur-xl">
        <button
          type="button"
          onClick={onEditDraft}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-xs font-semibold transition-all hover:bg-surface-2 active:scale-[0.98]"
        >
          Edit Draft
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={!anyRecsApplied}
          title={!anyRecsApplied ? "Toggle at least one change above to stage it" : undefined}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-primary-foreground transition-colors duration-200 hover:bg-primary/92 disabled:opacity-50"
        >
          Apply Changes &amp; Re-Analyze
        </button>
      </div>
    </motion.div>
  );
}
