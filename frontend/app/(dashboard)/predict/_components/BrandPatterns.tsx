"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import type {
  BrandPatternEvidenceLevel,
  BrandPatternGroup,
  BrandPatternsPayload,
} from "@/lib/brand-patterns";

const DIMENSION_LABELS: Record<string, string> = {
  format: "Content format",
  posting_window: "Posting window",
  day_type: "Day type",
  cta: "CTA usage",
  question: "Question usage",
  formats: "Content format",
  dayparts: "Posting window",
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

function engagementRate(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function signedPoints(value: number): string {
  const rounded = Math.abs(value).toFixed(Math.abs(value) >= 10 ? 1 : 2);
  return `${value >= 0 ? "+" : "−"}${rounded} pp`;
}

function evidenceLabel(level: BrandPatternEvidenceLevel): string {
  if (level === "directional") return "Stronger signal";
  if (level === "exploratory") return "Early signal";
  return "Limited";
}

function PatternRow({ title, group }: { title: string; group: BrandPatternGroup }) {
  return (
    <article className="rounded-xl bg-surface-2/70 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">{title}</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{group.label}</p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {evidenceLabel(group.evidence_level)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">Median ER {engagementRate(group.median_er)}</span>
        <span aria-hidden>·</span>
        <span>n={group.sample_size}</span>
        <span aria-hidden>·</span>
        <span>{signedPoints(group.difference_from_brand_median_pp)} vs brand</span>
      </div>
    </article>
  );
}

export function BrandPatterns({
  brandId,
  brandName,
  activeModelScope,
  compact = false,
}: {
  brandId: string | null;
  brandName?: string;
  activeModelScope?: "personal" | "cohort" | "none";
  compact?: boolean;
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

  const allGroups = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.patterns).flatMap(([dimension, groups]) =>
      groups.map((group) => ({ dimension, group }))
    );
  }, [data]);

  const highlights = data?.highlights.slice(0, compact ? 2 : 4) ?? [];

  return (
    <section aria-labelledby="brand-patterns-title" className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
      <div className="border-b border-border px-5 py-5 sm:px-6">
        <h2 id="brand-patterns-title" className="text-base font-semibold text-foreground">Brand Performance Snapshot</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Patterns from verified posts—not causal preferences.</p>
      </div>

      <div className="flex flex-1 flex-col space-y-4 p-5 sm:p-6">
        {!brandId && <p className="text-sm text-muted-foreground">Select a brand to see its historical signals.</p>}

        {loading && (
          <div role="status" aria-live="polite" className="space-y-2">
            {[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-surface-2" />)}
            <span className="sr-only">Loading historical brand signals.</span>
          </div>
        )}

        {error && !loading && (
          <div role="alert" className="rounded-xl border border-warning/30 bg-warning/[0.04] p-3">
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{error} Prediction remains available.</span>
            </div>
            <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        )}

        {data && !loading && (
          <>
            <p className="text-xs font-semibold text-muted-foreground">
              <span className="text-foreground">{data.evidence.eligible_posts} eligible posts</span>
              <span className="mx-2" aria-hidden>·</span>
              <span className="capitalize">{data.freshness.status} data</span>
            </p>

            {activeModelScope === "cohort" && (
              <p className="rounded-xl border border-border bg-surface-2/40 p-3 text-sm leading-relaxed text-muted-foreground">
                These patterns use {brandName || data.brand.name}&apos;s history. The score uses the shared {data.brand.niche} niche model.
              </p>
            )}

            {data.status === "empty" || highlights.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-3 text-sm leading-relaxed text-muted-foreground">
                Not enough comparable history yet. A supported highlight needs {data.evidence.minimum_highlight_total} eligible posts overall and {data.evidence.minimum_group_samples} in each compared group.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {highlights.map((item) => (
                  <PatternRow key={`${item.dimension}-${item.key}`} title={DIMENSION_LABELS[item.dimension] || item.dimension} group={item} />
                ))}
                <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
                  Higher historical medians are planning clues, not proof that a creative change will cause better engagement.
                </p>
              </div>
            )}

            <details className="group rounded-xl border border-border bg-surface-2/30">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-sm font-semibold text-foreground marker:hidden">
                Data and limits
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-4 border-t border-border p-3.5">
                <div className="space-y-1 text-sm leading-relaxed text-muted-foreground">
                  <p>{data.evidence.eligible_posts} of {data.evidence.mature_verified_posts} mature verified posts use model-supported formats.</p>
                  {data.overall && (
                    <p>
                      Brand median ER: <strong className="text-foreground">{engagementRate(data.overall.median_er)}</strong>. Observed ER IQR: {engagementRate(data.overall.q1_er)}–{engagementRate(data.overall.q3_er)}.
                    </p>
                  )}
                  <p>
                    {data.evidence.excluded_unmodeled_posts} mature post{data.evidence.excluded_unmodeled_posts === 1 ? " was" : "s were"} excluded because the format is not supported by the prediction model.
                  </p>
                  <p>Last synchronized: {dateTime(data.evidence.latest_sync_at)} WIB.</p>
                  <p>Evidence labels are sample-size guards, not statistical-significance tests.</p>
                </div>

                {!compact && allGroups.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {allGroups.map(({ dimension, group }) => (
                      <PatternRow key={`${dimension}-${group.key}`} title={DIMENSION_LABELS[dimension] || dimension} group={group} />
                    ))}
                  </div>
                )}

                <div>
                  <p className="text-sm font-semibold text-foreground">Not measured by this system</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {data.not_measured.map((item) => (
                      <span key={item.key} title={item.reason} className="rounded-full border border-border bg-surface px-2 py-1 text-xs text-muted-foreground">{item.label}</span>
                    ))}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    No live external trend or seasonal feed is connected. Put current campaign context in Creative Direction; it remains planning context and does not alter the ML score.
                  </p>
                </div>

                <Link href="/insights" className="inline-flex min-h-10 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  View published results
                </Link>
              </div>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
