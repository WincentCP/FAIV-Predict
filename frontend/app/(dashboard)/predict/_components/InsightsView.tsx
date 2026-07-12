"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { format as formatDate } from "date-fns";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { WhyThisScore, type WhyReason } from "@/components/WhyThisScore";
import { type Tier, type ContentFormat } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Panel } from "./Panel";
import { TrustStrip } from "./TrustStrip";
import { MeasuredImprovements, type Counterfactual } from "./MeasuredImprovements";
import { FormatComparison } from "./FormatComparison";

const FeatureAttributionChart = dynamic(() => import("@/components/FeatureAttributionChart"), {
  ssr: false,
  loading: () => (
    <div role="status" aria-label="Loading feature importance" className="h-56 w-full animate-pulse rounded-xl bg-muted/40" />
  ),
});

export interface InsightsPrediction {
  tier: Tier;
  classScore: number;
  classScores: Array<{ tier: Tier; score: number }>;
  isPersonalModel: boolean;
  modelAccuracy: number | null;
  modelMacroF1: number | null;
  modelBalancedAccuracy: number | null;
  baselineAccuracy: number | null;
  accuracyGainOverBaseline: number | null;
  testSamples: number | null;
  heldOutClassesComplete: boolean | null;
  evaluationStatus: "validated" | "exploratory" | null;
  modelVersion: string | null;
  trainedSamples: number | null;
  savedId: string | null;
  outOfRange: string[];
  counterfactuals: Counterfactual[];
  counterfactualsNote: string | null;
  status: "current" | "provisional";
  timeKnown: boolean;
  scenarioHours: number[];
}

function RawScoreBar({ tier, score, active }: { tier: Tier; score: number; active: boolean }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div className={cn("space-y-2", !active && "opacity-60")}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className={cn("font-medium", active ? "text-foreground" : "text-muted-foreground")}>{tier}</span>
        <span className="font-semibold tabular-nums text-foreground">{value}/100</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${tier}: raw class score ${value} out of 100; not a calibrated probability`}>
        <motion.div
          initial={false}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.36, ease: [0.2, 0, 0, 1] }}
          className={cn("h-full rounded-full", active ? "bg-primary" : "bg-muted-foreground/45")}
        />
      </div>
    </div>
  );
}

export function InsightsView(props: {
  prediction: InsightsPrediction;
  isPredictionStale: boolean;
  isCreativeBriefChanged: boolean;
  brandName?: string;
  scheduledAt: Date;
  hasPostTime: boolean;
  contentFormat: ContentFormat;
  whyReasons: WhyReason[];
  mdiChartData: { name: string; importance: number; rawPct: number }[];
  appliedRecs: Record<string, boolean>;
  onToggleRec: (parameter: string) => void;
  anyRecsApplied: boolean;
  onApply: () => void;
  onEditDraft: () => void;
  contentPlanId: string | null;
  planSaveState: "idle" | "saving" | "saved" | "error";
  planSaveMessage: string | null;
  onSaveToContentPlan: () => void;
}) {
  const {
    prediction,
    isPredictionStale,
    isCreativeBriefChanged,
    brandName,
    scheduledAt,
    hasPostTime,
    contentFormat,
    whyReasons,
    mdiChartData,
    appliedRecs,
    onToggleRec,
    anyRecsApplied,
    onApply,
    onEditDraft,
    contentPlanId,
    planSaveState,
    planSaveMessage,
    onSaveToContentPlan,
  } = props;

  const [showModelContext, setShowModelContext] = useState(false);
  const formatProbes = prediction.counterfactuals.filter((probe) => probe.parameter === "format");
  const improvementProbes = prediction.counterfactuals.filter((probe) => probe.parameter !== "format");
  const comparisonScope = prediction.isPersonalModel
    ? `${brandName || "this brand"}'s own verified history`
    : "the selected niche's verified history";

  return (
    <motion.div
      key="view-insights"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="mx-auto max-w-[1380px] space-y-5"
    >
      {isPredictionStale && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/[0.04] p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-semibold text-foreground">This result is stale</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">A model input changed after prediction. Return to the draft and predict again before using or saving this result.</p>
          </div>
        </div>
      )}

      {isCreativeBriefChanged && !isPredictionStale && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
          <p className="text-sm leading-relaxed text-muted-foreground"><strong className="text-foreground">Creative direction changed.</strong> The score remains current because this brief is not a model input. Review any earlier AI guidance.</p>
        </div>
      )}

      <section aria-labelledby="prediction-verdict" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
        <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:p-8">
          <div className="flex flex-col justify-center">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">Predicted tier</span>
              {prediction.savedId && <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted-foreground">Saved to history</span>}
              {prediction.status === "provisional" && <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">Provisional · time unknown</span>}
            </div>

            <h2 id="prediction-verdict" className="mt-5 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {prediction.tier}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              This draft is predicted to fall in the <strong className="text-foreground">{prediction.tier.toLowerCase()} engagement tier</strong> for likes plus comments relative to {comparisonScope}. It does not predict reach, sales, or business impact.
            </p>
            {prediction.status === "provisional" && (
              <p className="mt-3 text-sm font-medium text-warning">Set a target hour and predict again before final approval or publishing.</p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface-2/45 p-5">
            <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Raw class scores</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Classifier output, not calibrated probability</p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-semibold tabular-nums text-foreground">{prediction.classScore}<span className="text-sm text-muted-foreground">/100</span></div>
                <div className="text-xs text-muted-foreground">winning class</div>
              </div>
            </div>
            <div className="mt-5 space-y-4">
              {prediction.classScores.map((item) => <RawScoreBar key={item.tier} tier={item.tier} score={item.score} active={item.tier === prediction.tier} />)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border bg-surface-2/35 px-6 py-4 text-sm text-muted-foreground lg:px-8">
          <span className="font-medium text-foreground">{brandName || "Brand unavailable"}</span>
          <span>{formatDate(scheduledAt, "MMM d, yyyy")}</span>
          <span>{hasPostTime ? `${formatDate(scheduledAt, "HH")}:00 WIB` : "Time not set"}</span>
          <span className="rounded-lg border border-border bg-surface px-2 py-1 text-xs font-semibold text-foreground">{contentFormat}</span>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="space-y-5">
          <h2 className="px-1 font-display text-2xl font-semibold tracking-tight text-foreground">Recommendations</h2>

          <MeasuredImprovements counterfactuals={improvementProbes} note={prediction.counterfactualsNote} appliedRecs={appliedRecs} onToggle={onToggleRec} />
          <FormatComparison formatProbes={formatProbes} currentFormat={contentFormat} />

          <TrustStrip
            isPersonalModel={prediction.isPersonalModel}
            trainedSamples={prediction.trainedSamples}
            modelAccuracy={prediction.modelAccuracy}
            modelMacroF1={prediction.modelMacroF1}
            modelBalancedAccuracy={prediction.modelBalancedAccuracy}
            baselineAccuracy={prediction.baselineAccuracy}
            accuracyGainOverBaseline={prediction.accuracyGainOverBaseline}
            testSamples={prediction.testSamples}
            heldOutClassesComplete={prediction.heldOutClassesComplete}
            evaluationStatus={prediction.evaluationStatus}
            modelVersion={prediction.modelVersion}
            outOfRange={prediction.outOfRange}
          />

          <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
            <button
              type="button"
              aria-expanded={showModelContext}
              aria-controls="prediction-model-context"
              onClick={() => setShowModelContext((open) => !open)}
              className="flex min-h-16 w-full items-center justify-between gap-4 p-5 text-left hover:bg-surface-2/40"
            >
              <div>
                <h3 className="text-base font-semibold text-foreground">Model context and limitations</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Inspect observed inputs and global feature influence without interpreting them as causal effects.</p>
              </div>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", showModelContext && "rotate-180")} />
            </button>

            {showModelContext && (
              <div id="prediction-model-context" className="grid gap-5 border-t border-border p-5 md:grid-cols-2">
                <WhyThisScore reasons={whyReasons} context="Observed input values ranked by global model importance. Importance has magnitude, not positive or negative direction." />
                <Panel title="Global feature importance" subtitle="Mean Decrease in Impurity across the model; this is not a local causal explanation.">
                  <div className="mt-2 h-56 w-full">
                    {mdiChartData.length === 0 ? (
                      <div className="flex h-full w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-2/40 p-5 text-center">
                        <p className="text-sm font-semibold text-foreground">Model weights unavailable</p>
                      </div>
                    ) : <FeatureAttributionChart data={mdiChartData} />}
                  </div>
                </Panel>
              </div>
            )}
          </section>
        </main>

        <aside className="space-y-5 xl:sticky xl:top-24" aria-label="Prediction actions">
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-soft)]">
            <h2 className="text-base font-semibold text-foreground">Next action</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {anyRecsApplied
                ? "Apply the selected posting hour, then predict again to create a new version."
                : "Save this result to the plan, or return to the draft."}
            </p>

            {planSaveMessage && (
              <p role={planSaveState === "error" ? "alert" : "status"} className={cn("mt-3 rounded-lg px-3 py-2 text-sm font-medium", planSaveState === "error" ? "bg-destructive/10 text-destructive" : "bg-surface-2 text-foreground")}>{planSaveMessage}</p>
            )}

            <div className="mt-4 space-y-2.5">
              {anyRecsApplied && (
                <button type="button" onClick={onApply} disabled={isPredictionStale} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-45">
                  Apply selected change
                </button>
              )}

              {planSaveState === "saved" && contentPlanId ? (
                <Link href="/calendar" className={cn("flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold", anyRecsApplied ? "border border-border bg-surface text-foreground hover:bg-surface-2" : "bg-primary text-primary-foreground hover:bg-primary/90")}>
                  Open plan
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={onSaveToContentPlan}
                  disabled={!prediction.savedId || isPredictionStale || planSaveState === "saving"}
                  className={cn("flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-45", anyRecsApplied ? "border border-border bg-surface text-foreground hover:bg-surface-2" : "bg-primary text-primary-foreground hover:bg-primary/90")}
                >
                  {planSaveState === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {contentPlanId ? "Update plan" : "Save to plan"}
                </button>
              )}

              <button type="button" onClick={onEditDraft} className="flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:bg-surface-2 hover:text-foreground">
                Edit draft
              </button>
            </div>
          </section>

        </aside>
      </div>
    </motion.div>
  );
}
