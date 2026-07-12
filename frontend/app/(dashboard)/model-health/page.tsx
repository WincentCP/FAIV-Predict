"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { type MlModel } from "@/lib/types";
import { cn } from "@/lib/utils";

type IgConnection = {
  brand_id?: string;
  brand: string;
  niche: string;
  last_synced: string | null;
  status: "connected" | "error" | "unreachable" | "unbound";
  username?: string;
  followers?: number;
  error?: string;
};

type LoadState = "loading" | "ready" | "error";

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Not updated yet";
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "Update time unavailable";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const days = Math.floor(diffMs / 86_400_000);
  if (days > 1) return `${days} days ago`;
  if (days === 1) return "Yesterday";
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  return "Just now";
}

export default function ModelHealthPage() {
  const [models, setModels] = useState<MlModel[]>([]);
  const [connections, setConnections] = useState<IgConnection[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadEvidence = useCallback(async () => {
    setState("loading");
    setLoadError(null);
    try {
      const [modelsRes, connectionsRes] = await Promise.all([
        fetchWithRetry("/api/models"),
        fetchWithRetry("/api/instagram-health", { cache: "no-store" }, 0),
      ]);
      const [modelPayload, connectionPayload] = await Promise.all([
        modelsRes.json().catch(() => null),
        connectionsRes.json().catch(() => null),
      ]);

      if (!modelsRes.ok || !Array.isArray(modelPayload)) {
        throw new Error("Prediction quality could not be loaded.");
      }

      setModels(modelPayload);
      setConnections(
        connectionsRes.ok && Array.isArray(connectionPayload?.connections)
          ? connectionPayload.connections
          : []
      );
      if (!connectionsRes.ok) {
        setLoadError("Prediction quality is available, but the latest Instagram update could not be checked.");
      }
      setState("ready");
    } catch (error: unknown) {
      setModels([]);
      setConnections([]);
      setState("error");
      setLoadError(error instanceof Error ? error.message : "Prediction quality is temporarily unavailable.");
    }
  }, []);

  useEffect(() => {
    void loadEvidence();
  }, [loadEvidence]);

  const summary = useMemo(() => {
    const evaluated = models.filter((model) => model.evaluationStatus !== null).length;
    const validated = models.filter((model) => model.evaluationStatus === "validated").length;
    const exploratory = models.filter((model) => model.evaluationStatus === "exploratory").length;
    const freshConnections = connections.filter((connection) => connection.status === "connected").length;
    return { evaluated, validated, exploratory, freshConnections };
  }, [connections, models]);

  return (
    <div className="mx-auto min-h-dvh max-w-[1400px] space-y-7 px-4 py-6 md:px-8 md:py-8">
      <SectionHeader
        title="Prediction quality"
        description="Check which prediction models are ready to use."
        actions={
          <button
            type="button"
            onClick={loadEvidence}
            disabled={state === "loading"}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", state === "loading" && "animate-spin")} aria-hidden="true" />
            Refresh
          </button>
        }
      />

      {loadError && (
        <div
          role={state === "error" ? "alert" : "status"}
          className={cn(
            "flex flex-col gap-3 rounded-2xl border p-4 text-sm sm:flex-row sm:items-center",
            state === "error"
              ? "border-destructive/25 bg-destructive/[0.04]"
              : "border-warning/25 bg-warning/[0.04]"
          )}
        >
          <AlertTriangle className={cn("h-5 w-5 shrink-0", state === "error" ? "text-destructive" : "text-warning")} aria-hidden="true" />
          <p className="flex-1 text-muted-foreground">{loadError}</p>
          {state === "error" && (
            <button type="button" onClick={loadEvidence} className="min-h-10 rounded-lg border border-border bg-surface px-3 font-semibold hover:bg-surface-2">
              Try again
            </button>
          )}
        </div>
      )}

      {state === "loading" ? (
        <EvidenceSkeleton />
      ) : (
        <>
          <section aria-labelledby="evidence-summary-title" className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-soft)]">
            <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
              <EvidenceSummary label="Active models" value={models.length} helper="Latest versions" />
              <EvidenceSummary label="Ready" value={summary.validated} helper={`${summary.evaluated} checked`} />
              <EvidenceSummary label="Use with caution" value={summary.exploratory} helper="Limited supporting data" />
              <EvidenceSummary label="Instagram connected" value={summary.freshConnections} helper="Accounts available" />
            </div>
            <h2 id="evidence-summary-title" className="sr-only">Prediction quality summary</h2>
          </section>

          <section aria-labelledby="model-evidence-title" className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="model-evidence-title" className="text-xl font-semibold tracking-tight">Prediction readiness</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Test results saved when each model was trained.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">{models.length} current record{models.length === 1 ? "" : "s"}</span>
            </div>

            {models.length === 0 ? (
              <EmptyEvidence />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {models.map((model) => <ModelEvidenceCard key={model.id} model={model} />)}
              </div>
            )}
          </section>

          <section aria-labelledby="freshness-title" className="rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-soft)] md:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="freshness-title" className="text-lg font-semibold tracking-tight">Instagram data updates</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Predictions use the latest synchronized data after retraining.
                </p>
              </div>
              <Link href="/niches" className="inline-flex min-h-10 items-center self-start rounded-lg px-2 text-sm font-semibold text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40">
                Manage brands
              </Link>
            </div>

            {connections.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                No Instagram connection information is available. Manage brand connections from Brands.
              </div>
            ) : (
              <ul className="mt-5 grid gap-3 md:grid-cols-2" aria-label="Instagram data freshness by brand">
                {connections.map((connection) => {
                  const connected = connection.status === "connected";
                  return (
                    <li key={connection.brand_id || `${connection.brand}-${connection.niche}`} className="rounded-2xl border border-border bg-surface-2/35 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{connection.brand}</p>
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {connected && connection.username ? `@${connection.username}` : connection.niche || "Industry unavailable"}
                          </p>
                        </div>
                        <StatusBadge
                          tone={connected ? "success" : connection.status === "error" ? "danger" : "warning"}
                          label={connected ? "Connected" : connection.status === "error" ? "Reconnect" : "Unavailable"}
                        />
                      </div>
                      <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">Last updated: {formatRelativeTime(connection.last_synced)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <details className="group rounded-2xl border border-border bg-surface p-5">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              Technical metrics
              <span className="ml-auto text-sm font-normal text-muted-foreground group-open:hidden">Show definitions</span>
            </summary>
            <dl className="mt-4 grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-2">
              <MetricDefinition term="Test accuracy" description="The share of recent test posts classified correctly. It may look stronger when one performance level dominates the data." />
              <MetricDefinition term="Macro F1" description="Checks performance across all levels so weaker results are not hidden by the most common level." />
              <MetricDefinition term="Balanced accuracy" description="Gives each observed performance level equal weight." />
              <MetricDefinition term="Gain vs benchmark" description="Compares the model with a simple rule that always selects the most common level." />
              <MetricDefinition term="Ready" description="The model passed the configured quality checks. Individual post results are still not guaranteed." />
              <MetricDefinition term="Use with caution" description="The model is available, but its supporting data or test results are limited." />
            </dl>
          </details>
        </>
      )}
    </div>
  );
}

function ModelEvidenceCard({ model }: { model: MlModel }) {
  const validated = model.evaluationStatus === "validated";
  const evaluated = model.evaluationStatus !== null;
  const holdoutAccuracy = model.baselineAccuracy;
  const scopeLabel = model.scope === "Personal" ? "Personalized" : "Uses niche data";

  return (
    <article className="rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-soft)] md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{scopeLabel}</p>
          <h3 className="mt-1 truncate text-lg font-semibold tracking-tight" title={model.name}>{model.name.split(": ")[1] || model.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{model.niche} · trained {model.trained}</p>
        </div>
        <StatusBadge
          tone={validated ? "success" : evaluated ? "warning" : "neutral"}
          label={validated ? "Ready" : evaluated ? "Use with caution" : "Not ready"}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
        <MetricCell label="Test accuracy" value={formatMetric(holdoutAccuracy)} />
        <MetricCell label="Precision and recall" value={formatMetric(model.macroF1)} />
        <MetricCell label="Accuracy across tiers" value={formatMetric(model.balancedAccuracy)} />
        <MetricCell label="Test posts" value={model.holdoutSamples == null ? "—" : model.holdoutSamples.toLocaleString()} />
      </div>

      <div className="mt-4 rounded-2xl bg-surface-2/60 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Improvement over a simple benchmark</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Benchmark {formatMetric(model.majorityBaselineAccuracy)}
            </p>
          </div>
          <span className={cn(
            "text-lg font-semibold tabular-nums",
            model.accuracyGain == null ? "text-muted-foreground" : model.accuracyGain > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-warning"
          )}>
            {model.accuracyGain == null ? "Comparison unavailable" : `${model.accuracyGain >= 0 ? "+" : ""}${model.accuracyGain.toFixed(1)} points`}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <span className="font-mono">Version {model.version}</span>
        <span>Trained with verified Instagram posts</span>
      </div>
    </article>
  );
}

function EvidenceSummary({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <div className="min-h-32 bg-surface p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{helper}</p>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-24 bg-surface-2/55 p-3.5">
      <p className="text-xs leading-snug text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function MetricDefinition({ term, description }: { term: string; description: string }) {
  return (
    <div>
      <dt className="font-semibold text-foreground">{term}</dt>
      <dd className="mt-1 leading-relaxed text-muted-foreground">{description}</dd>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "success" | "warning" | "danger" | "neutral" }) {
  return (
    <span className={cn(
      "inline-flex min-h-7 shrink-0 items-center rounded-full border px-2.5 text-xs font-semibold",
      tone === "success" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
      tone === "danger" && "border-destructive/25 bg-destructive/10 text-destructive",
      tone === "neutral" && "border-border bg-surface-2 text-muted-foreground"
    )}>{label}</span>
  );
}

function EmptyEvidence() {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-surface p-8 text-center">
      <h3 className="text-lg font-semibold">No prediction model yet</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
        Connect Instagram and complete synchronization and retraining to create a model.
      </p>
      <Link href="/niches" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        Review brands
      </Link>
    </div>
  );
}

function EvidenceSkeleton() {
  return (
    <div role="status" aria-label="Loading prediction quality" className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-32 motion-safe:animate-pulse rounded-2xl bg-surface-2" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((item) => <div key={item} className="h-72 motion-safe:animate-pulse rounded-3xl bg-surface-2" />)}
      </div>
      <span className="sr-only">Loading prediction and Instagram data status</span>
    </div>
  );
}

function formatMetric(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}
