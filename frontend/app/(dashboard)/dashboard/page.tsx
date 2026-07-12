"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { TierBadge } from "@/components/TierBadge";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { type Brand, type Tier } from "@/lib/types";
import { cn } from "@/lib/utils";

type DashboardSummary = {
  totalPredictions: number;
  staleCount: number;
  provisionalCount: number;
  observedCount: number;
  recent: Array<{
    id: string;
    brand: string;
    caption: string;
    tier: Tier;
    confidence: number | null;
    when: string;
  }>;
};

type PlanEntry = {
  id: string;
  posting_date: string;
  posting_time: string | null;
  content_type: string;
  content_details: string | null;
  caption: string | null;
  brands?: { name?: string } | null;
  prediction: {
    id: string;
    tier: Tier;
    status: "current" | "provisional" | "stale" | "superseded";
    time_known: boolean;
  } | null;
  publication: {
    observed_er: number | null;
    outcome_status: "observed" | "pending_maturity" | "awaiting_observation";
  } | null;
};

type InstagramConnection = {
  brand_id: string;
  status: "connected" | "error" | "unreachable" | "unbound";
  username?: string | null;
};

type DecisionTone = "primary" | "warning" | "success" | "neutral";

const EMPTY_SUMMARY: DashboardSummary = {
  totalPredictions: 0,
  staleCount: 0,
  provisionalCount: 0,
  observedCount: 0,
  recent: [],
};

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [connections, setConnections] = useState<InstagramConnection[]>([]);
  const [connectionHealthAvailable, setConnectionHealthAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDecisionWorkspace() {
      setLoading(true);
      const errors: string[] = [];

      const [dashboardResult, brandsResult, planResult, connectionResult] = await Promise.allSettled([
        fetchWithRetry("/api/dashboard", { cache: "no-store" }),
        fetchWithRetry("/api/brands", { cache: "no-store" }),
        fetchWithRetry("/api/calendar", { cache: "no-store" }),
        fetchWithRetry("/api/instagram-health", { cache: "no-store" }, 0),
      ]);

      if (cancelled) return;

      if (dashboardResult.status === "fulfilled" && dashboardResult.value.ok) {
        const data = await dashboardResult.value.json();
        setSummary({
          totalPredictions: Number(data.totalPredictions || 0),
          staleCount: Number(data.staleCount || 0),
          provisionalCount: Number(data.provisionalCount || 0),
          observedCount: Number(data.observedCount || 0),
          recent: Array.isArray(data.recent)
            ? data.recent.map((item: any) => ({
                id: String(item.id),
                brand: String(item.brand || "Unknown brand"),
                caption: String(item.caption || "Untitled draft"),
                tier: normalizeTier(item.tier),
                confidence: typeof item.confidence === "number" ? item.confidence : null,
                when: String(item.when || ""),
              }))
            : [],
        });
      } else {
        errors.push("prediction activity");
      }

      if (brandsResult.status === "fulfilled" && brandsResult.value.ok) {
        const data = await brandsResult.value.json();
        setBrands(Array.isArray(data) ? data : []);
      } else {
        errors.push("brand readiness");
      }

      if (planResult.status === "fulfilled" && planResult.value.ok) {
        const data = await planResult.value.json();
        setPlans(Array.isArray(data) ? data : []);
      } else {
        errors.push("content plan");
      }

      if (connectionResult.status === "fulfilled" && connectionResult.value.ok) {
        const data = await connectionResult.value.json();
        setConnections(Array.isArray(data?.connections) ? data.connections : []);
        setConnectionHealthAvailable(true);
      } else {
        setConnectionHealthAvailable(false);
        errors.push("Instagram connection status");
      }

      setLoadError(
        errors.length > 0
          ? `Some workspace data is temporarily unavailable: ${errors.join(", ")}.`
          : null,
      );
      setLoading(false);
    }

    void loadDecisionWorkspace();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const today = useMemo(() => toLocalDateKey(new Date()), []);
  const upcomingPlans = useMemo(
    () =>
      plans
        .filter((entry) => entry.posting_date >= today)
        .sort((a, b) => planSortKey(a).localeCompare(planSortKey(b)))
        .slice(0, 5),
    [plans, today],
  );

  const needsPrediction = useMemo(
    () => plans.filter((entry) => !entry.prediction).length,
    [plans],
  );
  const stalePlans = useMemo(
    () => plans.filter((entry) => entry.prediction?.status === "stale").length,
    [plans],
  );
  const awaitingOutcome = useMemo(
    () => plans.filter((entry) => entry.publication && entry.publication.observed_er == null).length,
    [plans],
  );
  const connectedCount = useMemo(
    () => connections.filter((connection) => connection.status === "connected").length,
    [connections],
  );
  const connectionIssues = connectionHealthAvailable ? Math.max(brands.length - connectedCount, 0) : 0;

  const decisionCards: Array<{
    label: string;
    value: number;
    detail: string;
    href: string;
    action: string;
  }> = [
    {
      label: "Ready to evaluate",
      value: needsPrediction,
      detail: needsPrediction === 1 ? "planned post has no prediction" : "planned posts have no prediction",
      href: "/calendar",
      action: "Review plan",
    },
    {
      label: "Needs re-evaluation",
      value: stalePlans,
      detail: stalePlans === 1 ? "prediction changed after its inputs" : "predictions changed after their inputs",
      href: "/calendar",
      action: "Review changes",
    },
    {
      label: "Awaiting learning",
      value: awaitingOutcome,
      detail: awaitingOutcome === 1 ? "linked post is waiting for an outcome" : "linked posts are waiting for outcomes",
      href: "/insights",
      action: "Open insights",
    },
    {
      label: "Observed outcomes",
      value: summary.observedCount,
      detail: "mature results available for comparison",
      href: "/history",
      action: "View evidence",
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 md:px-8 md:py-8 xl:px-10">
      <header className="overflow-hidden rounded-[1.4rem] border border-border bg-surface shadow-[var(--shadow-soft)]">
        <div className="grid gap-7 p-6 md:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-3xl">
            <h1 className="font-display text-3xl font-semibold tracking-[-0.035em] text-foreground md:text-4xl">
              Decide what to publish next.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-[15px]">
              Plan content, evaluate drafts, and learn from published results.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            <Link
              href="/calendar"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-2"
            >
              Plan content
            </Link>
            <Link
              href="/predict"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-[var(--shadow-soft)] hover:bg-primary/90"
            >
              Evaluate a draft
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border bg-surface-2/45 px-6 py-3 text-xs font-semibold text-muted-foreground md:px-8">
          <span>{brands.length} brand workspace{brands.length === 1 ? "" : "s"}</span>
          <span>{connectionHealthAvailable ? `${connectedCount} verified Instagram connection${connectedCount === 1 ? "" : "s"}` : "Instagram connection status unavailable"}</span>
          <span>{summary.totalPredictions} active prediction{summary.totalPredictions === 1 ? "" : "s"}</span>
          {summary.provisionalCount > 0 && (
            <span className="text-warning-foreground">{summary.provisionalCount} provisional without a confirmed posting time</span>
          )}
        </div>
      </header>

      {loadError && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/35 bg-warning/[0.06] p-4 sm:flex-row sm:items-center">
          <AlertCircle className="h-4 w-4 shrink-0 text-warning-foreground" />
          <p className="flex-1 text-sm font-medium text-foreground">{loadError}</p>
          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-bold hover:bg-surface-2"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      )}

      {brands.length === 0 && !loading && (
        <section className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-primary/[0.045] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
              <h2 className="text-sm font-bold">Start with a brand workspace</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Add the brand, connect Instagram, and confirm model readiness.</p>
          </div>
          <Link href="/niches" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90">
            Set up a brand
          </Link>
        </section>
      )}

      <section aria-labelledby="attention-title">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 id="attention-title" className="font-display text-xl font-semibold tracking-tight">What needs attention</h2>
            <p className="mt-1 text-sm text-muted-foreground">Your next content decisions.</p>
          </div>
          <Link href="/calendar" className="hidden items-center text-xs font-bold text-primary hover:underline sm:inline-flex">
            Open plan
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {decisionCards.map((card) => (
            <DecisionCard key={card.label} {...card} loading={loading} />
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section aria-labelledby="upcoming-title" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 md:px-6">
            <div>
              <h2 id="upcoming-title" className="font-display text-lg font-semibold">Upcoming content decisions</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">The next planned posts, prioritized by schedule.</p>
            </div>
            <Link href="/calendar" className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-bold text-primary hover:bg-primary/[0.06]">
              View plan
            </Link>
          </div>
          {loading ? (
            <LoadingRows />
          ) : upcomingPlans.length === 0 ? (
            <EmptyPanel
              title="Nothing planned yet"
              description="Add a content idea so its creative direction can be evaluated before publishing."
              href="/calendar"
              action="Plan the first post"
            />
          ) : (
            <ul className="divide-y divide-border/70">
              {upcomingPlans.map((entry) => {
                const decision = getPlanDecision(entry);
                return (
                  <li key={entry.id} className="group px-5 py-4 transition-colors hover:bg-surface-2/45 md:px-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-center">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{formatMonth(entry.posting_date)}</span>
                          <span className="text-sm font-extrabold leading-none">{formatDay(entry.posting_date)}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-bold text-foreground">{entry.content_details || entry.caption || "Untitled content idea"}</span>
                            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">{entry.content_type || "Unspecified"}</span>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {entry.brands?.name || "Unassigned brand"} · {formatSchedule(entry.posting_date, entry.posting_time)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <DecisionBadge label={decision.label} tone={decision.tone} />
                            {entry.prediction && <TierBadge tier={normalizeTier(entry.prediction.tier)} />}
                            {entry.publication?.observed_er != null && (
                              <span className="text-[11px] font-bold text-success-foreground">Observed ER {entry.publication.observed_er.toFixed(2)}%</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <Link
                        href={decision.href(entry.id)}
                        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                      >
                        {decision.action}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent-title" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id="recent-title" className="font-display text-lg font-semibold">Recent decisions</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Latest classified drafts in this workspace.</p>
            </div>
            <Link href="/history" className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-bold text-primary hover:bg-primary/[0.06]">
              History
            </Link>
          </div>
          {loading ? (
            <LoadingRows count={3} />
          ) : summary.recent.length === 0 ? (
            <EmptyPanel
              title="No predictions yet"
              description="Evaluate a draft to create the first versioned decision record."
              href="/predict"
              action="Evaluate a draft"
            />
          ) : (
            <ul className="divide-y divide-border/70 px-5">
              {summary.recent.slice(0, 4).map((prediction) => (
                <li key={prediction.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground">{prediction.brand}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{prediction.caption}</p>
                    </div>
                    <TierBadge tier={prediction.tier} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-muted-foreground">
                    <span>{formatDateTime(prediction.when)}</span>
                    {prediction.confidence != null && <span>{prediction.confidence}/100 raw class score</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      <section aria-labelledby="readiness-title" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div>
            <h2 id="readiness-title" className="font-display text-lg font-semibold">Brand readiness</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Connection and serving-model status for each content context.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-muted-foreground">
            {connectionIssues > 0 && <span className="text-warning-foreground">{connectionIssues} connection{connectionIssues === 1 ? "" : "s"} need attention</span>}
            <Link href="/niches" className="inline-flex min-h-9 items-center rounded-lg px-2 font-bold text-primary hover:bg-primary/[0.06]">
              Manage brands
            </Link>
          </div>
        </div>
        {loading ? (
          <LoadingRows count={2} />
        ) : brands.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Create a brand workspace to see readiness here.</div>
        ) : (
          <ul className="grid divide-y divide-border/70 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
            {brands.slice(0, 6).map((brand) => {
              const connection = connections.find((item) => item.brand_id === brand.id);
              const connected = connection?.status === "connected";
              const modelLabel = brand.active_model_scope === "personal"
                ? "Personal model"
                : brand.active_model_scope === "cohort"
                  ? "Niche model"
                  : "No serving model";
              return (
                <li key={brand.id} className="flex items-center gap-3 border-border/70 p-5 sm:border-r sm:[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(3n)]:border-r-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">{brand.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{brand.niche} · {modelLabel}</p>
                  </div>
                  <span className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold",
                    !connectionHealthAvailable ? "text-muted-foreground" : connected ? "text-success-foreground" : "text-warning-foreground",
                  )}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", !connectionHealthAvailable ? "bg-muted-foreground" : connected ? "bg-success" : "bg-warning")} />
                    {!connectionHealthAvailable ? "Unavailable" : connected ? "Connected" : "Check setup"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function DecisionCard({
  label,
  value,
  detail,
  href,
  action,
  loading,
}: {
  label: string;
  value: number;
  detail: string;
  href: string;
  action: string;
  loading: boolean;
}) {
  return (
    <Link href={href} className="group rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-soft)] hover:-translate-y-px hover:border-primary/20 hover:shadow-[var(--shadow-elevated)]">
      {loading ? (
        <div className="h-8 w-14 motion-safe:animate-pulse rounded-lg bg-surface-2" aria-label={`Loading ${label}`} />
      ) : (
        <div className="text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
      )}
      <h3 className="mt-1 text-sm font-bold text-foreground">{label}</h3>
      <p className="mt-1 min-h-8 text-xs leading-4 text-muted-foreground">{detail}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary">{action}</span>
    </Link>
  );
}

function DecisionBadge({ label, tone }: { label: string; tone: DecisionTone }) {
  const toneClass: Record<DecisionTone, string> = {
    primary: "border-primary/25 bg-primary/[0.07] text-primary",
    warning: "border-warning/40 bg-warning/[0.08] text-warning-foreground",
    success: "border-success/35 bg-success/[0.08] text-success-foreground",
    neutral: "border-border bg-surface-2 text-muted-foreground",
  };
  return <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold", toneClass[tone])}>{label}</span>;
}

function LoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div className="divide-y divide-border/70" aria-label="Loading workspace decisions">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-5 py-4 md:px-6">
          <div className="h-11 w-11 motion-safe:animate-pulse rounded-xl bg-surface-2" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/2 motion-safe:animate-pulse rounded bg-surface-2" />
            <div className="h-2.5 w-1/3 motion-safe:animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyPanel({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
      <Link href={href} className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-border bg-surface px-3 text-xs font-bold hover:bg-surface-2">
        {action}
      </Link>
    </div>
  );
}

function getPlanDecision(entry: PlanEntry) {
  if (!entry.prediction) {
    return {
      label: "Needs prediction",
      action: "Evaluate",
      tone: "primary" as const,
      href: (id: string) => `/predict?plan_id=${encodeURIComponent(id)}`,
    };
  }
  if (entry.prediction.status === "stale" || entry.prediction.status === "superseded") {
    return {
      label: entry.prediction.status === "stale" ? "Prediction stale" : "Prediction superseded",
      action: "Re-evaluate",
      tone: "warning" as const,
      href: (id: string) => `/predict?plan_id=${encodeURIComponent(id)}`,
    };
  }
  if (entry.publication?.observed_er != null) {
    return {
      label: "Outcome observed",
      action: "View result",
      tone: "success" as const,
      href: () => "/history",
    };
  }
  if (entry.publication) {
    return {
      label: entry.publication.outcome_status === "pending_maturity" ? "Publication maturing" : "Awaiting outcome",
      action: "View result",
      tone: "neutral" as const,
      href: () => "/history",
    };
  }
  if (entry.prediction.status === "provisional") {
    return {
      label: "Provisional prediction",
      action: "Refine",
      tone: "neutral" as const,
      href: (id: string) => `/predict?plan_id=${encodeURIComponent(id)}`,
    };
  }
  return {
    label: "Prediction current",
    action: "View prediction",
    tone: "success" as const,
    href: () => "/history",
  };
}

function normalizeTier(value: unknown): Tier {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "low") return "Low";
  return "Average";
}

function planSortKey(entry: PlanEntry) {
  return `${entry.posting_date}T${entry.posting_time || "23:59"}`;
}

function toLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatMonth(value: string) {
  const [, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(2020, month - 1, 1));
}

function formatDay(value: string) {
  return String(Number(value.split("-")[2] || 0));
}

function formatSchedule(dateValue: string, timeValue: string | null) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const formatted = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short" }).format(date);
  return timeValue ? `${formatted} at ${String(timeValue).slice(0, 5)}` : `${formatted} · time optional`;
}

function formatDateTime(value: string) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
