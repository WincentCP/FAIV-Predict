"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { DatePicker, TimePicker } from "@/components/DateTimePicker";
import { ModelMaturity } from "@/components/ModelMaturity";
import {
  analyzeCaption,
  CaptionMeter,
  CaptionSignals,
  CaptionLimitWarning,
  CAPTION_MAX,
} from "@/components/CaptionIntel";
import { type ContentFormat, type Brand } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Panel, Label } from "./Panel";
import { AiToolsAccordion } from "./AiToolsAccordion";
import { BrandPatterns } from "./BrandPatterns";
import { type CreativeReviewSnapshot } from "./ConceptAssistant";

const FORMATS: ContentFormat[] = ["Reels", "Carousel", "Single Image"];

export function ComposeView(props: {
  brandsList: Brand[];
  brandsError: string | null;
  accountId: string | null;
  setAccountId: (id: string | null) => void;
  account: Brand | null;
  contentFormat: ContentFormat;
  setContentFormat: (f: ContentFormat) => void;
  scheduledAt: Date;
  setScheduledAt: (d: Date) => void;
  hasPostTime: boolean;
  setHasPostTime: (known: boolean) => void;
  caption: string;
  setCaption: (c: string) => void;
  visualConcept: string;
  setVisualConcept: (v: string) => void;
  predictError: string | null;
  contentPlanId: string | null;
  planLoadError: string | null;
  optimizationsApplied: boolean;
  isFormValid: boolean;
  isPredictionStale: boolean;
  submitting: boolean;
  tooLong: boolean;
  onAnalyze: () => void;
  creativeReview: CreativeReviewSnapshot | null;
  onCreativeReview: (review: CreativeReviewSnapshot) => void;
}) {
  const {
    brandsList,
    brandsError,
    accountId,
    setAccountId,
    account,
    contentFormat,
    setContentFormat,
    scheduledAt,
    setScheduledAt,
    hasPostTime,
    setHasPostTime,
    caption,
    setCaption,
    visualConcept,
    setVisualConcept,
    predictError,
    contentPlanId,
    planLoadError,
    optimizationsApplied,
    isFormValid,
    isPredictionStale,
    submitting,
    tooLong,
    onAnalyze,
    creativeReview,
    onCreativeReview,
  } = props;
  const stats = analyzeCaption(caption);

  const readinessMessage = account?.active_model_scope === "none"
    ? "Prediction is not ready for this brand yet."
    : !caption.trim()
      ? "Add a caption to estimate performance."
      : tooLong
        ? "Shorten the caption to Instagram’s 2,200-character limit."
        : !hasPostTime
          ? "Ready. Add a time later for a more specific estimate."
          : "Ready to estimate performance.";

  return (
    <motion.div
      key="view-compose"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="mx-auto max-w-[1320px] space-y-5"
    >
      {contentPlanId && (
        <div className="flex flex-col gap-2 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4 text-sm leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span><strong className="text-foreground">Loaded from Plan.</strong> Predicting again keeps the earlier version.</span>
          <Link href="/calendar" className="shrink-0 font-semibold text-primary underline-offset-4 hover:underline">Back to Plan</Link>
        </div>
      )}

      {planLoadError && (
        <div role="alert" className="rounded-2xl border border-warning/30 bg-warning/[0.04] p-4 text-sm font-medium text-warning">
          The plan could not be loaded: {planLoadError}
        </div>
      )}

      {predictError && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/[0.04] p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-destructive">Prediction could not be completed</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{predictError}</p>
          </div>
          <button type="button" onClick={onAnalyze} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {optimizationsApplied && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
          <p className="text-sm font-medium text-foreground">Posting time updated. Predict again to refresh the result.</p>
        </div>
      )}

      <Panel title="Prediction setup" subtitle="Choose the brand and publishing context.">
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-12">
          <div className="xl:col-span-4">
            <Label htmlFor="predict-brand">Active brand</Label>
            <select
              id="predict-brand"
              value={accountId ?? ""}
              onChange={(event) => setAccountId(event.target.value || null)}
              disabled={brandsList.length === 0 || submitting}
              className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-base font-semibold text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60 sm:text-sm"
            >
              {brandsList.length === 0 ? (
                <option value="">No brand accounts available</option>
              ) : (
                brandsList.map((brand) => <option key={brand.id} value={brand.id}>{brand.name} · {brand.niche}</option>)
              )}
            </select>

            {brandsList.length === 0 ? (
              <p className="mt-3 text-sm font-medium leading-relaxed text-destructive">
                {brandsError || "No brand account is available. Add one from Brands."}
              </p>
            ) : account ? (
              <div className="mt-3 space-y-1.5">
                <ModelMaturity samples={account.samples ?? 0} activeScope={account.active_model_scope} variant="compact" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {account.active_model_scope === "personal"
                    ? "Uses this brand’s model."
                    : account.active_model_scope === "cohort"
                      ? `Uses the ${account.niche} niche model while personal history grows.`
                      : "Sync and train a model before predicting."}
                </p>
              </div>
            ) : null}
          </div>

          <div className="xl:col-span-3">
            <Label id="predict-format-label">Format</Label>
            <div role="group" aria-labelledby="predict-format-label" className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface-2/60 p-1">
              {FORMATS.map((format) => {
                const active = contentFormat === format;
                return (
                  <button
                    key={format}
                    type="button"
                    onClick={() => setContentFormat(format)}
                    aria-pressed={active}
                    disabled={submitting}
                    className={cn(
                      "min-h-11 rounded-lg px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-surface hover:text-foreground"
                    )}
                  >
                    <span className="truncate">{format}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="xl:col-span-2">
            <Label htmlFor="predict-date">Publish date</Label>
            <DatePicker id="predict-date" aria-label="Target publish date" value={scheduledAt} onChange={setScheduledAt} />
          </div>

          <div className="xl:col-span-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="predict-time">Publish time <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <button
                type="button"
                onClick={() => setHasPostTime(!hasPostTime)}
                disabled={submitting}
                className="mb-2 min-h-8 rounded-md px-1 text-xs font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-50"
              >
                {hasPostTime ? "Remove" : "Add time"}
              </button>
            </div>
            {hasPostTime ? (
              <TimePicker id="predict-time" aria-label="Target posting hour in WIB" value={scheduledAt} onChange={setScheduledAt} />
            ) : (
              <div id="predict-time" role="status" className="flex min-h-11 items-center rounded-lg border border-dashed border-border bg-surface-2/50 px-3 text-sm text-muted-foreground">
                Not set · provisional result
              </div>
            )}
          </div>
        </div>
      </Panel>

      <AiToolsAccordion
        visualConcept={visualConcept}
        setVisualConcept={setVisualConcept}
        caption={caption}
        brandId={accountId}
        format={contentFormat}
        onReplaceCaption={setCaption}
        reviewSnapshot={creativeReview}
        onReviewComplete={onCreativeReview}
      />

      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
        <Panel title="Caption" subtitle="Write the caption you plan to publish." className="h-full">
            <div className="mb-2 flex items-end justify-between gap-3">
              <Label htmlFor="predict-caption">Instagram caption</Label>
              <CaptionMeter count={stats.charCount} />
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-surface transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
              <textarea
                id="predict-caption"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                rows={14}
                maxLength={CAPTION_MAX + 100}
                disabled={submitting}
                className="min-h-[320px] w-full resize-y bg-transparent p-4 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-70 sm:text-sm"
                placeholder="Write the caption you plan to publish…"
              />
              <div className="border-t border-border bg-surface-2/50 px-4 py-3">
                <CaptionSignals stats={stats} />
              </div>
            </div>
            <CaptionLimitWarning count={stats.charCount} />
        </Panel>

        <BrandPatterns brandId={accountId} brandName={account?.name} activeModelScope={account?.active_model_scope} compact />
      </div>

      <section aria-label="Run prediction" className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-soft)] sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <p className={cn("text-sm leading-relaxed", isFormValid && !tooLong ? "text-muted-foreground" : "font-medium text-warning")}>{readinessMessage}</p>
          {submitting && <p role="status" aria-live="polite" className="mt-1 text-xs font-medium text-primary">Comparing this draft with past posts…</p>}
          {isPredictionStale && <p className="mt-1 text-xs font-medium text-warning">The draft changed. Update the estimate before using it.</p>}
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full bg-primary/[0.08] px-2.5 py-1 font-medium text-primary">Uses caption, format, timing, and brand history</span>
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-muted-foreground">Does not score finished visuals, audio, or live trends</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={submitting || tooLong || !isFormValid}
          aria-busy={submitting}
          className="flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:min-w-56"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? "Estimating…" : "Get performance estimate"}
        </button>
      </section>
    </motion.div>
  );
}
