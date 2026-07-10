"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { DatePicker, TimePicker } from "@/components/DateTimePicker";
import { FlowStepper } from "@/components/FlowStepper";
import { ModelMaturity } from "@/components/ModelMaturity";
import { ConfidenceMeter } from "@/components/ConfidenceMeter";
import { TierBadge } from "@/components/TierBadge";
import { WhyThisScore, type WhyReason } from "@/components/WhyThisScore";
import {
  analyzeCaption,
  CaptionMeter,
  CaptionSignals,
  CaptionLimitWarning,
  CAPTION_MAX,
} from "@/components/CaptionIntel";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  Film,
  LayoutGrid,
  Image as ImageIcon,
  PenTool,
  ArrowRight,
  Check,
  Clock,
  Calendar,
  HelpCircle,
  FileText,
  AlertTriangle,
  Cpu,
  Activity,
  Loader2,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import dynamic from "next/dynamic";

const FeatureAttributionChart = dynamic(() => import("@/components/FeatureAttributionChart"), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse bg-muted/40 rounded-xl" />,
});

import { type ContentFormat, type Tier, type Brand } from "@/lib/types";
import { cn } from "@/lib/utils";

const FORMATS: { id: ContentFormat; label: string; icon: typeof Film; hint: string }[] = [
  { id: "Reels", label: "Reels", icon: Film, hint: "Vertical video content" },
  { id: "Carousel", label: "Carousel", icon: LayoutGrid, hint: "Multiple images swipe" },
  { id: "Single Image", label: "Single Image", icon: ImageIcon, hint: "Static feed post" },
];

// Labels for the real model feature keys returned by the ML service.
const FEATURE_LABELS: Record<string, string> = {
  media_type: "Content Format",
  post_hour: "Posting Hour",
  caption_length: "Caption Length",
  hashtag_count: "Hashtag Count",
  has_cta: "Call-to-Action",
};

type AiState = "idle" | "loading" | "enriched" | "unavailable";

interface PredictionResult {
  tier: Tier;
  confidence: number;
  probs: Array<{ tier: Tier; prob: number }>;
  featureImportances: Record<string, number> | null;
  isPersonalModel: boolean;
  modelAccuracy: number | null;
  savedId: string | null;
}

interface TreRecommendation {
  parameter: string;
  current: string | number;
  recommendation: string;
  impact: string;
}

// TRE parameters the UI can stage automatically on "Apply & Re-Analyze".
const AUTO_APPLICABLE = new Set(["post_hour", "has_cta", "hashtag_count"]);

export default function PredictPage() {
  const [activeStep, setActiveStep] = useState(1);

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
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [optimizationsApplied, setOptimizationsApplied] = useState(false);

  // TRE recommendations from the ML service
  const [treRecs, setTreRecs] = useState<TreRecommendation[] | null>(null);
  const [treError, setTreError] = useState<string | null>(null);

  // Optional AI caption refinement (Gemini via BFF)
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiMessage, setAiMessage] = useState("");
  const [typewriterText, setTypewriterText] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // Staged optimizations selected on the Optimize step
  const [appliedRecs, setAppliedRecs] = useState<Record<string, boolean>>({});

  // Snapshot of the inputs used for the last prediction (staleness detection)
  const [predictionSnapshot, setPredictionSnapshot] = useState<{
    caption: string;
    contentFormat: ContentFormat;
    scheduledAt: number;
    accountId: string | null;
  } | null>(null);

  const isFormValid = useMemo(() => {
    return (
      caption.trim() !== "" &&
      account !== null &&
      scheduledAt instanceof Date &&
      !isNaN(scheduledAt.getTime())
    );
  }, [caption, account, scheduledAt]);

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

  // Load real brands on mount
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const res = await fetch("/api/brands");
        if (res.ok) {
          const data = await res.json();
          setBrandsList(data || []);
          setBrandsError(null);
          if (data && data.length > 0) {
            setAccountId(data[0].id);
          }
        } else {
          setBrandsList([]);
          setBrandsError("Brand accounts could not be loaded.");
        }
      } catch {
        setBrandsList([]);
        setBrandsError("Brand accounts could not be loaded.");
      }
    };
    fetchBrands();
  }, []);

  // Clear the "optimizations applied" note once inputs are edited again
  useEffect(() => {
    setOptimizationsApplied(false);
  }, [caption, contentFormat, scheduledAt, accountId]);

  const fetchTreRecommendations = useCallback(
    async (payload: { caption: string; format: ContentFormat; post_hour: number }) => {
      setTreRecs(null);
      setTreError(null);
      try {
        const res = await fetch("/api/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            brand_id: account?.id,
            niche: account?.niche,
          }),
        });
        if (!res.ok) {
          throw new Error("Recommendation service unavailable");
        }
        const data = await res.json();
        setTreRecs(Array.isArray(data.recommendations) ? data.recommendations : []);
      } catch {
        setTreError("Recommendations are unavailable right now.");
      }
    },
    [account]
  );

  const handlePredict = async () => {
    if (!isFormValid || submitting) return;
    setSubmitting(true);
    setPredictError(null);
    setAiState("idle");
    setTypewriterText("");
    setAppliedRecs({});

    const payload = {
      caption,
      format: contentFormat,
      post_hour: scheduledAt.getHours(),
      brand_id: account?.id,
      niche: account?.niche,
      scheduled_date: format(scheduledAt, "yyyy-MM-dd"),
    };

    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.status === "error" || !data.predicted_class) {
        setPredictError(
          data?.message || "The prediction service returned an unexpected response."
        );
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
        featureImportances: data.feature_importances || null,
        isPersonalModel: Boolean(data.model_metadata?.is_personal_model_active),
        modelAccuracy:
          typeof data.model_metadata?.accuracy === "number"
            ? Math.round(data.model_metadata.accuracy * 100)
            : null,
        savedId: data.prediction_id ?? null,
      });
      setPredictionSnapshot({
        caption,
        contentFormat,
        scheduledAt: scheduledAt.getTime(),
        accountId,
      });
      setActiveStep(2);

      // Fetch the deterministic TRE recommendations for the Optimize step.
      fetchTreRecommendations({
        caption,
        format: contentFormat,
        post_hour: scheduledAt.getHours(),
      });
    } catch {
      setPredictError("Could not reach the prediction service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStepClick = (stepNum: number) => {
    if (stepNum === 1 || prediction) {
      setActiveStep(stepNum);
    }
  };

  // Optional AI caption refinement via Gemini (BFF /api/refine-caption)
  const enrichWithAI = async () => {
    setAiState("loading");
    setTypewriterText("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/refine-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visual_concept: visualConcept,
          caption,
          brand: account?.name,
          format: contentFormat,
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.status === "success" && data.suggestions) {
        setAiState("enriched");
        const suggestedText: string = data.suggestions;
        let idx = 0;
        const interval = setInterval(() => {
          idx += 2;
          setTypewriterText(suggestedText.slice(0, idx));
          if (idx >= suggestedText.length) {
            clearInterval(interval);
            setIsTyping(false);
          }
        }, 12);
        return;
      }

      setAiState("unavailable");
      setAiMessage(data?.message || "AI caption refinement is unavailable.");
      setIsTyping(false);
    } catch {
      setAiState("unavailable");
      setAiMessage("AI caption refinement is unavailable.");
      setIsTyping(false);
    }
  };

  const applyAiTextToCaption = () => {
    if (typewriterText) {
      setCaption(typewriterText);
    }
  };

  const handleToggleRec = (parameter: string) => {
    setAppliedRecs((prev) => ({ ...prev, [parameter]: !prev[parameter] }));
  };

  const applyStagedRecommendations = () => {
    if (appliedRecs.post_hour) {
      const d = new Date(scheduledAt);
      d.setHours(19, 0, 0, 0);
      setScheduledAt(d);
    }
    let nextCaption = caption;
    if (appliedRecs.has_cta && !stats.hasCTA) {
      nextCaption += "\n\nSave this for later!";
    }
    if (appliedRecs.hashtag_count && stats.hashtags.length < 3) {
      nextCaption += "\n#explore #community #tips";
    }
    setCaption(nextCaption);
    setOptimizationsApplied(true);
    setActiveStep(1);
  };

  const anyRecsApplied = Object.values(appliedRecs).some(Boolean);

  // MDI chart data from the real model importances. The three one-hot format
  // features are merged into a single "Content Format" row for readability.
  const mdiChartData = useMemo(() => {
    const fi = prediction?.featureImportances;
    if (!fi) return [];

    const merged: Record<string, number> = {};
    for (const [key, value] of Object.entries(fi)) {
      const target =
        key === "is_single_image" || key === "is_carousel" || key === "is_reels"
          ? "media_type"
          : key;
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
  }, [prediction]);

  // "Why this score" — input signals checked against the niche guidelines the
  // TRE uses, weighted by the model's real global feature importances (MDI).
  const whyReasons = useMemo<WhyReason[]>(() => {
    const fi = prediction?.featureImportances;
    if (!fi) return [];

    const postHour = predictionSnapshot
      ? new Date(predictionSnapshot.scheduledAt).getHours()
      : scheduledAt.getHours();
    const snapshotStats = analyzeCaption(predictionSnapshot?.caption ?? caption);
    const inWindow = postHour >= 17 && postHour <= 21;
    const goodHashtags = snapshotStats.hashtags.length >= 3 && snapshotStats.hashtags.length <= 8;
    const goodLength = snapshotStats.charCount >= 180 && snapshotStats.charCount <= 320;

    return [
      {
        label: inWindow
          ? `Posted at ${postHour}:00 — inside the 17:00–21:00 activity window`
          : `Posted at ${postHour}:00 — outside the 17:00–21:00 activity window`,
        detail: "Evening hours carry the highest audience activity in this niche's history.",
        weight: fi.post_hour ?? 0,
        direction: inWindow ? ("positive" as const) : ("negative" as const),
      },
      {
        label: snapshotStats.hasCTA
          ? `Call-to-action detected ("${snapshotStats.ctaTerms[0] || "CTA"}")`
          : "No call-to-action detected",
        detail: "An explicit save/comment/share prompt is a model input feature.",
        weight: fi.has_cta ?? 0,
        direction: snapshotStats.hasCTA ? ("positive" as const) : ("negative" as const),
      },
      {
        label: goodHashtags
          ? `${snapshotStats.hashtags.length} hashtags — within the 3–8 baseline`
          : `${snapshotStats.hashtags.length} hashtags — outside the 3–8 baseline`,
        detail: "Hashtag count feeds the model directly.",
        weight: fi.hashtag_count ?? 0,
        direction: goodHashtags ? ("positive" as const) : ("negative" as const),
      },
      {
        label: goodLength
          ? `${snapshotStats.charCount} characters — within the 180–320 baseline`
          : `${snapshotStats.charCount} characters — outside the 180–320 baseline`,
        detail: "Caption length feeds the model directly.",
        weight: fi.caption_length ?? 0,
        direction: goodLength ? ("positive" as const) : ("negative" as const),
      },
    ];
  }, [prediction, predictionSnapshot, caption, scheduledAt]);

  const tierColorClass = (tier: Tier) =>
    tier === "High"
      ? "text-emerald-500 dark:text-emerald-400"
      : tier === "Average"
      ? "text-amber-500 dark:text-amber-400"
      : "text-rose-500 dark:text-rose-400";

  const dynamicGlowClass = useMemo(() => {
    if (activeStep === 2 && prediction) {
      if (prediction.tier === "High") return "bg-emerald-500/10 dark:bg-emerald-500/5";
      if (prediction.tier === "Average") return "bg-amber-500/10 dark:bg-amber-500/5";
      return "bg-rose-500/10 dark:bg-rose-500/5";
    }
    return "bg-indigo-500/10 dark:bg-indigo-500/5";
  }, [activeStep, prediction]);

  return (
    <div className="relative px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto min-h-screen">
      {/* Ambient glow */}
      <div
        className={`absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[350px] rounded-full filter blur-[120px] transition-all duration-1000 -z-10 pointer-events-none ${dynamicGlowClass}`}
      />

      {/* Header + stepper */}
      <div className="flex flex-col items-center justify-between gap-4 border-b border-border/60 pb-6 mb-8 md:flex-row md:items-end">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Analyze Post Performance
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Draft, score, and optimize a post before publishing.
          </p>
        </div>
        <div className="shrink-0 w-full md:w-auto flex justify-center md:justify-end">
          <FlowStepper activeStep={activeStep} onStepClick={handleStepClick} />
        </div>
      </div>

      <div className="mx-auto max-w-4xl">
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
                <h3 className="text-base font-bold font-display text-foreground">
                  Running classification…
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Scoring your draft with the {account?.model_type === "personal" ? "personal" : "niche"} Random Forest model.
                </p>
              </div>
            </motion.div>
          ) : (
            <>
              {/* STEP 1: PREDICT */}
              {activeStep === 1 && (
                <motion.div
                  key="step-predict"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                  className="space-y-6"
                >
                  {predictError && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4 flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="text-xs font-bold text-destructive">Prediction failed</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{predictError}</p>
                      </div>
                      <button
                        type="button"
                        onClick={handlePredict}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 shrink-0"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Retry
                      </button>
                    </div>
                  )}

                  {optimizationsApplied && (
                    <div className="rounded-xl border border-primary/20 bg-primary/[0.02] p-4 flex items-center gap-3">
                      <Sparkles className="h-4 w-4 text-primary shrink-0" />
                      <div className="text-xs text-foreground font-semibold">
                        Optimizations applied — run <span className="text-primary">Analyze Post</span> to re-score.
                      </div>
                    </div>
                  )}

                  <div className="grid gap-6 md:grid-cols-12">
                    {/* Left: account + post settings */}
                    <div className="md:col-span-5 space-y-6">
                      <Panel title="Brand Account" subtitle="The model is selected per brand.">
                        <select
                          value={accountId ?? ""}
                          onChange={(e) => setAccountId(e.target.value || null)}
                          disabled={brandsList.length === 0}
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs font-semibold outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
                        >
                          {brandsList.length === 0 ? (
                            <option value="">No brand accounts available</option>
                          ) : (
                            brandsList.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name} · {b.niche}
                              </option>
                            ))
                          )}
                        </select>
                        {brandsList.length === 0 && (
                          <p className="mt-2 text-xs text-destructive font-semibold">
                            {brandsError || "No brand accounts yet. Register one under Niche Management."}
                          </p>
                        )}
                        {account && (
                          <div className="mt-3">
                            <ModelMaturity samples={account.samples ?? 0} />
                          </div>
                        )}
                      </Panel>

                      <Panel title="Post Configuration" subtitle="Format and publication slot.">
                        <div className="space-y-5">
                          <div>
                            <Label>Content Format</Label>
                            <div className="grid grid-cols-1 gap-3 mt-1.5">
                              {FORMATS.map((f) => {
                                const active = contentFormat === f.id;
                                return (
                                  <button
                                    key={f.id}
                                    type="button"
                                    onClick={() => setContentFormat(f.id)}
                                    className={`group relative flex items-center gap-4 rounded-xl border p-3.5 text-left transition-all active:scale-[0.98] ${
                                      active
                                        ? "border-primary bg-gradient-to-r from-primary/10 to-primary-glow/5 text-primary shadow-[var(--shadow-glow-purple)]"
                                        : "border-border bg-surface hover:border-border-strong hover:bg-surface-2/30"
                                    }`}
                                  >
                                    <span
                                      className={`grid h-7 w-7 place-items-center rounded-lg transition-all ${
                                        active
                                          ? "bg-primary text-primary-foreground"
                                          : "bg-surface-2 text-muted-foreground group-hover:bg-surface-3"
                                      }`}
                                    >
                                      <f.icon className="h-3.5 w-3.5" />
                                    </span>
                                    <div className="flex-1">
                                      <div className="text-[11px] font-bold text-foreground">{f.label}</div>
                                      <div className="text-[9px] text-muted-foreground/80">{f.hint}</div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="space-y-4 pt-4 border-t border-border/40">
                            <div>
                              <Label>Post Date</Label>
                              <div className="mt-1.5">
                                <DatePicker value={scheduledAt} onChange={setScheduledAt} />
                              </div>
                            </div>
                            <div>
                              <Label>Post Time</Label>
                              <div className="mt-1.5">
                                <TimePicker value={scheduledAt} onChange={setScheduledAt} />
                              </div>
                            </div>
                          </div>
                        </div>
                      </Panel>
                    </div>

                    {/* Right: drafting workspace */}
                    <div className="md:col-span-7 space-y-6">
                      <Panel
                        title="Content Planner"
                        subtitle="Only caption, format, and timing feed the model — the visual concept guides AI suggestions."
                      >
                        <div className="space-y-5">
                          <div>
                            <Label>Visual Concept (optional)</Label>
                            <div className="rounded-xl border border-border bg-surface transition-all focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 overflow-hidden shadow-inner">
                              <textarea
                                value={visualConcept}
                                onChange={(e) => setVisualConcept(e.target.value)}
                                rows={3}
                                className="w-full resize-none bg-transparent p-4 text-xs font-mono leading-relaxed outline-none placeholder:text-muted-foreground/45 text-foreground/90"
                                placeholder={`Describe what will appear in the post, e.g.\n• Carousel (5 slides) about "5 Marketing Mistakes"\n• Last slide contains a follow CTA`}
                              />
                            </div>
                          </div>

                          <div className="pt-4 border-t border-border/40">
                            <div className="flex items-center justify-between mb-2">
                              <Label>Caption Text</Label>
                              <CaptionMeter count={stats.charCount} />
                            </div>

                            <div className="rounded-xl border border-border bg-surface transition-all focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 overflow-hidden shadow-inner">
                              <textarea
                                value={caption}
                                onChange={(e) => setCaption(e.target.value)}
                                rows={6}
                                maxLength={CAPTION_MAX + 100}
                                className="w-full resize-none bg-transparent p-4 text-xs font-mono leading-relaxed outline-none placeholder:text-muted-foreground/40 text-foreground/90"
                                placeholder="Write your caption…"
                              />
                              <div className="border-t border-border px-4 py-3 bg-surface-2/40">
                                <CaptionSignals stats={stats} />
                              </div>
                            </div>

                            <CaptionLimitWarning count={stats.charCount} />

                            <div className="mt-4 grid gap-3 grid-cols-3">
                              <MetricBox
                                label="Length"
                                value={`${stats.charCount}`}
                                hint={stats.charCount >= 180 && stats.charCount <= 320 ? "Optimal" : "Baseline: 180–320"}
                                status={stats.charCount >= 180 && stats.charCount <= 320 ? "success" : "warning"}
                              />
                              <MetricBox
                                label="Hashtags"
                                value={stats.hashtags.length.toString()}
                                hint={stats.hashtags.length >= 3 && stats.hashtags.length <= 8 ? "Optimal" : "Baseline: 3–8"}
                                status={stats.hashtags.length >= 3 && stats.hashtags.length <= 8 ? "success" : "warning"}
                              />
                              <MetricBox
                                label="CTA"
                                value={stats.hasCTA ? "Yes" : "No"}
                                hint={stats.hasCTA ? `"${stats.ctaTerms[0]}"` : "Add a prompt"}
                                status={stats.hasCTA ? "success" : "warning"}
                              />
                            </div>
                          </div>

                          {/* AI refinement trigger */}
                          <div className="flex items-center justify-end pt-3 border-t border-border/40 gap-4">
                            <button
                              type="button"
                              onClick={enrichWithAI}
                              disabled={aiState === "loading" || isTyping || caption.trim() === ""}
                              title={caption.trim() === "" ? "Write a caption first — the AI rewrites your draft, it doesn't start from scratch" : undefined}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground transition-all hover:bg-primary/95 disabled:opacity-50 active:scale-[0.98] shadow-sm shrink-0"
                            >
                              {aiState === "loading" ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Refining…
                                </>
                              ) : (
                                <>
                                  <PenTool className="h-3.5 w-3.5" />
                                  AI Refine Caption
                                </>
                              )}
                            </button>
                          </div>

                          <AnimatePresence mode="wait">
                            {aiState === "enriched" && (
                              <motion.div
                                key="enriched"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="rounded-2xl border border-border bg-surface-2/60 p-5 space-y-4 shadow-sm relative overflow-hidden text-left"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <FileText className="h-3.5 w-3.5 text-primary" />
                                    <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
                                      AI Suggested Caption
                                    </span>
                                  </div>
                                  {!isTyping && typewriterText && (
                                    <button
                                      type="button"
                                      onClick={applyAiTextToCaption}
                                      className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-2.5 py-1 text-[10px] font-bold text-primary transition-all hover:bg-primary hover:text-white"
                                    >
                                      Replace Draft Caption
                                    </button>
                                  )}
                                </div>
                                <div className="p-4 rounded-xl border border-border bg-surface text-xs font-medium leading-relaxed text-foreground/90 min-h-[60px] shadow-inner whitespace-pre-wrap">
                                  {typewriterText}
                                  {isTyping && (
                                    <span className="inline-block w-[2px] h-3.5 bg-primary animate-pulse ml-1 align-middle" />
                                  )}
                                </div>
                              </motion.div>
                            )}

                            {aiState === "unavailable" && (
                              <motion.div
                                key="unavailable"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="rounded-xl border border-warning/30 bg-warning/[0.02] p-4 flex items-start gap-3 text-left"
                              >
                                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                                <p className="text-[11px] text-muted-foreground leading-relaxed">{aiMessage}</p>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </Panel>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="text-xs text-muted-foreground text-left">
                      {!isFormValid ? (
                        <span className="text-warning font-semibold">
                          Select a brand and write a caption to run the analysis.
                        </span>
                      ) : isPredictionStale ? (
                        <span className="text-warning font-semibold">
                          Inputs changed — re-analyze to refresh the result.
                        </span>
                      ) : null}
                    </div>
                    <button
                      onClick={handlePredict}
                      disabled={submitting || tooLong || !isFormValid}
                      className="w-full md:w-auto px-8 flex h-12 items-center justify-center gap-2.5 rounded-xl bg-primary text-xs font-bold text-primary-foreground shadow-[var(--shadow-glow-purple)] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                    >
                      <Activity className="h-4.5 w-4.5" />
                      Analyze Post
                    </button>
                  </div>
                </motion.div>
              )}

              {/* STEP 2: RESULT */}
              {activeStep === 2 && prediction && (
                <motion.div
                  key="step-result"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                  className="space-y-6"
                >
                  {isPredictionStale && <StaleBanner />}

                  {/* Model input summary strip */}
                  <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl border border-border bg-surface/50 backdrop-blur text-xs shadow-inner">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
                      Model input:
                    </span>
                    <div className="flex items-center gap-1.5 text-foreground font-bold">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      <span>{account?.name || "—"}</span>
                    </div>
                    <span className="text-muted-foreground/30">•</span>
                    <div className="flex items-center gap-1.5 text-foreground font-semibold">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{format(scheduledAt, "MMM d, yyyy")}</span>
                    </div>
                    <span className="text-muted-foreground/30">•</span>
                    <div className="flex items-center gap-1.5 text-foreground font-semibold">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{format(scheduledAt, "HH:mm")}</span>
                    </div>
                    <span className="text-muted-foreground/30">•</span>
                    <span className="rounded-lg border border-border bg-surface px-2.5 py-1 font-mono font-bold text-muted-foreground text-[10px]">
                      {contentFormat}
                    </span>
                  </div>

                  <div className="grid gap-6 md:grid-cols-12">
                    <div className="md:col-span-5 flex flex-col items-center justify-center p-6 border border-border bg-surface/60 rounded-2xl backdrop-blur relative shadow-[var(--shadow-soft)]">
                      <ConfidenceMeter value={prediction.confidence} tier={prediction.tier} label="Model Confidence" />
                    </div>

                    <div className="md:col-span-7 flex flex-col justify-center p-6 border border-border bg-surface/60 rounded-2xl backdrop-blur relative shadow-[var(--shadow-soft)] space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <TierBadge tier={prediction.tier} />
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-1 text-[9px] font-bold text-primary uppercase tracking-wide">
                          <Cpu className="h-2.5 w-2.5" />
                          {prediction.isPersonalModel ? "Personal model" : "Niche model"}
                        </span>
                        {prediction.modelAccuracy !== null && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-border px-2.5 py-1 text-[9px] font-bold text-muted-foreground uppercase tracking-wide"
                            title="How often this model's tier predictions matched reality when validated on the newest 20% of this data's posts"
                          >
                            <Check className="h-2.5 w-2.5" />
                            {prediction.modelAccuracy}% validated accuracy
                          </span>
                        )}
                      </div>
                      <h4 className="text-2xl font-black font-display leading-tight text-foreground">
                        Predicted tier:{" "}
                        <span className={tierColorClass(prediction.tier)}>
                          {prediction.tier.toUpperCase()}
                        </span>
                      </h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        This draft is predicted to earn <strong className="text-foreground">
                        {prediction.tier.toLowerCase()}-tier engagement</strong> (likes + comments relative
                        to this brand&apos;s own posting history — not reach or sales). The model is{" "}
                        {prediction.confidence}% confident. See{" "}
                        <strong className="text-foreground">Diagnose</strong> for why, and{" "}
                        <strong className="text-foreground">Optimize</strong> for what to change.
                      </p>
                      <div className="space-y-1 pt-1 border-t border-border/40">
                        {prediction.savedId && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                            <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                            Saved to History — revisit or reschedule it there anytime.
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground/80 flex items-center gap-1.5">
                          <Clock className="h-3 w-3 shrink-0" />
                          Models retrain weekly on fresh data — re-run predictions older than a week
                          (or any edited draft) before publishing.
                        </p>
                      </div>
                    </div>
                  </div>

                  <Panel
                    title="Class Probabilities"
                    subtitle="Model output distribution across the three tiers (sums to 100%)."
                  >
                    <div className="grid gap-3 mt-2 sm:grid-cols-3">
                      {prediction.probs.map((c) => {
                        const pct = Math.round(c.prob * 100);
                        const active = c.tier === prediction.tier;
                        const colorClass =
                          c.tier === "High"
                            ? "bg-emerald-500"
                            : c.tier === "Average"
                            ? "bg-amber-500"
                            : "bg-rose-500";
                        return (
                          <div
                            key={c.tier}
                            className={cn(
                              "rounded-xl border p-4 transition-all flex flex-col gap-3 backdrop-blur",
                              active
                                ? "bg-surface-2 border-primary/20 shadow-[var(--shadow-soft)]"
                                : "bg-surface-2/30 border-border/50 opacity-60"
                            )}
                          >
                            <div className="flex items-center justify-between text-xs font-mono">
                              <span className="font-bold text-foreground">{c.tier}</span>
                              <span className="font-extrabold text-foreground">{pct}%</span>
                            </div>
                            <div className="h-2 w-full bg-surface-3 rounded-full overflow-hidden border border-border/30">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${colorClass}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Panel>

                  <StepNav
                    onBack={() => setActiveStep(1)}
                    backLabel="Back to Edit"
                    onNext={() => setActiveStep(3)}
                    nextLabel="Explore Diagnostics"
                  />
                </motion.div>
              )}

              {/* STEP 3: DIAGNOSE */}
              {activeStep === 3 && prediction && (
                <motion.div
                  key="step-diagnose"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                  className="space-y-6"
                >
                  {isPredictionStale && <StaleBanner />}

                  <div className="grid gap-6 md:grid-cols-2">
                    <WhyThisScore
                      reasons={whyReasons}
                      context="Input signals vs niche baselines, weighted by the model's feature importance."
                    />
                    <ModelMaturity samples={account?.samples ?? 0} />
                  </div>

                  <Panel
                    title="Model Feature Importance"
                    subtitle="Mean Decrease in Impurity (MDI) — how much each input drives this model's decisions overall."
                  >
                    <div className="h-56 w-full mt-2">
                      {mdiChartData.length === 0 ? (
                        <div className="h-full w-full flex flex-col items-center justify-center border border-dashed border-border rounded-xl bg-surface-2/40 p-5 text-center">
                          <Activity className="h-7 w-7 text-muted-foreground/50 mb-2" />
                          <p className="text-xs font-semibold text-foreground">No model weights loaded</p>
                          <p className="text-[10px] text-muted-foreground mt-1 max-w-[280px]">
                            Run an analysis to load the active model&apos;s feature importances.
                          </p>
                        </div>
                      ) : (
                        <FeatureAttributionChart data={mdiChartData} />
                      )}
                    </div>

                    <div className="mt-4 text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5 p-3 rounded-lg bg-surface-2 border border-border/40">
                      <HelpCircle className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
                      <span>
                        MDI measures each feature&apos;s global influence magnitude in the trained model — it
                        does not state direction for this specific prediction.
                      </span>
                    </div>
                  </Panel>

                  <StepNav
                    onBack={() => setActiveStep(2)}
                    backLabel="Back to Result"
                    onNext={() => setActiveStep(4)}
                    nextLabel="Get Recommendations"
                  />
                </motion.div>
              )}

              {/* STEP 4: OPTIMIZE */}
              {activeStep === 4 && prediction && (
                <motion.div
                  key="step-suggest"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                  className="space-y-6"
                >
                  {isPredictionStale && <StaleBanner />}

                  <Panel
                    title="Recommendations"
                    subtitle="Rule-based adjustments from your draft vs this niche's baselines (not AI-generated). Impact levels are priorities, not guarantees — apply changes and re-analyze to see the real effect on the score."
                    actions={
                      treRecs && treRecs.some((r) => AUTO_APPLICABLE.has(r.parameter)) ? (
                        <button
                          type="button"
                          onClick={() =>
                            setAppliedRecs(
                              Object.fromEntries(
                                treRecs
                                  .filter((r) => AUTO_APPLICABLE.has(r.parameter))
                                  .map((r) => [r.parameter, true])
                              )
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-emerald-500 active:scale-[0.98]"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Select All
                        </button>
                      ) : undefined
                    }
                  >
                    {treError ? (
                      <div className="rounded-xl border border-warning/30 bg-warning/[0.03] p-4 flex items-start gap-3">
                        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground">{treError}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            fetchTreRecommendations({
                              caption: predictionSnapshot?.caption ?? caption,
                              format: predictionSnapshot?.contentFormat ?? contentFormat,
                              post_hour: new Date(
                                predictionSnapshot?.scheduledAt ?? scheduledAt.getTime()
                              ).getHours(),
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 shrink-0"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry
                        </button>
                      </div>
                    ) : treRecs === null ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface-2" />
                        ))}
                      </div>
                    ) : treRecs.length === 0 ? (
                      <div className="rounded-xl border border-accent-lime/30 bg-accent-lime/[0.04] p-5 flex items-center gap-3">
                        <Check className="h-4.5 w-4.5 text-accent-lime-strong shrink-0" />
                        <p className="text-xs font-semibold text-foreground">
                          All measurable parameters already sit within this niche&apos;s baselines.
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-4">
                        {treRecs.map((rec) => {
                          const canApply = AUTO_APPLICABLE.has(rec.parameter);
                          const isApplied = appliedRecs[rec.parameter] || false;
                          return (
                            <article
                              key={rec.parameter}
                              className={cn(
                                "rounded-2xl border bg-surface p-5 space-y-2.5 relative transition-all duration-300",
                                isApplied
                                  ? "border-emerald-500/30 bg-emerald-500/[0.01]"
                                  : "border-border hover:border-border-strong"
                              )}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-2">
                                    <span className="rounded-lg bg-surface-3 border border-border/60 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/80 font-bold">
                                      {FEATURE_LABELS[rec.parameter] || rec.parameter}
                                    </span>
                                    <span
                                      className={cn(
                                        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                                        rec.impact === "High"
                                          ? "bg-primary/10 text-primary"
                                          : rec.impact === "Medium"
                                          ? "bg-warning/10 text-warning"
                                          : "bg-surface-3 text-muted-foreground"
                                      )}
                                    >
                                      {rec.impact} impact
                                    </span>
                                  </div>
                                  <p className="text-xs text-foreground leading-relaxed font-medium">
                                    {rec.recommendation}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    Current value: <span className="font-mono font-bold">{String(rec.current)}</span>
                                  </p>
                                </div>

                                {canApply ? (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleRec(rec.parameter)}
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
                                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-muted-foreground/70 border border-border rounded-full px-2 py-1">
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

                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setActiveStep(3)}
                      className="flex-1 flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-xs font-semibold transition-all hover:bg-surface-2 active:scale-[0.98]"
                    >
                      Back to Diagnostics
                    </button>
                    <button
                      type="button"
                      onClick={applyStagedRecommendations}
                      disabled={!anyRecsApplied}
                      className="flex-1 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-primary-foreground shadow-[var(--shadow-glow-purple)] transition-all hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50"
                    >
                      Apply Changes &amp; Re-Analyze
                    </button>
                  </div>
                </motion.div>
              )}
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StaleBanner() {
  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/[0.03] p-4 flex items-center gap-3 shadow-sm">
      <AlertTriangle className="h-4.5 w-4.5 text-warning shrink-0" />
      <div className="text-xs font-semibold text-warning">
        Inputs changed since this prediction — re-analyze to refresh.
      </div>
    </div>
  );
}

function StepNav({
  onBack,
  backLabel,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  backLabel: string;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="flex gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex-1 flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-xs font-semibold transition-all hover:bg-surface-2 active:scale-[0.98]"
      >
        {backLabel}
      </button>
      <button
        type="button"
        onClick={onNext}
        className="flex-1 flex h-11 items-center justify-center gap-2.5 rounded-xl bg-primary text-xs font-bold text-primary-foreground shadow-[var(--shadow-glow-purple)] transition-all hover:scale-[1.01] active:scale-[0.98]"
      >
        {nextLabel}
        <ArrowRight className="h-4.5 w-4.5" />
      </button>
    </div>
  );
}

function Panel({
  id,
  title,
  subtitle,
  actions,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4 border-b border-border/60 pb-3">
        <div>
          <h3 className="font-display text-xs font-bold tracking-tight text-foreground uppercase">{title}</h3>
          {subtitle && <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80 mb-1.5">
      {children}
    </div>
  );
}

function MetricBox({
  label,
  value,
  hint,
  status,
}: {
  label: string;
  value: string;
  hint: string;
  status?: "success" | "warning" | "error";
}) {
  const statusColor =
    status === "success"
      ? "text-success bg-success/5 border-success/20"
      : "text-warning bg-warning/5 border-warning/20";

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3.5 text-center flex flex-col justify-between">
      <div className="font-mono text-[8.5px] uppercase tracking-wider text-muted-foreground/85">
        {label}
      </div>
      <div className="mt-2 font-display text-lg font-black tabular-nums text-foreground tracking-tight">{value}</div>
      <div className={cn("mt-2 rounded-lg border px-2 py-0.5 text-[8.5px] font-bold leading-normal truncate", statusColor)}>
        {hint}
      </div>
    </div>
  );
}
