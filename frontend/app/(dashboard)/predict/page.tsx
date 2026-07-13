"use client";

import { useState, useMemo, useEffect } from "react";
import { format as formatDate } from "date-fns";
import { AnimatePresence } from "framer-motion";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { hasCreativeBriefContent, parseCreativeBrief } from "@/lib/creative-brief";
import { analyzeCaption, CAPTION_MAX } from "@/components/CaptionIntel";
import { type WhyReason } from "@/components/WhyThisScore";
import { type ContentFormat, type Tier, type Brand } from "@/lib/types";
import { ViewSwitch, type PredictView } from "./_components/ViewSwitch";
import { ComposeView } from "./_components/ComposeView";
import { InsightsView, type InsightsPrediction } from "./_components/InsightsView";
import { type Counterfactual } from "./_components/MeasuredImprovements";
import { type CreativeReviewSnapshot } from "./_components/ConceptAssistant";

interface ContentPlanContext {
  id: string;
  predictionId: string | null;
  predictionStatus: "current" | "provisional" | "stale" | "superseded" | null;
  visualReference: string;
  voiceOver: "Need" | "No Need" | "Done" | null;
  pic: string;
  status: "Need Shooting" | "Need Design" | "Need Editing" | "Screening" | "Ready to Post" | "Posted" | null;
}

// Labels for the real model feature keys returned by the ML service.
const FEATURE_LABELS: Record<string, string> = {
  media_type: "Content format",
  post_hour: "Posting time",
  caption_length: "Caption length",
  hashtag_count: "Hashtag count",
  has_cta: "Call to action",
  is_weekend: "Day of week",
  has_question: "Question prompt",
  emoji_count: "Emoji count",
};

function asPercentMetric(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return Math.round(percent * 10) / 10;
}

export default function PredictPage() {
  const [view, setView] = useState<PredictView>("compose");

  const [brandsList, setBrandsList] = useState<Brand[]>([]);
  const [brandsError, setBrandsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const account = brandsList.find((b) => b.id === accountId) || null;

  const [contentFormat, setContentFormat] = useState<ContentFormat>("Reels");
  const [scheduledAt, setScheduledAt] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(19, 0, 0, 0);
    return d;
  });
  // A new draft has no committed publishing time. Keep the internal Date for
  // the date picker, but do not silently treat its 19:00 placeholder as input.
  const [hasPostTime, setHasPostTime] = useState(false);
  const [caption, setCaption] = useState("");
  const [visualConcept, setVisualConcept] = useState("");
  const [creativeReview, setCreativeReview] = useState<CreativeReviewSnapshot | null>(null);
  const [contentPlan, setContentPlan] = useState<ContentPlanContext | null>(null);
  const [planLoadError, setPlanLoadError] = useState<string | null>(null);
  const [planSaveState, setPlanSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [planSaveMessage, setPlanSaveMessage] = useState<string | null>(null);

  const [prediction, setPrediction] = useState<InsightsPrediction | null>(null);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [optimizationsApplied, setOptimizationsApplied] = useState(false);

  const [appliedRecs, setAppliedRecs] = useState<Record<string, boolean>>({});

  const [featureImportances, setFeatureImportances] = useState<Record<string, number> | null>(null);

  const [predictionSnapshot, setPredictionSnapshot] = useState<{
    caption: string;
    contentFormat: ContentFormat;
    scheduledDate: string;
    scheduledTime: string | null;
    postHour: number | null;
    accountId: string | null;
    brandName: string | null;
    visualConcept: string;
  } | null>(null);

  const isFormValid = useMemo(
    () =>
      caption.trim() !== "" &&
      account !== null &&
      account.active_model_scope !== "none" &&
      scheduledAt instanceof Date &&
      !isNaN(scheduledAt.getTime()),
    [caption, account, scheduledAt]
  );

  const isPredictionStale = useMemo(() => {
    if (!predictionSnapshot) return false;
    return (
      predictionSnapshot.caption !== caption ||
      predictionSnapshot.contentFormat !== contentFormat ||
      predictionSnapshot.scheduledDate !== formatDate(scheduledAt, "yyyy-MM-dd") ||
      predictionSnapshot.postHour !== (hasPostTime ? scheduledAt.getHours() : null) ||
      predictionSnapshot.accountId !== accountId
    );
  }, [predictionSnapshot, caption, contentFormat, scheduledAt, hasPostTime, accountId]);

  // Creative direction is deliberately outside the model contract. Changing
  // it does not invalidate the numerical prediction, but the result should be
  // transparent that its unmeasured planning context has changed.
  const isCreativeBriefChanged = useMemo(
    () => Boolean(predictionSnapshot && predictionSnapshot.visualConcept !== visualConcept),
    [predictionSnapshot, visualConcept]
  );
  const parsedCreativeBrief = useMemo(() => parseCreativeBrief(visualConcept), [visualConcept]);
  const hasCreativeBrief = hasCreativeBriefContent(parsedCreativeBrief);
  const hasCurrentContext = Boolean(
    parsedCreativeBrief.trendContext &&
    parsedCreativeBrief.trendSource &&
    parsedCreativeBrief.trendObservedAt
  );
  const currentCreativeSignature = JSON.stringify([visualConcept, caption, accountId, contentFormat]);
  const isCreativeReviewStale = Boolean(
    creativeReview && creativeReview.inputSignature !== currentCreativeSignature
  );

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
          const planId = new URLSearchParams(window.location.search).get("plan_id");
          if (planId) {
            try {
              const planResponse = await fetch(`/api/calendar?plan_id=${encodeURIComponent(planId)}`, {
                cache: "no-store",
              });
              const planPayload = await planResponse.json().catch(() => null);
              const entry = Array.isArray(planPayload) ? planPayload[0] : null;
              if (!planResponse.ok || !entry) {
                throw new Error(planPayload?.message || "Content Plan entry was not found.");
              }
              const ownedBrand = (data || []).find((brand: Brand) => brand.id === entry.brand_id) || null;
              if (!ownedBrand) throw new Error("The Content Plan entry is not assigned to an available brand.");
              const nextDate = new Date(`${entry.posting_date}T12:00:00`);
              const rawTime = entry.posting_time ? String(entry.posting_time).slice(0, 5) : null;
              if (rawTime) {
                const [hours, minutes] = rawTime.split(":").map(Number);
                nextDate.setHours(hours, minutes || 0, 0, 0);
              }
              setAccountId(ownedBrand.id);
              if (["Reels", "Carousel", "Single Image"].includes(entry.content_type)) {
                setContentFormat(entry.content_type as ContentFormat);
              }
              setScheduledAt(nextDate);
              setHasPostTime(Boolean(rawTime));
              setCaption(entry.caption || "");
              setVisualConcept(entry.content_details || "");
              setContentPlan({
                id: entry.id,
                predictionId: entry.prediction_id || null,
                predictionStatus: entry.prediction?.status || null,
                visualReference: entry.visual_reference || "",
                voiceOver: entry.voice_over || null,
                pic: entry.pic || "",
                status: entry.status || null,
              });
              setPlanLoadError(null);
            } catch (caught: unknown) {
              setPlanLoadError(caught instanceof Error ? caught.message : "Content Plan entry could not be loaded.");
            }
          }
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

  useEffect(() => {
    setOptimizationsApplied(false);
    setPlanSaveState("idle");
    setPlanSaveMessage(null);
  }, [caption, contentFormat, scheduledAt, hasPostTime, accountId, visualConcept]);

  const persistContentPlan = async (predictionId: string): Promise<boolean> => {
    if (!account) return false;
    setPlanSaveState("saving");
    setPlanSaveMessage(null);
    try {
      const payload = {
        brand_id: account.id,
        posting_date: formatDate(scheduledAt, "yyyy-MM-dd"),
        posting_time: hasPostTime ? formatDate(scheduledAt, "HH:mm") : null,
        content_type: contentFormat,
        content_details: visualConcept || null,
        visual_reference: contentPlan?.visualReference || null,
        caption,
        voice_over: contentPlan?.voiceOver || null,
        pic: contentPlan?.pic || null,
        status: contentPlan?.status || null,
        prediction_id: predictionId,
      };
      const response = await fetch("/api/calendar", {
        method: contentPlan ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contentPlan ? { id: contentPlan.id, ...payload } : payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message || "Content Plan could not be saved.");
      const saved = result?.entry || result?.entries?.[0];
      const planId = contentPlan?.id || saved?.id;
      if (!planId) throw new Error("Content Plan was saved but its ID was not returned.");
      setContentPlan({
        id: planId,
        predictionId,
        predictionStatus: hasPostTime ? "current" : "provisional",
        visualReference: contentPlan?.visualReference || "",
        voiceOver: contentPlan?.voiceOver || null,
        pic: contentPlan?.pic || "",
        status: contentPlan?.status || null,
      });
      setPlanSaveState("saved");
      setPlanSaveMessage(contentPlan ? "Linked Content Plan updated." : "Saved to Content Plan.");
      return true;
    } catch (caught: unknown) {
      setPlanSaveState("error");
      setPlanSaveMessage(caught instanceof Error ? caught.message : "Content Plan could not be saved.");
      return false;
    }
  };

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
          post_hour: hasPostTime ? scheduledAt.getHours() : null,
          brand_id: account?.id,
          niche: account?.niche,
          scheduled_date: formatDate(scheduledAt, "yyyy-MM-dd"),
          supersedes_prediction_id:
            contentPlan?.predictionId && contentPlan.predictionStatus !== "superseded"
              ? contentPlan.predictionId
              : isPredictionStale &&
                  prediction?.savedId &&
                  predictionSnapshot?.accountId === accountId
                ? prediction.savedId
                : null,
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
        classScore: Math.round(data.confidence),
        classScores: [
          { tier: "High", score: rawProbs.High || 0 },
          { tier: "Average", score: rawProbs.Average || 0 },
          { tier: "Low", score: rawProbs.Low || 0 },
        ],
        isPersonalModel: Boolean(data.model_metadata?.is_personal_model_active),
        modelAccuracy: asPercentMetric(data.model_metadata?.accuracy),
        modelMacroF1: asPercentMetric(data.model_metadata?.macro_f1),
        modelBalancedAccuracy: asPercentMetric(data.model_metadata?.balanced_accuracy),
        baselineAccuracy: asPercentMetric(data.model_metadata?.baseline_accuracy),
        accuracyGainOverBaseline: asPercentMetric(data.model_metadata?.accuracy_gain_over_baseline),
        testSamples:
          typeof data.model_metadata?.test_samples === "number"
            ? data.model_metadata.test_samples
            : null,
        heldOutClassesComplete:
          typeof data.model_metadata?.held_out_classes_complete === "boolean"
            ? data.model_metadata.held_out_classes_complete
            : null,
        evaluationStatus:
          data.model_metadata?.evaluation_status === "validated" ||
          data.model_metadata?.evaluation_status === "exploratory"
            ? data.model_metadata.evaluation_status
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
        status: data.prediction_context?.status === "provisional" ? "provisional" : "current",
        timeKnown: data.prediction_context?.time_known !== false,
        scenarioHours: Array.isArray(data.prediction_context?.scenario_hours)
          ? data.prediction_context.scenario_hours
          : [],
      });
      setFeatureImportances(data.feature_importances || null);
      setPredictionSnapshot({
        caption,
        contentFormat,
        scheduledDate: formatDate(scheduledAt, "yyyy-MM-dd"),
        scheduledTime: hasPostTime ? formatDate(scheduledAt, "HH:mm") : null,
        postHour: hasPostTime ? scheduledAt.getHours() : null,
        accountId,
        brandName: account?.name ?? null,
        visualConcept,
      });
      if (contentPlan && data.prediction_id) {
        await persistContentPlan(data.prediction_id);
      }
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
      d.setHours(bestHour, 0, 0, 0);
      setScheduledAt(d);
      setHasPostTime(true);
    }
    setOptimizationsApplied(true);
    setView("compose");
  };

  const anyRecsApplied = Object.values(appliedRecs).some(Boolean);

  const predictionScheduledAt = useMemo(() => {
    if (!predictionSnapshot) return scheduledAt;
    return new Date(
      `${predictionSnapshot.scheduledDate}T${predictionSnapshot.scheduledTime ?? "00:00"}:00`
    );
  }, [predictionSnapshot, scheduledAt]);

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
      ? predictionSnapshot.postHour
      : hasPostTime ? scheduledAt.getHours() : null;
    const snapshotStats = analyzeCaption(predictionSnapshot?.caption ?? caption);
    const snapDate = predictionSnapshot
      ? new Date(`${predictionSnapshot.scheduledDate}T00:00:00`)
      : scheduledAt;
    const reasons: WhyReason[] = [
      {
        label: postHour == null ? "Posting time not set" : `Scheduled at ${String(postHour).padStart(2, "0")}:00`,
        detail: postHour == null
          ? "The estimate combines posting times seen in past data."
          : "The selected time is included in the estimate.",
        weight: fi.post_hour ?? 0,
        direction: "neutral" as const,
      },
      {
        label: snapshotStats.hasCTA
          ? `Call-to-action detected ("${snapshotStats.ctaTerms[0] || "CTA"}")`
          : "No call-to-action detected",
        detail: "Save, comment, and share prompts are included in the estimate.",
        weight: fi.has_cta ?? 0,
        direction: "neutral" as const,
      },
      {
        label: `${snapshotStats.hashtags.length} hashtags detected`,
        detail: "The number of hashtags is included.",
        weight: fi.hashtag_count ?? 0,
        direction: "neutral" as const,
      },
      {
        label: `${snapshotStats.charCount} caption characters`,
        detail: "Caption length is included.",
        weight: fi.caption_length ?? 0,
        direction: "neutral" as const,
      },
    ];

    if (fi.is_weekend !== undefined) {
      const weekend = snapDate.getDay() === 0 || snapDate.getDay() === 6;
      reasons.push({
        label: weekend ? "Scheduled on a weekend" : "Scheduled on a weekday",
        detail: "Weekday and weekend patterns are included.",
        weight: fi.is_weekend,
        direction: "neutral" as const,
      });
    }
    if (fi.has_question !== undefined) {
      reasons.push({
        label: snapshotStats.hasQuestion ? "Caption asks the audience a question" : "No question in the caption",
        detail: "Audience questions are included.",
        weight: fi.has_question,
        direction: "neutral" as const,
      });
    }
    if (fi.emoji_count !== undefined) {
      reasons.push({
        label: `${snapshotStats.emojiCount} emoji in the caption`,
        detail: "The number of emoji is included.",
        weight: fi.emoji_count,
        direction: "neutral" as const,
      });
    }
    return reasons;
  }, [featureImportances, predictionSnapshot, caption, scheduledAt, hasPostTime]);

  return (
    <div className="relative mx-auto min-h-screen max-w-[1480px] px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex flex-col justify-between gap-4 border-b border-border/60 pb-5 md:flex-row md:items-end">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">Predict content performance</h1>
          <p className="mt-2 text-sm text-muted-foreground">Evaluate a draft before publishing.</p>
        </div>
        <ViewSwitch view={view} onChange={setView} insightsEnabled={prediction !== null} />
      </div>

      <AnimatePresence mode="wait">
        {view === "compose" ? (
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
            hasPostTime={hasPostTime}
            setHasPostTime={setHasPostTime}
            caption={caption}
            setCaption={setCaption}
            visualConcept={visualConcept}
            setVisualConcept={setVisualConcept}
            predictError={predictError}
            contentPlanId={contentPlan?.id || null}
            planLoadError={planLoadError}
            optimizationsApplied={optimizationsApplied}
            isFormValid={isFormValid}
            isPredictionStale={isPredictionStale}
            submitting={submitting}
            tooLong={tooLong}
            onAnalyze={handlePredict}
            creativeReview={creativeReview}
            onCreativeReview={setCreativeReview}
          />
        ) : (
          prediction && (
            <InsightsView
              prediction={prediction}
              isPredictionStale={isPredictionStale}
              isCreativeBriefChanged={isCreativeBriefChanged}
              hasCreativeBrief={hasCreativeBrief}
              hasCurrentContext={hasCurrentContext}
              creativeReview={creativeReview}
              isCreativeReviewStale={isCreativeReviewStale}
              brandName={predictionSnapshot?.brandName ?? undefined}
              brandId={predictionSnapshot?.accountId ?? null}
              scheduledAt={predictionScheduledAt}
              hasPostTime={predictionSnapshot?.postHour != null}
              contentFormat={predictionSnapshot?.contentFormat ?? contentFormat}
              whyReasons={whyReasons}
              mdiChartData={mdiChartData}
              appliedRecs={appliedRecs}
              onToggleRec={handleToggleRec}
              anyRecsApplied={anyRecsApplied}
              onApply={applyStagedRecommendations}
              onEditDraft={() => setView("compose")}
              contentPlanId={contentPlan?.id || null}
              planSaveState={planSaveState}
              planSaveMessage={planSaveMessage}
              onSaveToContentPlan={() => {
                if (prediction.savedId) void persistContentPlan(prediction.savedId);
              }}
            />
          )
        )}
      </AnimatePresence>
    </div>
  );
}
