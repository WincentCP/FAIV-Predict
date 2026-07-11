"use client";

import { fetchWithRetry } from "@/lib/fetch-retry";
import { useState, useEffect } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { type MlModel } from "@/lib/types";
import {
  Cpu,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  X,
  FileText,
  Activity,
  Instagram
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.2, 0, 0, 1] as const } },
};

type IgConnection = {
  brand: string;
  niche: string;
  last_synced: string | null;
  status: "connected" | "error" | "unreachable" | "unbound";
  username?: string;
  followers?: number;
  error?: string;
};

type TrainingState = "idle" | "running" | "success" | "failed" | "timeout";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days > 1) return `${days} days ago`;
  if (days === 1) return "yesterday";
  const hours = Math.floor(diffMs / 3600000);
  if (hours >= 1) return `${hours}h ago`;
  return "just now";
}

export default function ModelHealthPage() {
  const [models, setModels] = useState<MlModel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrainingModel, setRetrainingModel] = useState<MlModel | null>(null);
  const [logsOutput, setLogsOutput] = useState<any[] | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingState, setTrainingState] = useState<TrainingState>("idle");
  const [connections, setConnections] = useState<IgConnection[] | null>(null);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetchWithRetry("/api/models");
        const data = await res.json().catch(() => null);
        if (res.ok && Array.isArray(data)) {
          setModels(data);
          setLoadError(null);
        } else {
          setModels([]);
          setLoadError("The model registry could not be loaded.");
        }
      } catch {
        setModels([]);
        setLoadError("The model registry could not be loaded.");
      }
    }
    async function fetchConnections() {
      try {
        const res = await fetchWithRetry("/api/instagram-health");
        const data = await res.json().catch(() => null);
        if (res.ok && Array.isArray(data?.connections)) {
          setConnections(data.connections);
          setConnectionsError(null);
        } else {
          setConnections(null);
          setConnectionsError("Connection health is unavailable (ML service unreachable).");
        }
      } catch {
        setConnections(null);
        setConnectionsError("Connection health is unavailable (ML service unreachable).");
      }
    }
    fetchModels();
    fetchConnections();
  }, []);

  const startRetrain = async (model: MlModel) => {
    setRetrainingModel(model);
    setIsTraining(true);
    setTrainingState("running");
    setLogsOutput([]);

    const log = (step: string, message: string, status: "success" | "running" | "failed" | "resolved" = "success") => {
      const entry = {
        timestamp: new Date().toISOString(),
        step,
        status,
        message,
      };
      setLogsOutput((prev) => [...(prev || []), entry]);
    };

    log("initialize", `Retraining request sent for ${model.name}...`, "running");

    try {
      const res = await fetch("/api/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_id: model.scope === "Personal" ? model.brandId : undefined,
          niche: model.niche
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const data = await res.json();
      const jobId = data.job_id;
      if (!jobId) {
        throw new Error("Backend did not return a job id");
      }

      log("queue_job", `Job queued on the ML service. Job ID: ${jobId}`, "success");

      // Poll real job status from the backend
      let completed = false;
      let attempts = 0;
      const maxAttempts = 15;

      while (!completed && attempts < maxAttempts) {
        attempts++;
        await new Promise((r) => setTimeout(r, 1500));

        const statusRes = await fetch(`/api/train?job_id=${jobId}`);
        if (!statusRes.ok) {
          continue;
        }
        const statusData = await statusRes.json();
        if (statusData.status === "success") {
          completed = true;
          setTrainingState("success");
          const at = statusData.completed_at ? ` at ${statusData.completed_at}` : "";
          log("completed", `Retraining job completed successfully${at}.`, "success");
          break;
        } else if (statusData.status === "failed") {
          completed = true;
          setTrainingState("failed");
          log("retrain_failed", `Retraining failed: ${statusData.error_message || "Unknown error"}`, "failed");
          break;
        } else {
          log("poll_status", `Job status: ${statusData.status || "pending"} (attempt ${attempts}/${maxAttempts})`, "running");
        }
      }

      if (!completed) {
        setTrainingState("timeout");
        log("timeout", "Job did not complete within the polling window. Check back later.", "failed");
      }

    } catch (err: any) {
      console.error("Retraining API connection error:", err);
      setTrainingState("failed");
      log("connection_error", `Failed to complete retraining: ${err.message || "backend unreachable"}`, "failed");
    } finally {
      setIsTraining(false);
    }
  };

  const hasModels = models.length > 0;
  const recordedAccuracies = models
    .map((model) => model.baselineAccuracy)
    .filter((accuracy): accuracy is number => accuracy !== null);
  const avgAccuracy = recordedAccuracies.length > 0
    ? (recordedAccuracies.reduce((sum, accuracy) => sum + accuracy, 0) / recordedAccuracies.length).toFixed(1) + "%"
    : "—";

  const trainingLabel: Record<TrainingState, string> = {
    idle: "READY",
    running: "RUNNING",
    success: "SUCCEEDED",
    failed: "FAILED",
    timeout: "TIMED OUT",
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="relative px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto space-y-8 min-h-[100dvh]"
    >
      <motion.div variants={itemVariants}>
        <SectionHeader
          eyebrow="Model Health"
          title="AI Model Performance"
          description="Validation accuracy for each trained classifier, recorded at training time. Retrain a model to refresh its metrics."
        />
      </motion.div>

      {loadError && (
        <motion.div
          variants={itemVariants}
          className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4 flex items-center gap-3 text-xs"
        >
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="font-semibold text-destructive">{loadError}</span>
        </motion.div>
      )}

      {/* Summary Widgets */}
      <motion.section variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Current Models"
          value={models.length.toString()}
          tone="primary"
        />
        <SummaryCard
          label="Average Model Accuracy"
          value={avgAccuracy}
          tone="lime"
        />
        <SummaryCard
          label="Models Tracked"
          value={models.length.toString()}
          tone="destructive"
        />
      </motion.section>

      {/* Instagram Data Connections */}
      <motion.section variants={itemVariants} className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
          <Instagram className="h-3.5 w-3.5" />
          Data Connections
        </div>
        {connectionsError && (
          <div className="rounded-xl border border-border bg-surface/70 p-4 text-xs text-muted-foreground">
            {connectionsError}
          </div>
        )}
        {connections && connections.length === 0 && (
          <div className="rounded-xl border border-border bg-surface/70 p-4 text-xs text-muted-foreground">
            No Instagram accounts are linked. Configure the Graph API credentials in the ML
            service environment to enable the weekly sync.
          </div>
        )}
        {connections && connections.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {connections.map((c) => {
              const healthy = c.status === "connected";
              return (
                <div
                  key={c.brand}
                  className="rounded-2xl border border-border bg-surface/70 backdrop-blur-xl p-5 shadow-[var(--shadow-soft)] flex items-start justify-between gap-4"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-bold text-foreground truncate">{c.brand}</span>
                      <span className="text-xs font-semibold text-muted-foreground shrink-0">{c.niche}</span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {healthy ? (
                        <>@{c.username} · {c.followers?.toLocaleString()} followers</>
                      ) : (
                        <span className="text-destructive" title={c.error}>
                          {c.status === "error"
                            ? "Access token rejected — regenerate it in the Meta developer console."
                            : "Instagram API unreachable."}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground/70">
                      Latest synced post: {timeAgo(c.last_synced)}
                    </div>
                  </div>
                  {healthy ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-600 uppercase tracking-wide shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 border border-destructive/25 px-2.5 py-1 text-xs font-bold text-destructive uppercase tracking-wide shrink-0">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Broken
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </motion.section>

      {/* Table grid */}
      <motion.section
        variants={itemVariants}
        className="overflow-hidden rounded-2xl border border-border bg-surface/70 backdrop-blur-xl shadow-[var(--shadow-soft)]"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[970px] table-fixed text-sm text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2/30 text-xs uppercase tracking-wider text-muted-foreground font-bold">
                <th className="w-[240px] px-6 py-5">Model ID</th>
                <th className="w-[140px] px-6 py-5">Niche Scope</th>
                <th className="w-[100px] px-6 py-5">Version</th>
                <th className="w-[180px] px-6 py-5">Model Accuracy</th>
                <th className="w-[120px] px-6 py-5">Status</th>
                <th className="w-[170px] px-6 py-5 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {models.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-xs text-muted-foreground">
                    No trained models registered yet. Models appear here after the first training run.
                  </td>
                </tr>
              )}
              {models.map((m) => {
                const isPersonal = m.scope === "Personal";

                // The API returns only the newest model for each owned scope.
                // Drift/retirement telemetry is not captured, so do not invent
                // an active/inactive state the database does not contain.
                const statusBadge = (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    Current
                  </span>
                );

                return (
                  <tr key={m.id} className="hover:bg-surface-2/40 transition-colors group">
                    <td className="px-6 py-5 align-middle">
                      <div className="flex flex-col gap-1.5 items-start min-w-0">
                        {isPersonal ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent-lime/10 border border-accent-lime/30 px-2.5 py-0.5 text-xs font-bold text-accent-lime-strong uppercase tracking-wider shrink-0">
                            <CheckCircle2 className="h-2.5 w-2.5 text-accent-lime-strong" />
                            Personal Model
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs font-bold text-primary uppercase tracking-wider shrink-0">
                            <Cpu className="h-2.5 w-2.5" />
                            Niche Model
                          </span>
                        )}
                        <span className="font-mono text-xs font-bold text-foreground truncate max-w-full" title={m.name}>
                          {m.name.split(": ")[1] || m.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5 align-middle text-xs text-muted-foreground font-semibold truncate" title={m.niche}>{m.niche}</td>
                    <td className="px-6 py-5 align-middle">
                      <span className="rounded-lg bg-surface-3 border border-border px-2.5 py-1 font-mono text-xs font-bold text-muted-foreground/90">
                        {m.version}
                      </span>
                    </td>
                    <td className="px-6 py-5 align-middle font-mono text-xs font-bold tabular-nums text-foreground">
                      <div>
                        <span className="text-sm font-black text-foreground">
                          {m.baselineAccuracy === null ? "Not recorded" : `${m.baselineAccuracy.toFixed(1)}%`}
                        </span>
                        <div className="mt-1 text-xs font-semibold leading-none text-muted-foreground">
                          {m.baselineAccuracy === null ? "Retrain to capture validation" : "Validated on newest holdout"}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5 align-middle whitespace-nowrap">{statusBadge}</td>
                    <td className="px-6 py-5 align-middle text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => startRetrain(m)}
                        className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-all active:scale-95 border shrink-0 bg-surface text-muted-foreground border-border hover:bg-surface-2 hover:text-foreground hover:border-border-strong"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Retrain
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* Retrain Console Log Dialog Modal */}
      <AnimatePresence>
        {retrainingModel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-4 backdrop-blur-sm"
            onClick={() => !isTraining && setRetrainingModel(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="retraining-dialog-title"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              className="relative w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden rounded-3xl border border-border bg-surface/90 backdrop-blur-2xl shadow-[var(--shadow-elevated)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-border p-6 shrink-0">
                <div>
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                    <RefreshCw className={cn("h-3 w-3", trainingState === "running" && "animate-spin")} />
                    Retraining Pipeline
                  </div>
                  <h3 id="retraining-dialog-title" className="mt-2 font-display text-base font-bold text-foreground">
                    Retraining Console: {retrainingModel.name.split(": ")[1] || retrainingModel.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Triggering automated retraining and validation checks.
                  </p>
                </div>
                <button
                  onClick={() => !isTraining && setRetrainingModel(null)}
                  disabled={isTraining}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                {/* Summary panel */}
                <div className="grid gap-3 grid-cols-3 bg-surface-2/60 border border-border rounded-xl p-4 text-xs font-semibold">
                  <div>
                    <span className="text-muted-foreground uppercase text-xs block">Model ID</span>
                    <span className="font-mono mt-0.5 block text-foreground truncate" title={retrainingModel.id}>{retrainingModel.id}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground uppercase text-xs block">Current Version</span>
                    <span className="font-mono mt-0.5 block text-foreground truncate" title={retrainingModel.version}>
                      {retrainingModel.version}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground uppercase text-xs block">Pipeline Status</span>
                    <span className={cn(
                      "mt-0.5 block font-bold",
                      trainingState === "running" && "text-primary",
                      trainingState === "success" && "text-emerald-700 dark:text-emerald-400",
                      (trainingState === "failed" || trainingState === "timeout") && "text-destructive"
                    )}>
                      {trainingLabel[trainingState]}
                    </span>
                  </div>
                </div>

                {/* JSON Logs Console Terminal */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                    <span className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      Pipeline Logs
                    </span>
                    <span>{isTraining ? "streaming..." : "idle"}</span>
                  </div>
                  <div className="h-48 sm:h-60 w-full rounded-xl border border-border-strong bg-slate-950 p-4 font-mono text-xs text-slate-300 overflow-y-auto leading-relaxed shadow-inner" aria-live="polite" aria-atomic="false">
                    {logsOutput && logsOutput.map((log, index) => (
                      <div key={index} className="whitespace-pre-wrap py-0.5">
                        <span className="text-slate-500 mr-2">[{log.timestamp.split("T")[1].replace("Z", "")}]</span>{" "}
                        <span className="text-primary font-bold mr-2">&gt;&gt; {log.step.toUpperCase()}:</span>{" "}
                        <span className={cn(
                          "font-semibold",
                          log.status === "failed" ? "text-red-400" : "text-emerald-400"
                        )}>{log.message}</span>
                      </div>
                    ))}
                    {isTraining && (
                      <div className="flex items-center gap-1.5 mt-1 text-slate-500 motion-safe:animate-pulse">
                        <span className="h-1.5 w-1.5 bg-slate-400 rounded-full motion-safe:animate-ping shrink-0" />
                        <span>waiting for next step runner...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/40 p-4 shrink-0">
                <button
                  onClick={() => setRetrainingModel(null)}
                  disabled={isTraining}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/95 disabled:opacity-50 transition-colors"
                >
                  Close Logs Console
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}



function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "primary" | "lime" | "destructive";
}) {
  const bg =
    tone === "primary"
      ? "color-mix(in oklab, hsl(var(--primary)) 6%, hsl(var(--surface)))"
      : tone === "lime"
      ? "color-mix(in oklab, hsl(var(--accent-lime)) 8%, hsl(var(--surface)))"
      : "color-mix(in oklab, hsl(var(--destructive)) 6%, hsl(var(--surface)))";
  const border =
    tone === "primary"
      ? "border-primary/20 hover:border-primary/45"
      : tone === "lime"
      ? "border-accent-lime/35 hover:border-accent-lime-strong/50"
      : "border-destructive/20 hover:border-destructive/45";
  const text =
    tone === "primary"
      ? "text-primary"
      : tone === "lime"
      ? "text-[oklch(0.42_0.18_130)] dark:text-[oklch(0.82_0.20_130)]"
      : "text-destructive";
  const Icon = tone === "primary" ? Cpu : tone === "lime" ? Activity : AlertTriangle;

  return (
    <motion.div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-6 transition-colors duration-200 shadow-[var(--shadow-soft)] flex items-start justify-between gap-4",
        border
      )}
      style={{ background: bg }}
    >
      <div className="relative z-10 space-y-3">
        <div className="text-xs font-bold text-muted-foreground leading-none">
          {label}
        </div>
        <div className="font-display text-3xl font-extrabold text-foreground tabular-nums tracking-tight leading-none">
          {value}
        </div>
      </div>
      <div className={cn("relative z-10 grid h-10 w-10 place-items-center rounded-xl bg-surface/80 border border-border/40 shrink-0 shadow-sm", text)}>
        <Icon className="h-5 w-5" />
      </div>
    </motion.div>
  );
}
