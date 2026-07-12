"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Sparkles,
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

const FORMATS: { id: ContentFormat; icon: typeof Film }[] = [
  { id: "Reels", icon: Film },
  { id: "Carousel", icon: LayoutGrid },
  { id: "Single Image", icon: ImageIcon },
];

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
  } = props;
  const stats = analyzeCaption(caption);

  const readinessMessage = account?.active_model_scope === "none"
    ? "A trained model is not available for this brand yet."
    : !caption.trim()
      ? "Write a caption to make the draft prediction-ready."
      : tooLong
        ? "Shorten the caption to Instagram’s 2,200-character limit."
        : !hasPostTime
          ? "Ready for a provisional prediction. Add an hour later for a time-specific result."
          : "Ready to predict from the selected brand model and draft inputs.";

  return (
    <motion.div
      key="view-compose"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="mx-auto max-w-[1380px] space-y-5"
    >
      {contentPlanId && (
        <div className="flex flex-col gap-2 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4 text-sm leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span><strong className="text-foreground">Loaded from Content Plan.</strong> A new prediction preserves the earlier result as version history.</span>
          <Link href="/calendar" className="shrink-0 font-semibold text-foreground underline-offset-4 hover:underline">Back to Content Plan</Link>
        </div>
      )}

      {planLoadError && (
        <div role="alert" className="rounded-2xl border border-warning/30 bg-warning/[0.04] p-4 text-sm font-medium text-warning">
          Content Plan could not be loaded: {planLoadError}
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
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm font-medium text-foreground">The selected posting-hour change is now in the draft. Predict again to create a new result.</p>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Understand: first in the DOM for mobile, right rail on desktop. */}
        <aside className="order-1 space-y-5 xl:col-start-2 xl:row-start-1" aria-label="Brand decision context">
          <Panel title="Understand the brand" subtitle="Choose the account whose verified history should anchor this decision.">
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
              <div className="mt-3 space-y-2">
                <ModelMaturity samples={account.samples ?? 0} activeScope={account.active_model_scope} variant="compact" />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {account.active_model_scope === "personal"
                    ? "This prediction uses a separately trained model from this brand’s eligible post history."
                    : account.active_model_scope === "cohort"
                      ? `This prediction uses the verified ${account.niche} cohort model while the brand builds personal evidence.`
                      : "Planning remains available, but prediction requires a successful sync and retraining run."}
                </p>
              </div>
            ) : null}
          </Panel>

          <BrandPatterns brandId={accountId} brandName={account?.name} activeModelScope={account?.active_model_scope} compact />
        </aside>

        {/* Plan: the creative draft stays visually dominant. */}
        <main className="order-2 space-y-5 xl:col-start-1 xl:row-start-1 xl:row-span-2">
          {submitting && (
            <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/[0.04] p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Loader2 className="h-4 w-4 animate-spin" /></span>
              <div>
                <p className="text-sm font-semibold text-foreground">Predicting performance</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Scoring the draft with the saved model and testing supported one-input alternatives. Your draft remains unchanged.</p>
              </div>
            </div>
          )}

          <Panel
            title="Plan the draft"
            subtitle="The caption is the central creative input. Live signals below mirror the exact text features used by the model."
          >
            <div className="mb-2 flex items-end justify-between gap-3">
              <Label htmlFor="predict-caption">Instagram caption</Label>
              <CaptionMeter count={stats.charCount} />
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-surface transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
              <textarea
                id="predict-caption"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                rows={12}
                maxLength={CAPTION_MAX + 100}
                disabled={submitting}
                className="min-h-[280px] w-full resize-y bg-transparent p-4 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-70 sm:text-sm"
                placeholder="Write the caption you plan to publish…"
              />
              <div className="border-t border-border bg-surface-2/50 px-4 py-3">
                <CaptionSignals stats={stats} />
              </div>
            </div>
            <CaptionLimitWarning count={stats.charCount} />
          </Panel>

          <AiToolsAccordion
            visualConcept={visualConcept}
            setVisualConcept={setVisualConcept}
            caption={caption}
            brandId={accountId}
            format={contentFormat}
            onReplaceCaption={setCaption}
          />
        </main>

        {/* Predict: variables and action follow the creative plan on mobile. */}
        <section className="order-3 space-y-5 xl:col-start-2 xl:row-start-2" aria-label="Prediction setup">
          <Panel title="Prediction inputs" subtitle="Only these structured choices and the caption affect the model score.">
            <div className="space-y-5">
              <div>
                <Label id="predict-format-label">Content format</Label>
                <div role="group" aria-labelledby="predict-format-label" className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface-2/60 p-1">
                  {FORMATS.map((format) => {
                    const active = contentFormat === format.id;
                    return (
                      <button
                        key={format.id}
                        type="button"
                        onClick={() => setContentFormat(format.id)}
                        aria-pressed={active}
                        disabled={submitting}
                        className={cn(
                          "flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-surface hover:text-foreground"
                        )}
                      >
                        <format.icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{format.id}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label htmlFor="predict-date">Target publish date</Label>
                <DatePicker id="predict-date" aria-label="Target publish date" value={scheduledAt} onChange={setScheduledAt} />
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">The model uses weekday versus weekend; the exact date is kept for planning and version history.</p>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="predict-time">Target hour <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <button
                    type="button"
                    onClick={() => setHasPostTime(!hasPostTime)}
                    disabled={submitting}
                    className="min-h-10 rounded-lg px-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline disabled:opacity-50"
                  >
                    {hasPostTime ? "Remove hour" : "Add hour"}
                  </button>
                </div>
                {hasPostTime ? (
                  <TimePicker id="predict-time" aria-label="Target posting hour in WIB" value={scheduledAt} onChange={setScheduledAt} />
                ) : (
                  <div id="predict-time" role="status" className="flex min-h-11 items-center rounded-lg border border-dashed border-border bg-surface-2/50 px-3 text-sm text-muted-foreground">
                    Not set · result will be provisional
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <div className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-elevated)] xl:sticky xl:bottom-4">
            <p className={cn("text-sm leading-relaxed", isFormValid && !tooLong ? "text-muted-foreground" : "font-medium text-warning")}>{readinessMessage}</p>
            {isPredictionStale && <p className="mt-2 text-sm font-medium text-warning">Draft inputs changed after the previous prediction. Running again creates a new version.</p>}
            <button
              type="button"
              onClick={onAnalyze}
              disabled={submitting || tooLong || !isFormValid}
              aria-busy={submitting}
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-foreground px-6 text-sm font-semibold text-background shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
              {submitting ? "Predicting…" : "Predict performance"}
            </button>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">The result is decision support, not a guarantee of reach, sales, or engagement.</p>
          </div>
        </section>
      </div>
    </motion.div>
  );
}
