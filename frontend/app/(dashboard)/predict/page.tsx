"use client";

import { useState, useMemo, useEffect } from "react";
import { format as formatDate } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { analyzeCaption, CAPTION_MAX } from "@/components/CaptionIntel";
import { type WhyReason } from "@/components/WhyThisScore";
import { type ContentFormat, type Tier, type Brand } from "@/lib/types";
import { ViewSwitch, type PredictView } from "./_components/ViewSwitch";
import { ComposeView } from "./_components/ComposeView";
import { InsightsView, type InsightsPrediction } from "./_components/InsightsView";
import { type Counterfactual } from "./_components/MeasuredImprovements";

// Labels for the real model feature keys returned by the ML service.
const FEATURE_LABELS: Record<string, string> = {
  media_type: "Content Format",
  post_hour: "Posting Hour",
  caption_length: "Caption Length",
  hashtag_count: "Hashtag Count",
  has_cta: "Call-to-Action",
  is_weekend: "Weekend Posting",
  has_question: "Question Prompt",
  emoji_count: "Emoji Count",
};

export default function PredictPage() {
  const [view, setView] = useState<PredictView>("compose");

  // Brands from the real database
  const [brandsList, setBrandsList] = useState<Brand[]>([]);
  const [brandsError, setBrandsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const account = brandsList.find((b) => b.id === accountId) || null;

  const [contentFormat, setContentFormat] = useState<ContentFormat>("Reels");
  const [scheduledAt, setScheduledAt] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(19, 30, 0, 0);
    return d;
  });
  const [caption, setCaption] = useState("");
  const [visualConcept, setVisualConcept] = useState("");

  // Prediction state — null until the model has actually returned a result.
  const [prediction, setPrediction] = useState<InsightsPrediction | null>(null);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [optimizationsApplied, setOptimizationsApplied] = useState(false);

  // Staged changes from measured counterfactuals.
  const [appliedRecs, setAppliedRecs] = useState<Record<string, boolean>>({});

  // Feature importances kept separately for the evidence panels
  const [featureImportances, setFeatureImportances] = useState<Record<string, number> | null>(null);

  // Snapshot of the inputs used for the last prediction (staleness detection)
  const [predictionSnapshot, setPredictionSnapshot] = useState<{
    caption: string;
    contentFormat: ContentFormat;
    scheduledAt: number;
    accountId: string | null;
  } | null>(null);

  const isFormValid = useMemo(
    () =>
      caption.trim() !== "" &&
      account !== null &&
      scheduledAt instanceof Date &&
      !isNaN(scheduledAt.getTime()),
    [caption, account, scheduledAt]
  );

  const isPredictionStale = useMemo(() => {
    if (!predictionSnapshot) return false;
    return (
      predictionSnapshot.caption !== caption ||
      predictionSnapshot.contentFormat !== contentFormat ||
      predictionSnapshot.scheduledAt !== scheduledAt.getTime() ||
      predictionSnapshot.accountId !== accountId
    );
  }, [predictionSnapshot, caption, contentFormat, scheduledAt, accountId]);

  const stats = useMemo(() => analyzeCaption(caption), [caption]);
  const tooLong = stats.charCount > CAPTION_MAX;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithRetry("/api/brands");
        if (res.ok) {
          const data = await res.json();
          setBrandsList(data || []);
          setBrandsError(null);
          if (data && data.length > 0) setAccountId(data[0].id);
        } else {
          setBrandsList([]);
          setBrandsError("Brand accounts could not be loaded.");
        }
      } catch {
        setBrandsList([]);
        setBrandsError("Brand accounts could not be loaded.");
      }
    })();
  }, []);

  // Clear the "optimizations applied" note once inputs are edited again
  useEffect(() => {
    setOptimizationsApplied(false);
  }, [caption, contentFormat, scheduledAt, accountId]);

  const handlePredict = async () => {
    if (!isFormValid || submitting) return;
    setSubmitting(true);
    setPredictError(null);
    setAppliedRecs({});

    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption,
          format: contentFormat,
          post_hour: scheduledAt.getHours(),
          brand_id: account?.id,
          niche: account?.niche,
          scheduled_date: formatDate(scheduledAt, "yyyy-MM-dd"),
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.status === "error" || !data.predicted_class) {
        setPredictError(data?.message || "The prediction service returned an unexpected response.");
        return;
      }

      const rawProbs = data.probabilities || {};
      setPrediction({
        tier: data.predicted_class as Tier,
        confidence: Math.round(data.confidence),
        probs: [
          { tier: "High", prob: (rawProbs.High || 0) / 100 },
          { tier: "Average", prob: (rawProbs.Average || 0) / 100 },
          { tier: "Low", prob: (rawProbs.Low || 0) / 100 },
        ],
        isPersonalModel: Boolean(data.model_metadata?.is_personal_model_active),
        modelAccuracy:
          typeof data.model_metadata?.accuracy === "number"
            ? Math.round(data.model_metadata.accuracy * 100)
            : null,
        modelVersion: data.model_metadata?.version ?? null,
        trainedSamples:
          typeof data.model_metadata?.trained_samples === "number"
            ? data.model_metadata.trained_samples
            : null,
        savedId: data.prediction_id ?? null,
        outOfRange: Array.isArray(data.out_of_range) ? data.out_of_range : [],
        counterfactuals: Array.isArray(data.counterfactuals) ? data.counterfactuals : [],
        counterfactualsNote: data.counterfactuals_note ?? null,
      });
      setFeatureImportances(data.feature_importances || null);
      setPredictionSnapshot({
        caption,
        contentFormat,
        scheduledAt: scheduledAt.getTime(),
        accountId,
      });
      setView("insights");
    } catch {
      setPredictError("Could not reach the prediction service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleRec = (parameter: string) => {
    setAppliedRecs((prev) => ({ ...prev, [parameter]: !prev[parameter] }));
  };

  const applyStagedRecommendations = () => {
    if (appliedRecs.post_hour) {
      // Use the measured best hour from the what-if analysis when available.
      const hourProbe = prediction?.counterfactuals.find((c: Counterfactual) => c.parameter === "post_hour");
      const bestHour = typeof hourProbe?.to_value === "number" ? hourProbe.to_value : 19;
      const d = new Date(scheduledAt);
      d.setHours(bestHour);
      setScheduledAt(d);
    }
    let nextCaption = caption;
    if (appliedRecs.has_cta && !stats.hasCTA) {
      nextCaption += "\n\nShare this with someone who needs it!";
    }
    if (appliedRecs.hashtag_count && stats.hashtags.length < 3) {
      nextCaption += "\n#explore #community #tips";
    } else if (appliedRecs.hashtag_count && stats.hashtags.length > 8) {
      let hashtagIndex = 0;
      nextCaption = nextCaption
        .replace(/#\w+/g, (tag) => {
          hashtagIndex += 1;
          return hashtagIndex <= 5 ? tag : "";
        })
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .trimEnd();
    }
    setCaption(nextCaption);
    setOptimizationsApplied(true);
    setView("compose");
  };

  const anyRecsApplied = Object.values(appliedRecs).some(Boolean);

  // MDI chart data from the real model importances; one-hot format features
  // merge into a single "Content Format" row for readability.
  const mdiChartData = useMemo(() => {
    if (!featureImportances) return [];
    const merged: Record<string, number> = {};
    for (const [key, value] of Object.entries(featureImportances)) {
      const target =
        key === "is_single_image" || key === "is_carousel" || key === "is_reels" ? "media_type" : key;
      merged[target] = (merged[target] || 0) + value;
    }
    const items = Object.entries(merged).map(([key, importance]) => ({ key, importance }));
    const mdiMax = Math.max(...items.map((f) => f.importance), 0.001);
    return items
      .map((f) => ({
        name: FEATURE_LABELS[f.key] || f.key,
        importance: Math.round(f.importance * 100),
        rawPct: (f.importance / mdiMax) * 100,
      }))
      .sort((a, b) => b.importance - a.importance);
  }, [featureImportances]);

  // "Why this score" lists the observed model inputs and their real global
  // feature importance. Importance has no sign, so every item is deliberately
  // neutral; measured direction belongs only in the counterfactual panel.
  const whyReasons = useMemo<WhyReason[]>(() => {
    const fi = featureImportances;
    if (!fi) return [];
    const postHour = predictionSnapshot
      ? new Date(predictionSnapshot.scheduledAt).getHours()
      : scheduledAt.getHours();
    const snapshotStats = analyzeCaption(predictionSnapshot?.caption ?? caption);
    const snapDate = predictionSnapshot ? new Date(predictionSnapshot.scheduledAt) : scheduledAt;
    const reasons: WhyReason[] = [
      {
        label: `Scheduled at ${String(postHour).padStart(2, "0")}:00`,
        detail: "Posting hour is an input used by this trained model.",
        weight: fi.post_hour ?? 0,
        direction: "neutral" as const,
      },
      {
        label: snapshotStats.hasCTA
          ? `Call-to-action detected ("${snapshotStats.ctaTerms[0] || "CTA"}")`
          : "No call-to-action detected",
        detail: "An explicit save/comment/share prompt is a model input feature.",
        weight: fi.has_cta ?? 0,
        direction: "neutral" as const,
      },
      {
        label: `${snapshotStats.hashtags.length} hashtags detected`,
        detail: "Hashtag count feeds the model directly.",
        weight: fi.hashtag_count ?? 0,
        direction: "neutral" as const,
      },
      {
        label: `${snapshotStats.charCount} caption characters`,
        detail: "Caption length feeds the model directly.",
        weight: fi.caption_length ?? 0,
        direction: "neutral" as const,
      },
    ];

    if (fi.is_weekend !== undefined) {
      const weekend = snapDate.getDay() === 0 || snapDate.getDay() === 6;
      reasons.push({
        label: weekend ? "Scheduled on a weekend" : "Scheduled on a weekday",
        detail: "Day type is a model input learned from this data's posting history.",
        weight: fi.is_weekend,
        direction: "neutral" as const,
      });
    }
    if (fi.has_question !== undefined) {
      reasons.push({
        label: snapshotStats.hasQuestion ? "Caption asks the audience a question" : "No question in the caption",
        detail: "Question prompts are a model input feature.",
        weight: fi.has_question,
        direction: "neutral" as const,
      });
    }
    if (fi.emoji_count !== undefined) {
      reasons.push({
        label: `${snapshotStats.emojiCount} emoji in the caption`,
        detail: "Emoji density is a model input feature.",
        weight: fi.emoji_count,
        direction: "neutral" as const,
      });
    }
    return reasons;
  }, [featureImportances, predictionSnapshot, caption, scheduledAt]);

  const dynamicGlowClass = useMemo(() => {
    if (view === "insights" && prediction) {
      if (prediction.tier === "High") return "bg-emerald-500/10 dark:bg-emerald-500/5";
      if (prediction.tier === "Average") return "bg-amber-500/10 dark:bg-amber-500/5";
      return "bg-rose-500/10 dark:bg-rose-500/5";
    }
    return "bg-indigo-500/10 dark:bg-indigo-500/5";
  }, [view, prediction]);

  return (
    <div className="relative px-4 py-6 md:px-8 md:py-8 max-w-[1200px] mx-auto min-h-screen">
      <div
        className={`absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[350px] rounded-full filter blur-[120px] transition-all duration-1000 -z-10 pointer-events-none ${dynamicGlowClass}`}
      />

      {/* Header + view switch */}
      <div className="flex flex-col items-center justify-between gap-4 border-b border-border/60 pb-6 mb-8 md:flex-row md:items-end">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Analyze Post Performance
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Draft, score, and optimize a post before publishing.
          </p>
        </div>
        <ViewSwitch view={view} onChange={setView} insightsEnabled={prediction !== null} />
      </div>

      <AnimatePresence mode="wait">
        {submitting ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-4 py-14 px-8 border border-border bg-surface/80 backdrop-blur-xl rounded-3xl max-w-md mx-auto shadow-[var(--shadow-elevated)] text-center"
          >
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Loader2 className="h-6 w-6 animate-spin" />
            </span>
            <div>
              <h3 className="text-base font-bold font-display text-foreground">Running classification…</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Scoring your draft and measuring what-if improvements with the{" "}
                {account?.model_type === "personal" ? "personal" : "niche"} model.
              </p>
            </div>
          </motion.div>
        ) : view === "compose" ? (
          <ComposeView
            brandsList={brandsList}
            brandsError={brandsError}
            accountId={accountId}
            setAccountId={setAccountId}
            account={account}
            contentFormat={contentFormat}
            setContentFormat={setContentFormat}
            scheduledAt={scheduledAt}
            setScheduledAt={setScheduledAt}
            caption={caption}
            setCaption={setCaption}
            visualConcept={visualConcept}
            setVisualConcept={setVisualConcept}
            predictError={predictError}
            optimizationsApplied={optimizationsApplied}
            isFormValid={isFormValid}
            isPredictionStale={isPredictionStale}
            submitting={submitting}
            tooLong={tooLong}
            onAnalyze={handlePredict}
          />
        ) : (
          prediction && (
            <InsightsView
              prediction={prediction}
              isPredictionStale={isPredictionStale}
              brandName={account?.name}
              scheduledAt={scheduledAt}
              contentFormat={contentFormat}
              whyReasons={whyReasons}
              mdiChartData={mdiChartData}
              appliedRecs={appliedRecs}
              onToggleRec={handleToggleRec}
              anyRecsApplied={anyRecsApplied}
              onApply={applyStagedRecommendations}
              onEditDraft={() => setView("compose")}
            />
          )
        )}
      </AnimatePresence>
    </div>
  );
}
