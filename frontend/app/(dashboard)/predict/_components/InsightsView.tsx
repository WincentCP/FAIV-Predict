"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { format as formatDate } from "date-fns";
import {
  FileText, Calendar, Clock, Check, AlertTriangle, HelpCircle, Activity, RefreshCw, Ruler,
} from "lucide-react";
import { TierBadge } from "@/components/TierBadge";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { WhyThisScore, type WhyReason } from "@/components/WhyThisScore";
import { type Tier, type ContentFormat } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Panel } from "./Panel";
import { TrustStrip } from "./TrustStrip";
import { MeasuredImprovements, type Counterfactual } from "./MeasuredImprovements";

const FeatureAttributionChart = dynamic(() => import("@/components/FeatureAttributionChart"), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse bg-muted/40 rounded-xl" />,
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
  counterfactuals: Counterfactual[];
  counterfactualsNote: string | null;
}

export interface TreRecommendation {
  parameter: string;
  current: string | number;
  recommendation: string;
  impact: string;
}

export function InsightsView(props: {
  prediction: InsightsPrediction;
  isPredictionStale: boolean;
  brandName?: string;
  scheduledAt: Date;
  contentFormat: ContentFormat;
  whyReasons: WhyReason[];
  mdiChartData: { name: string; importance: number; rawPct: number }[];
  treRecs: TreRecommendation[] | null;
  treError: string | null;
  onRetryTre: () => void;
  featureLabels: Record<string, string>;
  autoApplicable: Set<string>;
  appliedRecs: Record<string, boolean>;
  onToggleRec: (parameter: string) => void;
  anyRecsApplied: boolean;
  onApply: () => void;
  onEditDraft: () => void;
}) {
  const {
    prediction, isPredictionStale, brandName, scheduledAt, contentFormat,
    whyReasons, mdiChartData, treRecs, treError, onRetryTre, featureLabels,
    autoApplicable, appliedRecs, onToggleRec, anyRecsApplied, onApply, onEditDraft,
  } = props;

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
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[9px] font-bold text-emerald-600 uppercase tracking-wide">
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
                  <div className="flex items-center justify-between font-mono text-[10px]">
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
          <div className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-semibold"><FileText className="h-3 w-3" />{brandName || "—"}</span>
            <span className="inline-flex items-center gap-1.5"><Calendar className="h-3 w-3" />{formatDate(scheduledAt, "MMM d, yyyy")}</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3 w-3" />{formatDate(scheduledAt, "HH:mm")}</span>
            <span className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[10px] font-bold">{contentFormat}</span>
          </div>
        </div>
      </div>

      <TrustStrip
        isPersonalModel={prediction.isPersonalModel}
        trainedSamples={prediction.trainedSamples}
        modelAccuracy={prediction.modelAccuracy}
        modelVersion={prediction.modelVersion}
      />

      <MeasuredImprovements
        counterfactuals={prediction.counterfactuals}
        note={prediction.counterfactualsNote}
        appliedRecs={appliedRecs}
        onToggle={onToggleRec}
      />

      {/* Evidence */}
      <div className="grid gap-6 md:grid-cols-2">
        <WhyThisScore
          reasons={whyReasons}
          context="Input signals vs niche baselines, weighted by the model's feature importance."
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
          <div className="mt-4 text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5 p-3 rounded-lg bg-surface-2 border border-border/40">
            <HelpCircle className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
            <span>
              Importance shows global influence magnitude — for measured effects on THIS draft, see
              Measured Improvements above.
            </span>
          </div>
        </Panel>
      </div>

      {/* Guideline recommendations (heuristic TRE) */}
      <Panel
        title="Guideline Recommendations"
        subtitle="Rule-based advice from this niche's baselines (not AI-generated, not measured on this draft). Use Measured Improvements above for evidence-backed changes."
      >
        {treError ? (
          <div className="rounded-xl border border-warning/30 bg-warning/[0.03] p-4 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="flex-1 text-xs text-muted-foreground">{treError}</p>
            <button
              type="button"
              onClick={onRetryTre}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 shrink-0"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        ) : treRecs === null ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
        ) : treRecs.length === 0 ? (
          <div className="rounded-xl border border-accent-lime/30 bg-accent-lime/[0.04] p-4 flex items-center gap-3">
            <Check className="h-4.5 w-4.5 text-accent-lime-strong shrink-0" />
            <p className="text-xs font-semibold text-foreground">
              All measurable parameters already sit within this niche&apos;s baselines.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {treRecs.map((rec) => {
              const canApply = autoApplicable.has(rec.parameter);
              const isApplied = appliedRecs[rec.parameter] || false;
              return (
                <article
                  key={rec.parameter}
                  className={cn(
                    "rounded-2xl border bg-surface p-4 transition-all",
                    isApplied ? "border-emerald-500/30 bg-emerald-500/[0.01]" : "border-border hover:border-border-strong"
                  )}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 border border-border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                          <Ruler className="h-2.5 w-2.5" />
                          Guideline
                        </span>
                        <span className="rounded-lg bg-surface-3 border border-border/60 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/80 font-bold">
                          {featureLabels[rec.parameter] || rec.parameter}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-foreground leading-relaxed">{rec.recommendation}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Current: <span className="font-mono font-bold">{String(rec.current)}</span>
                      </p>
                    </div>
                    {canApply ? (
                      <button
                        type="button"
                        onClick={() => onToggleRec(rec.parameter)}
                        aria-pressed={isApplied}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none",
                          isApplied ? "bg-emerald-500" : "bg-surface-3"
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                            isApplied ? "translate-x-5" : "translate-x-0"
                          )}
                        />
                      </button>
                    ) : (
                      <span className="shrink-0 rounded-full border border-border px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground/70">
                        Manual edit
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>

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
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-primary-foreground shadow-[var(--shadow-glow-purple)] transition-all hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50"
        >
          Apply Changes &amp; Re-Analyze
        </button>
      </div>
    </motion.div>
  );
}
