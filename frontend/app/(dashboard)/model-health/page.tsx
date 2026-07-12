"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Database,
  RefreshCw,
  ShieldCheck,
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
  if (!iso) return "No verified sync yet";
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "Sync time unavailable";
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
        fetchWithRetry("/api/instagram-health"),
      ]);
      const [modelPayload, connectionPayload] = await Promise.all([
        modelsRes.json().catch(() => null),
        connectionsRes.json().catch(() => null),
      ]);

      if (!modelsRes.ok || !Array.isArray(modelPayload)) {
        throw new Error("The model registry could not be loaded.");
      }

      setModels(modelPayload);
      setConnections(
        connectionsRes.ok && Array.isArray(connectionPayload?.connections)
          ? connectionPayload.connections
          : []
      );
      if (!connectionsRes.ok) {
        setLoadError("Model evidence is available, but Instagram freshness could not be verified.");
      }
      setState("ready");
    } catch (error: unknown) {
      setModels([]);
      setConnections([]);
      setState("error");
      setLoadError(error instanceof Error ? error.message : "Research evidence is temporarily unavailable.");
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
        eyebrow="Methods & evidence"
        title="Research Evidence"
        description="Review the data provenance and held-out evaluation recorded when each model was trained. This is thesis evidence, not live production monitoring."
        actions={
          <button
            type="button"
            onClick={loadEvidence}
            disabled={state === "loading"}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", state === "loading" && "animate-spin")} aria-hidden="true" />
            Refresh evidence
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
              <EvidenceSummary label="Current models" value={models.length} helper="Latest version per scope" icon={Database} />
              <EvidenceSummary label="Thesis-validated" value={summary.validated} helper={`${summary.evaluated} with evaluation records`} icon={ShieldCheck} />
              <EvidenceSummary label="Exploratory" value={summary.exploratory} helper="Interpret with stated limitations" icon={AlertTriangle} tone="warning" />
              <EvidenceSummary label="Connected brands" value={summary.freshConnections} helper="Live identity check passed" icon={CheckCircle2} />
            </div>
            <h2 id="evidence-summary-title" className="sr-only">Research evidence summary</h2>
          </section>

          <section aria-labelledby="model-evidence-title" className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="model-evidence-title" className="text-xl font-semibold tracking-tight">Model evaluation records</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Scores below come from held-out data recorded at training time. Green status means the thesis criteria passed; it does not imply universal production validity.
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
                <h2 id="freshness-title" className="text-lg font-semibold tracking-tight">Verified data freshness</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Connection status confirms identity and access. Model evaluation changes only after the synchronized dataset is retrained.
                </p>
              </div>
              <Link href="/niches" className="inline-flex min-h-10 items-center gap-1.5 self-start rounded-lg px-2 text-sm font-semibold text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40">
                Manage brands <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            {connections.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                No live connection evidence is available. Brand setup and administrator-assisted Instagram authorization are managed from Brands.
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
                          label={connected ? "Verified" : connection.status === "error" ? "Reconnect" : "Unavailable"}
                        />
                      </div>
                      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-sm text-muted-foreground">
                        <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>Latest synced post: {formatRelativeTime(connection.last_synced)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <details className="group rounded-2xl border border-border bg-surface p-5">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <CircleHelp className="h-5 w-5 text-primary" aria-hidden="true" />
              How to read these metrics
              <span className="ml-auto text-sm font-normal text-muted-foreground group-open:hidden">Show definitions</span>
            </summary>
            <dl className="mt-4 grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-2">
              <MetricDefinition term="Held-out accuracy" description="The share of unseen evaluation samples classified correctly. It can look optimistic when classes are imbalanced." />
              <MetricDefinition term="Macro F1" description="F1 calculated for each class and averaged equally, so weak minority-class performance remains visible." />
              <MetricDefinition term="Balanced accuracy" description="Average recall across classes. This gives each observed class equal importance." />
              <MetricDefinition term="Gain vs majority" description="Held-out accuracy minus a simple classifier that always predicts the most common class." />
              <MetricDefinition term="Validated for thesis evidence" description="The recorded evaluation passed this project's declared scientific checks; it is not a claim of universal validity." />
              <MetricDefinition term="Exploratory" description="The model can support a demonstration, but its recorded limitations must be disclosed when interpreting predictions." />
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
  const scopeLabel = model.scope === "Personal" ? "Brand-specific model" : "Industry cohort model";

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
          label={validated ? "Validated for thesis" : evaluated ? "Exploratory" : "Not evaluated"}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
        <MetricCell label="Held-out accuracy" value={formatMetric(holdoutAccuracy)} />
        <MetricCell label="Macro F1" value={formatMetric(model.macroF1)} />
        <MetricCell label="Balanced accuracy" value={formatMetric(model.balancedAccuracy)} />
        <MetricCell label="Holdout samples" value={model.holdoutSamples == null ? "—" : model.holdoutSamples.toLocaleString()} />
      </div>

      <div className="mt-4 rounded-2xl bg-surface-2/60 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Comparison with majority-class baseline</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Baseline {formatMetric(model.majorityBaselineAccuracy)}
            </p>
          </div>
          <span className={cn(
            "text-lg font-semibold tabular-nums",
            model.accuracyGain == null ? "text-muted-foreground" : model.accuracyGain > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-warning"
          )}>
            {model.accuracyGain == null ? "Gain unavailable" : `${model.accuracyGain >= 0 ? "+" : ""}${model.accuracyGain.toFixed(1)} pp`}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <span className="font-mono">Version {model.version}</span>
        <span className="font-mono truncate" title={model.id}>Record {model.id.slice(0, 8)}…</span>
        <span>Verified Instagram training provenance</span>
      </div>
    </article>
  );
}

function EvidenceSummary({ label, value, helper, icon: Icon, tone = "default" }: { label: string; value: number; helper: string; icon: typeof Database; tone?: "default" | "warning" }) {
  return (
    <div className="flex min-h-32 items-start justify-between gap-4 bg-surface p-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{helper}</p>
      </div>
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone === "warning" ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary")}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
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
      <Database className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <h3 className="mt-4 text-lg font-semibold">No evaluation record yet</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
        Models appear after verified Instagram data has been synchronized and the sync/retrain workflow completes.
      </p>
      <Link href="/niches" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background">
        Review brand readiness <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function EvidenceSkeleton() {
  return (
    <div role="status" aria-label="Loading research evidence" className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-32 motion-safe:animate-pulse rounded-2xl bg-surface-2" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((item) => <div key={item} className="h-72 motion-safe:animate-pulse rounded-3xl bg-surface-2" />)}
      </div>
      <span className="sr-only">Loading model and data evidence</span>
    </div>
  );
}

function formatMetric(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}
