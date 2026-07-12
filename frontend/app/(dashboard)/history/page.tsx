"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  FileClock,
  Filter,
  History as HistoryIcon,
  Link2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { type ContentFormat, type Tier } from "@/lib/types";
import { cn } from "@/lib/utils";

type PredictionStatus = "current" | "provisional" | "stale" | "superseded";
type ObservationStatus = "not_linked" | "linked_pending_maturity" | "linked_awaiting_metrics" | "observed_mature";

type HistoryItem = {
  id: string;
  brand: string;
  brand_id: string | null;
  niche: string | null;
  post_hour: number | null;
  account: string;
  format: ContentFormat;
  caption: string;
  tier: Tier;
  publication_linked: boolean;
  publication_media_id: string | null;
  observed_er: number | null;
  observed_post_age_days: number | null;
  observed_at: string | null;
  observation_status: ObservationStatus;
  confidence: number | null;
  when: string;
  scheduled_date: string | null;
  status: PredictionStatus;
  stale_reason: string | null;
  stale_at: string | null;
  time_known: boolean;
  supersedes_prediction_id?: string | null;
  supersession_reason?: string | null;
  model_id?: string | null;
  feature_schema_version?: string | null;
  input_hash?: string | null;
};

type LifecycleFilter = "all" | "active" | "needs_action" | "observed";
type VersionScope = "latest" | "all";

type VersionMeta = {
  index: number;
  total: number;
  latestId: string;
};

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reEvaluating, setReEvaluating] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("All");
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("all");
  const [scope, setScope] = useState<VersionScope>("latest");
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetchWithRetry("/api/history");
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload)) {
        throw new Error("The prediction ledger could not be loaded.");
      }
      setHistory(payload);
    } catch (error: unknown) {
      setHistory([]);
      setLoadError(error instanceof Error ? error.message : "The prediction ledger could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const requestedPrediction = new URLSearchParams(window.location.search).get("prediction_id");
    setHighlightId(requestedPrediction);
    if (requestedPrediction) setScope("all");
    void loadHistory();
  }, [loadHistory]);

  const versionMeta = useMemo(() => buildVersionMeta(history), [history]);

  const brands = useMemo(
    () => Array.from(new Set(history.map((item) => item.brand))).sort(),
    [history]
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return history.filter((item) => {
      const meta = versionMeta.get(item.id);
      const matchesVersion = scope === "all" || meta?.latestId === item.id;
      const matchesBrand = brand === "All" || item.brand === brand;
      const matchesQuery = !normalizedQuery ||
        item.brand.toLowerCase().includes(normalizedQuery) ||
        item.caption.toLowerCase().includes(normalizedQuery) ||
        item.id.toLowerCase().includes(normalizedQuery);
      const matchesLifecycle = lifecycle === "all" ||
        (lifecycle === "active" && (item.status === "current" || item.status === "provisional")) ||
        (lifecycle === "observed" && item.observation_status === "observed_mature") ||
        (lifecycle === "needs_action" && (
          item.status === "stale" ||
          item.status === "provisional" ||
          item.observation_status === "linked_awaiting_metrics"
        ));
      return matchesVersion && matchesBrand && matchesQuery && matchesLifecycle;
    });
  }, [brand, history, lifecycle, query, scope, versionMeta]);

  const reEvaluate = async (item: HistoryItem) => {
    if (!item.brand_id || reEvaluating) return;
    setReEvaluating(item.id);
    setLoadError(null);
    try {
      const response = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: item.caption,
          format: item.format,
          post_hour: item.post_hour,
          brand_id: item.brand_id,
          niche: item.niche,
          scheduled_date: item.scheduled_date || undefined,
          supersedes_prediction_id: item.id,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message || "The current model could not create a successor prediction.");
      await loadHistory();
      setHighlightId(result?.prediction_id || null);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "Recalculation failed. Try again in a moment.");
    } finally {
      setReEvaluating(null);
    }
  };

  return (
    <div className="mx-auto min-h-dvh max-w-[1400px] space-y-7 px-4 py-6 md:px-8 md:py-8">
      <SectionHeader
        eyebrow="Decision record"
        title="Prediction Ledger"
        description="Trace each immutable prediction, its successor versions, and the mature Instagram outcome linked to the exact published media."
        actions={
          <Link href="/predict" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            New prediction
          </Link>
        }
      />

      {loadError && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-destructive/25 bg-destructive/[0.04] p-4 text-sm sm:flex-row sm:items-center">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <p className="flex-1 text-muted-foreground">{loadError}</p>
          <button type="button" onClick={loadHistory} className="min-h-10 rounded-lg border border-border bg-surface px-3 font-semibold hover:bg-surface-2">Try again</button>
        </div>
      )}

      <section aria-label="Prediction ledger filters" className="rounded-2xl border border-border bg-surface p-3 shadow-[var(--shadow-soft)]">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_180px_auto]">
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Search prediction ledger</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search brand, caption, or record ID"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>

          <label className="relative">
            <span className="sr-only">Filter by brand</span>
            <select
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              className="min-h-11 w-full appearance-none rounded-xl border border-border bg-background px-3 pr-9 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="All">All brands</option>
              {brands.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </label>

          <div className="grid grid-cols-2 rounded-xl border border-border bg-background p-1" aria-label="Prediction version scope">
            {(["latest", "all"] as VersionScope[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={cn(
                  "min-h-9 rounded-lg px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  scope === value ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {value === "latest" ? "Latest versions" : "All versions"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Filter by lifecycle state">
          {([
            ["all", "All records"],
            ["active", "Active decisions"],
            ["needs_action", "Needs action"],
            ["observed", "Observed outcomes"],
          ] as Array<[LifecycleFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={lifecycle === value}
              onClick={() => setLifecycle(value)}
              className={cn(
                "min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                lifecycle === value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="ledger-results-title" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 id="ledger-results-title" className="text-sm font-semibold">
              {isLoading ? "Loading decision records" : `${filtered.length} record${filtered.length === 1 ? "" : "s"}`}
            </h2>
          </div>
          {scope === "latest" && history.length > filtered.length && (
            <button type="button" onClick={() => setScope("all")} className="text-sm font-semibold text-primary hover:underline">Show version history</button>
          )}
        </div>

        {isLoading ? (
          <LedgerSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyLedger hasHistory={history.length > 0} onClear={() => { setQuery(""); setBrand("All"); setLifecycle("all"); setScope("latest"); }} />
        ) : (
          <ul className="space-y-3" aria-label="Prediction records">
            {filtered.map((item) => (
              <PredictionRecord
                key={item.id}
                item={item}
                version={versionMeta.get(item.id) || { index: 1, total: 1, latestId: item.id }}
                highlighted={highlightId === item.id}
                reEvaluating={reEvaluating === item.id}
                anotherRecalculationRunning={reEvaluating !== null && reEvaluating !== item.id}
                onRecalculate={() => reEvaluate(item)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PredictionRecord({
  item,
  version,
  highlighted,
  reEvaluating,
  anotherRecalculationRunning,
  onRecalculate,
}: {
  item: HistoryItem;
  version: VersionMeta;
  highlighted: boolean;
  reEvaluating: boolean;
  anotherRecalculationRunning: boolean;
  onRecalculate: () => void;
}) {
  const canRecalculate = Boolean(item.brand_id) && (item.status === "stale" || item.status === "provisional");
  const publicationHref = item.brand_id
    ? item.publication_media_id
      ? `/insights?brand_id=${encodeURIComponent(item.brand_id)}&media_id=${encodeURIComponent(item.publication_media_id)}`
      : `/insights?brand_id=${encodeURIComponent(item.brand_id)}&prediction_id=${encodeURIComponent(item.id)}`
    : "/insights";

  return (
    <li>
      <article className={cn(
        "overflow-hidden rounded-3xl border bg-surface shadow-[var(--shadow-soft)] transition-colors",
        highlighted ? "border-primary ring-4 ring-primary/10" : "border-border"
      )}>
        <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(210px,0.7fr)_minmax(230px,0.8fr)]">
          <div className="min-w-0 p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{item.brand}</span>
              <span aria-hidden="true">·</span>
              <span>{item.format}</span>
              <span aria-hidden="true">·</span>
              <span>Version {version.index} of {version.total}</span>
              {version.latestId === item.id && version.total > 1 && <StatusPill label="Latest version" tone="primary" />}
            </div>
            <h3 className="mt-3 line-clamp-2 text-base font-semibold leading-relaxed text-foreground">
              {item.caption || "Draft without a caption"}
            </h3>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <TierBadge tier={item.tier} />
              <span className="text-sm text-muted-foreground">
                {item.confidence == null ? "Raw class score unavailable" : `${item.confidence}/100 raw class score`}
              </span>
              <PredictionStatusBadge item={item} />
            </div>
            {item.stale_reason && (item.status === "stale" || item.status === "superseded") && (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.stale_reason}</p>
            )}
          </div>

          <div className="border-t border-border p-5 lg:border-l lg:border-t-0 md:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Publication outcome</p>
            <div className="mt-3"><OutcomeState item={item} /></div>
          </div>

          <div className="flex flex-col justify-between gap-5 border-t border-border bg-surface-2/25 p-5 lg:border-l lg:border-t-0 md:p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recorded</p>
              <time dateTime={item.when} className="mt-2 block text-sm font-medium text-foreground">{formatDateTime(item.when)}</time>
              <p className="mt-1 text-xs text-muted-foreground">Immutable prediction ID {item.id.slice(0, 8)}…</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canRecalculate ? (
                <button
                  type="button"
                  onClick={onRecalculate}
                  disabled={reEvaluating || anotherRecalculationRunning}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-foreground px-3 text-sm font-semibold text-background disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-4 w-4", reEvaluating && "animate-spin")} aria-hidden="true" />
                  {reEvaluating ? "Creating successor…" : "Recalculate"}
                </button>
              ) : item.status !== "superseded" ? (
                <Link href={publicationHref} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-foreground px-3 text-sm font-semibold text-background">
                  {item.publication_linked ? "View result" : "Find publication"}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <details className="group border-t border-border">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 md:px-6">
            <HistoryIcon className="h-4 w-4" aria-hidden="true" />
            Audit details
            <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <dl className="grid gap-4 border-t border-border bg-surface-2/30 px-5 py-5 text-sm sm:grid-cols-2 lg:grid-cols-4 md:px-6">
            <AuditField term="Prediction record" value={item.id} mono />
            <AuditField term="Model record" value={item.model_id || "Not recorded"} mono />
            <AuditField term="Feature schema" value={item.feature_schema_version || "Not recorded"} mono />
            <AuditField term="Input fingerprint" value={item.input_hash ? `${item.input_hash.slice(0, 16)}…` : "Not recorded"} mono />
            <AuditField term="Posting time" value={item.time_known && item.post_hour != null ? `${String(item.post_hour).padStart(2, "0")}:00` : "Not set · provisional"} />
            <AuditField term="Scheduled date" value={item.scheduled_date ? formatDate(item.scheduled_date) : "Not scheduled"} />
            <AuditField term="Supersedes" value={item.supersedes_prediction_id || "Original version"} mono />
            <AuditField term="Publication media ID" value={item.publication_media_id || "Not linked"} mono />
          </dl>
        </details>
      </article>
    </li>
  );
}

function OutcomeState({ item }: { item: HistoryItem }) {
  if (item.observation_status === "observed_mature" && item.observed_er !== null) {
    return (
      <div>
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          <span className="text-xl font-semibold tabular-nums">ER {item.observed_er.toFixed(2)}%</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Verified media · {item.observed_post_age_days ?? "—"} days old</p>
      </div>
    );
  }

  if (item.observation_status === "linked_pending_maturity") {
    const age = Math.max(0, Math.min(6, item.observed_post_age_days ?? 0));
    const remaining = Math.max(1, 7 - age);
    return (
      <div>
        <div className="flex items-center gap-2 font-semibold text-primary"><CalendarClock className="h-5 w-5" aria-hidden="true" />Maturing</div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Publication maturity" aria-valuemin={0} aria-valuemax={7} aria-valuenow={age}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${(age / 7) * 100}%` }} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{remaining} day{remaining === 1 ? "" : "s"} until the seven-day outcome window.</p>
      </div>
    );
  }

  if (item.observation_status === "linked_awaiting_metrics") {
    return (
      <div>
        <div className="flex items-center gap-2 font-semibold text-warning"><RefreshCw className="h-5 w-5" aria-hidden="true" />Sync required</div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">The exact publication is linked and mature. Run the verified sync to observe ER.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 font-semibold text-muted-foreground"><Link2 className="h-5 w-5" aria-hidden="true" />Not linked</div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Match this prediction to the exact Instagram media after publishing.</p>
    </div>
  );
}

function PredictionStatusBadge({ item }: { item: HistoryItem }) {
  if (item.status === "current") return <StatusPill label="Current decision" tone="success" />;
  if (item.status === "provisional") return <StatusPill label="Time not set" tone="warning" />;
  if (item.status === "stale") return <StatusPill label="Needs recalculation" tone="warning" />;
  return <StatusPill label="Superseded" tone="neutral" />;
}

function StatusPill({ label, tone }: { label: string; tone: "primary" | "success" | "warning" | "neutral" }) {
  return <span className={cn(
    "inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold",
    tone === "primary" && "border-primary/25 bg-primary/10 text-primary",
    tone === "success" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
    tone === "neutral" && "border-border bg-surface-2 text-muted-foreground"
  )}>{label}</span>;
}

function AuditField({ term, value, mono = false }: { term: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className={cn("mt-1 break-all text-foreground", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div role="status" aria-label="Loading prediction ledger" className="space-y-3">
      {[0, 1, 2].map((row) => <div key={row} className="h-48 motion-safe:animate-pulse rounded-3xl bg-surface-2" />)}
      <span className="sr-only">Loading prediction records</span>
    </div>
  );
}

function EmptyLedger({ hasHistory, onClear }: { hasHistory: boolean; onClear: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-surface p-10 text-center">
      <FileClock className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
      <h3 className="mt-4 text-lg font-semibold">{hasHistory ? "No records match these filters" : "No predictions recorded yet"}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
        {hasHistory ? "Adjust the filters to return to your decision history." : "Analyze a real content draft to create the first immutable prediction record."}
      </p>
      {hasHistory ? (
        <button type="button" onClick={onClear} className="mt-5 min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2">Clear filters</button>
      ) : (
        <Link href="/predict" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background">
          Create prediction <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function buildVersionMeta(items: HistoryItem[]): Map<string, VersionMeta> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rootFor = (item: HistoryItem) => {
    let current = item;
    const seen = new Set<string>([item.id]);
    while (current.supersedes_prediction_id) {
      const parent = byId.get(current.supersedes_prediction_id);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      current = parent;
    }
    return current.id;
  };

  const groups = new Map<string, HistoryItem[]>();
  for (const item of items) {
    const root = rootFor(item);
    groups.set(root, [...(groups.get(root) || []), item]);
  }

  const result = new Map<string, VersionMeta>();
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
    const latestId = ordered[ordered.length - 1]?.id || ordered[0]?.id;
    ordered.forEach((item, index) => result.set(item.id, { index: index + 1, total: ordered.length, latestId }));
  }
  return result;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}
