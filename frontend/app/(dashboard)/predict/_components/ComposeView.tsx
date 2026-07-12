"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Film, LayoutGrid, Image as ImageIcon, Activity, AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
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
    brandsList, brandsError, accountId, setAccountId, account,
    contentFormat, setContentFormat, scheduledAt, setScheduledAt,
    hasPostTime, setHasPostTime,
    caption, setCaption, visualConcept, setVisualConcept,
    predictError, contentPlanId, planLoadError, optimizationsApplied, isFormValid, isPredictionStale,
    submitting, tooLong, onAnalyze,
  } = props;
  const stats = analyzeCaption(caption);

  return (
    <motion.div
      key="view-compose"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
      className="mx-auto max-w-3xl space-y-5"
    >
      {contentPlanId && (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4 text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Loaded from Content Plan.</strong>{" "}
          Re-evaluation keeps the earlier prediction as audit evidence and updates this plan to the new saved result.
          <Link href="/calendar" className="ml-2 font-bold text-primary hover:underline">Back to Content Plan</Link>
        </div>
      )}

      {planLoadError && (
        <div role="alert" className="rounded-xl border border-warning/30 bg-warning/[0.04] p-4 text-xs font-semibold text-warning">
          Content Plan could not be loaded: {planLoadError}
        </div>
      )}

      {predictError && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-xs font-bold text-destructive">Prediction failed</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{predictError}</p>
          </div>
          <button
            type="button"
            onClick={onAnalyze}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 shrink-0"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {optimizationsApplied && (
        <div role="status" className="rounded-xl border border-primary/20 bg-primary/[0.02] p-4 flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <div className="text-xs text-foreground font-semibold">
            Optimizations applied. Run <span className="text-primary">Analyze Post</span> to re-score.
          </div>
        </div>
      )}

      {/* Config strip: everything the model needs besides the caption */}
      <Panel title="Post Setup">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="predict-brand">Brand</Label>
            <select
              id="predict-brand"
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
            {brandsList.length === 0 ? (
              <p className="mt-2 text-xs text-destructive font-semibold">
                {brandsError || "No brand accounts yet. Register one under Niche Management."}
              </p>
            ) : (
              account && (
                <div className="mt-2">
                  <ModelMaturity
                    samples={account.samples ?? 0}
                    activeScope={account.active_model_scope}
                    variant="compact"
                  />
                  {account.active_model_scope === "cohort" && (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Prediction uses the verified <strong className="text-foreground">{account.niche} cohort model</strong>. Brand patterns and the Creative Brief are planning context; they are not blended into that score.
                    </p>
                  )}
                  {account.active_model_scope === "none" && (
                    <p className="mt-2 text-xs font-semibold leading-relaxed text-warning">
                      No eligible personal or cohort model is active. You can continue planning, but Analyze Post stays disabled until sync/retraining produces a usable model.
                    </p>
                  )}
                </div>
              )
            )}
          </div>

          <div>
            <Label id="predict-format-label">Format</Label>
            <div role="group" aria-labelledby="predict-format-label" className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
              {FORMATS.map((f) => {
                const active = contentFormat === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setContentFormat(f.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-bold transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <f.icon className="h-3 w-3" />
                    {f.id}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label htmlFor="predict-date">Post Date</Label>
            <DatePicker id="predict-date" aria-label="Scheduled post date" value={scheduledAt} onChange={setScheduledAt} />
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              The exact date is kept for planning; the model uses only whether it falls on a weekday or weekend.
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="predict-time">Post Time <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <button
                type="button"
                onClick={() => setHasPostTime(!hasPostTime)}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {hasPostTime ? "Set later" : "Add time"}
              </button>
            </div>
            {hasPostTime ? (
              <TimePicker id="predict-time" aria-label="Scheduled posting hour in WIB" value={scheduledAt} onChange={setScheduledAt} />
            ) : (
              <div
                id="predict-time"
                role="status"
                className="flex h-10 items-center rounded-lg border border-dashed border-border bg-surface-2/50 px-3 text-xs font-semibold text-muted-foreground"
              >
                Not set. The result will be provisional.
              </div>
            )}
          </div>
        </div>
      </Panel>

      <BrandPatterns
        brandId={accountId}
        brandName={account?.name}
        activeModelScope={account?.active_model_scope}
      />

      {/* Caption: the hero input */}
      <Panel title="Caption">
        <div className="mb-2 flex items-center justify-between">
          <Label htmlFor="predict-caption">Caption text</Label>
          <CaptionMeter count={stats.charCount} />
        </div>
        <div className="rounded-xl border border-border bg-surface transition-all focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 overflow-hidden shadow-inner">
          <textarea
            id="predict-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={8}
            maxLength={CAPTION_MAX + 100}
            className="w-full resize-none bg-transparent p-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/40 text-foreground/90"
            placeholder="Write your caption…"
          />
          <div className="border-t border-border px-4 py-3 bg-surface-2/40">
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

      {/* Sticky action bar */}
      <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-2xl border border-border bg-surface/90 p-4 shadow-[var(--shadow-elevated)] backdrop-blur-xl md:flex-row md:items-center md:justify-between">
        <div className="text-xs text-muted-foreground">
          {account?.active_model_scope === "none" ? (
            <span className="text-warning font-semibold">
              Planning-only mode: no active model is available for this brand.
            </span>
          ) : !isFormValid ? (
            <span className="text-warning font-semibold">
              Select a brand and write a caption to run the analysis.
            </span>
          ) : isPredictionStale ? (
            <span className="text-warning font-semibold">
              Inputs changed — re-analyze to refresh the result.
            </span>
          ) : !hasPostTime ? (
            <span>
              Time is optional. The provisional score combines posting hours observed in training, weighted by how often each hour occurred.
            </span>
          ) : (
            <span>Caption, format, weekday/weekend, and the selected hourly time bucket feed the model.</span>
          )}
        </div>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={submitting || tooLong || !isFormValid}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-primary px-8 text-xs font-bold text-primary-foreground transition-colors duration-200 hover:bg-primary/92 disabled:opacity-50 md:w-auto"
        >
          <Activity className="h-4.5 w-4.5" />
          Analyze Post
        </button>
      </div>
    </motion.div>
  );
}
