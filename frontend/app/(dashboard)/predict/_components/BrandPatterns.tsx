"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Clock3,
  Database,
  ExternalLink,
  Info,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type {
  BrandPatternEvidenceLevel,
  BrandPatternGroup,
  BrandPatternsPayload,
} from "@/lib/brand-patterns";
import { cn } from "@/lib/utils";

const DIMENSION_LABELS: Record<string, string> = {
  format: "Content format",
  posting_window: "Posting window",
  day_type: "Day type",
  cta: "CTA usage",
  question: "Question usage",
};

const PATTERN_LABELS: Record<string, string> = {
  formats: "Content format",
  dayparts: "Posting window",
  day_type: "Day type",
  cta: "CTA usage",
  question: "Question usage",
  emoji: "Emoji usage",
  caption_length: "Caption length",
  hashtags: "Hashtag count",
};

function dateTime(value: string | null): string {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function er(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function signedPoints(value: number): string {
  const rounded = Math.abs(value).toFixed(Math.abs(value) >= 10 ? 1 : 2);
  return `${value >= 0 ? "+" : "−"}${rounded} pp`;
}

function evidenceLabel(level: BrandPatternEvidenceLevel): string {
  if (level === "directional") return "Directional evidence";
  if (level === "exploratory") return "Exploratory evidence";
  return "Limited evidence";
}

function EvidenceBadge({ level }: { level: BrandPatternEvidenceLevel }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs font-bold",
        level === "directional"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : level === "exploratory"
            ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-border bg-surface-2 text-muted-foreground"
      )}
    >
      {evidenceLabel(level)}
    </span>
  );
}

function PatternMetric({
  title,
  group,
}: {
  title: string;
  group: BrandPatternGroup;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="mt-1 text-sm font-bold text-foreground">{group.label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-mono font-bold text-foreground">median ER {er(group.median_er)}</span>
        <span>·</span>
        <span>n={group.sample_size}</span>
        <span>·</span>
        <span>IQR {er(group.q1_er)}–{er(group.q3_er)}</span>
        <span>·</span>
        <span>{signedPoints(group.difference_from_brand_median_pp)} vs brand median</span>
      </div>
      <div className="mt-2">
        <EvidenceBadge level={group.evidence_level} />
      </div>
    </div>
  );
}

export function BrandPatterns({
  brandId,
  brandName,
  activeModelScope,
}: {
  brandId: string | null;
  brandName?: string;
  activeModelScope?: "personal" | "cohort" | "none";
}) {
  const [data, setData] = useState<BrandPatternsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!brandId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    void (async () => {
      try {
        const response = await fetch(`/api/brand-patterns?brand_id=${encodeURIComponent(brandId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || (payload.status !== "success" && payload.status !== "empty")) {
          throw new Error(payload?.message || "Brand history patterns could not be loaded.");
        }
        setData(payload as BrandPatternsPayload);
      } catch (caught: unknown) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Brand history patterns could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [brandId, attempt]);

  const allPatternGroups = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.patterns).flatMap(([dimension, groups]) =>
      groups.map((group) => ({ dimension, group }))
    );
  }, [data]);

  return (
    <section
      aria-labelledby="brand-patterns-title"
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
    >
      <div className="border-b border-border/60 bg-surface-2/35 px-5 py-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <BarChart3 className="h-4 w-4" />
            </span>
            <div>
              <h2 id="brand-patterns-title" className="text-xs font-bold uppercase tracking-wide text-foreground">
                Brand Performance Snapshot
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Observed associations from this brand&apos;s mature, verified posts—not causal audience preferences.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-border bg-surface px-2 py-1 text-xs font-bold text-muted-foreground">
              Brand-only evidence
            </span>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
              Descriptive, not causal
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {!brandId && (
          <p className="text-xs text-muted-foreground">Select a brand to inspect its observed history.</p>
        )}

        {loading && (
          <div role="status" className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-xl border border-border bg-surface-2/60" />
            ))}
            <span className="sr-only">Loading brand performance patterns</span>
          </div>
        )}

        {error && !loading && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <div className="text-xs font-bold text-foreground">Snapshot unavailable</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{error} Prediction remains available.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-bold hover:bg-surface-2"
            >
              <RefreshCw className="h-3 w-3" /> Retry snapshot
            </button>
          </div>
        )}

        {data && !loading && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface-2/45 p-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-primary" />
                <strong className="text-foreground">{data.evidence.eligible_posts}</strong> of {data.evidence.mature_verified_posts} mature verified posts use model-supported formats
              </span>
              {data.evidence.excluded_unmodeled_posts > 0 && (
                <span title={Object.entries(data.evidence.excluded_format_counts).map(([label, count]) => `${label}: ${count}`).join(" · ")}>
                  {data.evidence.excluded_unmodeled_posts} unmodeled-format post{data.evidence.excluded_unmodeled_posts === 1 ? "" : "s"} excluded from comparisons
                </span>
              )}
              {data.overall && (
                <span>
                  Brand median ER <strong className="font-mono text-foreground">{er(data.overall.median_er)}</strong>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" /> Last synced {dateTime(data.evidence.latest_sync_at)} WIB
              </span>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 font-bold",
                  data.freshness.status === "current"
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : data.freshness.status === "aging"
                      ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "border-destructive/25 bg-destructive/10 text-destructive"
                )}
              >
                History {data.freshness.status}
                {data.freshness.days_since_latest_mature_post !== null
                  ? ` · latest eligible post ${data.freshness.days_since_latest_mature_post}d ago`
                  : ""}
              </span>
            </div>

            {activeModelScope === "cohort" && (
              <div className="rounded-lg border border-primary/20 bg-primary/[0.03] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                These patterns use <strong className="text-foreground">{brandName || data.brand.name}&apos;s own history</strong>. The prediction currently uses a shared <strong className="text-foreground">{data.brand.niche} cohort model</strong>; those are different evidence scopes.
              </div>
            )}

            {data.status === "empty" || data.highlights.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-surface-2/30 p-4 text-xs leading-relaxed text-muted-foreground">
                There is not enough comparable history to identify a supported pattern yet. A highlight needs at least {data.evidence.minimum_highlight_total} eligible posts overall and {data.evidence.minimum_group_samples} posts in each compared group.
              </div>
            ) : (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Highest observed medians
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.highlights.slice(0, 4).map((item) => (
                    <PatternMetric
                      key={`${item.dimension}-${item.key}`}
                      title={DIMENSION_LABELS[item.dimension] || item.dimension}
                      group={item}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  A higher historical median does not prove that changing one creative choice will cause higher engagement. Use it as a planning clue and validate with future posts.
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Evidence labels are transparent sample-size guards—not statistical-significance tests: limited n&lt;5, exploratory n=5–14, and directional n≥15. Highlights also require at least {data.evidence.minimum_highlight_total} eligible posts overall.
                </p>
              </div>
            )}

            {allPatternGroups.length > 0 && (
              <details className="rounded-xl border border-border bg-surface-2/30">
                <summary className="cursor-pointer px-4 py-3 text-xs font-bold text-foreground">
                  Inspect all measured historical comparisons
                </summary>
                <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2">
                  {allPatternGroups.map(({ dimension, group }) => (
                    <PatternMetric
                      key={`${dimension}-${group.key}`}
                      title={PATTERN_LABELS[dimension] || dimension}
                      group={group}
                    />
                  ))}
                </div>
              </details>
            )}

            {data.recent_publishing_mix && (
              <div className="rounded-xl border border-border bg-surface-2/30 p-4">
                <div className="text-xs font-bold text-foreground">
                  Recent publishing mix · last {data.recent_publishing_mix.window_days} days · {data.recent_publishing_mix.posts} mature verified posts
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(data.recent_publishing_mix.format_counts).map(([label, count]) => (
                    <span key={`format-${label}`} className="rounded-full border border-border bg-surface px-2 py-1 text-xs text-muted-foreground">
                      {label}: {count}
                    </span>
                  ))}
                  {Object.entries(data.recent_publishing_mix.daypart_counts).map(([label, count]) => (
                    <span key={`daypart-${label}`} className="rounded-full border border-border bg-surface px-2 py-1 text-xs text-muted-foreground">
                      {label}: {count}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {data.recent_publishing_mix.excluded_unmodeled_posts > 0 && `${data.recent_publishing_mix.excluded_unmodeled_posts} recent unmodeled-format post${data.recent_publishing_mix.excluded_unmodeled_posts === 1 ? " was" : "s were"} excluded from performance comparisons. `}
                  This describes what was published, not what recently performed best. {data.recent_publishing_mix.reason}
                </p>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                  <Info className="h-3.5 w-3.5 text-primary" /> Not measured yet
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.not_measured.map((item) => (
                    <span key={item.key} title={item.reason} className="rounded-full border border-border bg-surface-2 px-2 py-1 text-xs text-muted-foreground">
                      {item.label}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  The system does not invent demographics, visual taste, creative pillars, hooks, storytelling preferences, or external trend evidence from engagement counts.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="text-xs font-bold text-foreground">Trend relevance and brand identity</div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Weekly sync and retraining refresh brand history, but no live external trend or seasonal feed is connected. Add campaign, season, or trend context in the Creative Brief below; AI treats it as user-supplied planning context, while the prediction score remains grounded in measured model inputs.
                </p>
                {data.freshness.historical_samples_equally_weighted && (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Eligible historical samples are currently weighted equally; the system does not apply an unvalidated recency-versus-history blend.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span>Use historical evidence as a brand anchor, then test current creative hypotheses without presenting them as established preference.</span>
              <Link href="/insights" className="inline-flex items-center gap-1 font-bold text-primary hover:underline">
                Open post insights <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
