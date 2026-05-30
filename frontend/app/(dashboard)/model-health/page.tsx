"use client";

import { useState } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { MODELS, type MlModel } from "@/lib/mock-data";
import {
  Cpu,
  CheckCircle2,
  PauseCircle,
  RefreshCw,
  TrendingDown,
  AlertTriangle,
  X,
  FileText,
  TrendingUp,
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";

const MOCK_TRAINING_LOGS = [
  { timestamp: "2026-05-28T15:30:00Z", step: "load_dataset", status: "success", rows_loaded: 412 },
  { timestamp: "2026-05-28T15:30:05Z", step: "validate_schema", status: "success", features: ["media_type", "posting_hour", "caption_length", "hashtag_count", "posting_day", "has_cta"] },
  { timestamp: "2026-05-28T15:30:08Z", step: "split_train_test", status: "success", train_size: 329, test_size: 83 },
  { timestamp: "2026-05-28T15:30:10Z", step: "initialize_random_forest", status: "success", n_estimators: 150, max_depth: 12 },
  { timestamp: "2026-05-28T15:30:15Z", step: "fit_niche_estimator", status: "success", oob_score: 0.824 },
  { timestamp: "2026-05-28T15:30:20Z", step: "evaluate_metrics", status: "success", baseline_accuracy: 0.81, new_accuracy: 0.852 },
  { timestamp: "2026-05-28T15:30:22Z", step: "export_onnx_model", status: "success", path: "s3://faiv-models/lasence-bakeshop/v2.5.4.onnx" },
  { timestamp: "2026-05-28T15:30:23Z", step: "concept_drift_check", status: "resolved", drift_pct: 2.1 }
];

export default function ModelHealthPage() {
  const [retrainingModel, setRetrainingModel] = useState<MlModel | null>(null);
  const [logsOutput, setLogsOutput] = useState<typeof MOCK_TRAINING_LOGS | null>(null);
  const [isTraining, setIsTraining] = useState(false);

  const startRetrain = async (model: MlModel) => {
    setRetrainingModel(model);
    setIsTraining(true);
    setLogsOutput([]);
    
    // Simulate streaming logs one by one
    for (let i = 0; i < MOCK_TRAINING_LOGS.length; i++) {
      await new Promise((r) => setTimeout(r, 250));
      setLogsOutput((prev) => [...(prev || []), MOCK_TRAINING_LOGS[i]]);
    }
    setIsTraining(false);
  };

  const handleGlobalRetrain = () => {
    // Find the first drifted or active model to retrain
    const target = MODELS.find(m => m.baselineAccuracy - m.rollingAccuracy > 15) || MODELS[0];
    startRetrain(target);
  };

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto space-y-8">
      <SectionHeader
        eyebrow="Model Health"
        title="AI Model Performance"
        description="Live accuracy diagnostics for AI classifiers. Automated warnings trigger when rolling accuracy drops below category benchmarks."
        actions={
          <button
            type="button"
            onClick={handleGlobalRetrain}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-xs font-bold text-foreground transition-all hover:bg-surface-2 active:scale-[0.98]"
          >
            <RefreshCw className="h-4 w-4" />
            Trigger manual retrain
          </button>
        }
      />

      {/* Summary Widgets */}
      <section className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Active Models"
          value={MODELS.filter((m) => m.is_active).length.toString()}
          tone="primary"
        />
        <SummaryCard
          label="Average Rolling Accuracy"
          value={`${(
            MODELS.reduce((s, m) => s + m.rollingAccuracy, 0) / MODELS.length
          ).toFixed(1)}%`}
          tone="lime"
        />
        <SummaryCard
          label="Accuracy Alerts"
          value={MODELS.filter((m) => m.baselineAccuracy - m.rollingAccuracy > 15).length.toString()}
          tone="destructive"
        />
      </section>

      {/* Table grid */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[970px] table-fixed text-sm text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                <th className="w-[220px] px-6 py-4.5">Model ID</th>
                <th className="w-[130px] px-6 py-4.5">Niche Scope</th>
                <th className="w-[80px] px-6 py-4.5">Version</th>
                <th className="w-[100px] px-6 py-4.5">Baseline Acc.</th>
                <th className="w-[140px] px-6 py-4.5">30d Rolling Acc.</th>
                <th className="w-[90px] px-6 py-4.5">Historical Trend</th>
                <th className="w-[110px] px-6 py-4.5">Health Status</th>
                <th className="w-[100px] px-6 py-4.5 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {MODELS.map((m, i) => {
                const drop = m.baselineAccuracy - m.rollingAccuracy;
                const isPersonal = m.scope === "Personal";

                // Concept Drift Status Badges logic:
                // Stable: drop <= 5% (solid green)
                // Watch: drop between 5% - 15% (amber yellow)
                // Drift Detected: drop > 15% (pulsing red)
                let driftBadge = (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[10px] font-bold text-emerald-600 uppercase tracking-wide">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    Stable
                  </span>
                );

                if (drop > 15) {
                  driftBadge = (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/25 px-2.5 py-1 text-[10px] font-extrabold text-red-500 uppercase tracking-wide shadow-[0_0_12px_rgba(239,68,68,0.3)] animate-pulse">
                      <TrendingDown className="h-3 w-3" />
                      Attention
                    </span>
                  );
                } else if (drop > 5) {
                  driftBadge = (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-[10px] font-bold text-amber-600 uppercase tracking-wide">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0 animate-pulse" />
                      Watch
                    </span>
                  );
                }

                return (
                  <tr key={m.id} className="hover:bg-surface-2/40 transition-colors">
                    <td className="px-6 py-4.5">
                      <div className="flex flex-col gap-1.5 items-start min-w-0">
                        {isPersonal ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent-lime/10 border border-accent-lime/30 px-2.5 py-0.5 text-[9px] font-bold text-accent-lime-strong uppercase tracking-wider shrink-0">
                            <CheckCircle2 className="h-2.5 w-2.5 text-accent-lime-strong" />
                            Personal Model
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[9px] font-bold text-primary uppercase tracking-wider shrink-0">
                            <Cpu className="h-2.5 w-2.5" />
                            Niche Model
                          </span>
                        )}
                        <span className="font-mono text-xs font-bold text-foreground truncate max-w-full" title={m.name}>
                          {m.name.split(": ")[1] || m.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4.5 text-xs text-muted-foreground font-semibold truncate" title={m.niche}>{m.niche}</td>
                    <td className="px-6 py-4.5">
                      <span className="rounded-lg bg-surface-3 border border-border px-2.5 py-1 font-mono text-[10px] font-bold text-muted-foreground/90">
                        {m.version}
                      </span>
                    </td>
                    <td className="px-6 py-4.5 font-mono text-xs font-bold tabular-nums text-foreground">{m.baselineAccuracy.toFixed(1)}%</td>
                    <td className="px-6 py-4.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-2 w-12 overflow-hidden rounded-full bg-surface-3 border border-border/40 shrink-0">
                          <div
                            className={cn("h-full rounded-full transition-all duration-500", drop > 15 ? "bg-red-500" : "bg-primary")}
                            style={{ width: `${m.rollingAccuracy}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs font-bold tabular-nums text-foreground shrink-0">
                          {m.rollingAccuracy.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4.5">
                      <Sparkline values={m.rolling30d} isDrift={drop > 15} />
                    </td>
                    <td className="px-6 py-4.5">{driftBadge}</td>
                    <td className="px-6 py-4.5 text-right">
                      <button
                        type="button"
                        onClick={() => startRetrain(m)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[10px] font-bold transition-all active:scale-95 border shrink-0",
                          drop > 15
                            ? "bg-red-500 text-white border-red-600 hover:bg-red-600 shadow-[0_0_12px_rgba(239,68,68,0.25)]"
                            : "bg-surface text-muted-foreground border-border hover:bg-surface-2 hover:text-foreground hover:border-border-strong"
                        )}
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
      </section>

      {/* Manual Retrain Summary Dialog and JSON Logs Console */}
      {retrainingModel && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm"
          onClick={() => setRetrainingModel(null)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border p-6 shrink-0">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-primary">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  GitHub Actions Runner
                </div>
                <h3 className="mt-2 font-display text-base font-bold text-foreground">
                  Retraining Console: {retrainingModel.name.split(": ")[1] || retrainingModel.name}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Triggering automated retraining and validation checks.
                </p>
              </div>
              <button
                onClick={() => setRetrainingModel(null)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Summary panel */}
              <div className="grid gap-3 grid-cols-3 bg-surface-2/60 border border-border rounded-xl p-4 text-xs font-semibold">
                <div>
                  <span className="text-muted-foreground uppercase text-[9px] block">Model ID</span>
                  <span className="font-mono mt-0.5 block text-foreground truncate" title={retrainingModel.id}>{retrainingModel.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase text-[9px] block">Target Version</span>
                  <span className="font-mono mt-0.5 block text-foreground">
                    {retrainingModel.version.replace(/(\d+)$/, (m) => String(parseInt(m, 10) + 1))}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase text-[9px] block">Pipeline Status</span>
                  <span className={cn(
                    "mt-0.5 block font-bold",
                    isTraining ? "text-primary animate-pulse" : "text-emerald-600"
                  )}>
                    {isTraining ? "RUNNING" : "COMPLETED"}
                  </span>
                </div>
              </div>

              {/* JSON Logs Console Terminal */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Pipeline Logs
                  </span>
                  <span>{isTraining ? "streaming..." : "idle"}</span>
                </div>
                <div className="h-48 sm:h-60 w-full rounded-xl border border-border-strong bg-slate-950 p-4 font-mono text-[11px] text-slate-300 overflow-y-auto leading-relaxed shadow-inner">
                  {logsOutput && logsOutput.map((log, index) => {
                    const formatLogMessage = (l: any) => {
                      switch (l.step) {
                        case "load_dataset":
                          return `Loaded ${l.rows_loaded} rows from dataset database successfully.`;
                        case "validate_schema":
                          return `Schema validation completed. ${l.features?.length || 0} features matched.`;
                        case "split_train_test":
                          return `Data partition complete: ${l.train_size} training samples, ${l.test_size} validation samples.`;
                        case "initialize_random_forest":
                          return `Model parameters set: n_estimators=${l.n_estimators}, max_depth=${l.max_depth}.`;
                        case "fit_niche_estimator":
                          return `Estimator fit successful. Out-of-bag (OOB) score: ${l.oob_score?.toFixed(4)}.`;
                        case "evaluate_metrics": {
                          const diff = ((l.new_accuracy || 0) - (l.baseline_accuracy || 0)) * 100;
                          return `Performance check: baseline = ${(l.baseline_accuracy * 100).toFixed(1)}%, rolling = ${(l.new_accuracy * 100).toFixed(1)}% (${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%).`;
                        }
                        case "export_onnx_model":
                          return `Serialized & exported ONNX artifact to: ${l.path}`;
                        case "concept_drift_check":
                          return `Drift diagnostics: detected drift = ${l.drift_pct}% -> STATUS: ${l.status.toUpperCase()}.`;
                        default:
                          return JSON.stringify(l);
                      }
                    };
                    return (
                      <div key={index} className="whitespace-pre-wrap py-0.5">
                        <span className="text-slate-500 mr-2">[{log.timestamp.split("T")[1].replace("Z", "")}]</span>{" "}
                        <span className="text-primary font-bold mr-2">&gt;&gt; {log.step.toUpperCase()}:</span>{" "}
                        <span className="text-emerald-400 font-semibold">{formatLogMessage(log)}</span>
                      </div>
                    );
                  })}
                  {isTraining && (
                    <div className="flex items-center gap-1.5 mt-1 text-slate-500 animate-pulse">
                      <span className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-ping shrink-0" />
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
          </div>
        </div>
      )}
    </div>
  );
}

function Sparkline({ values, isDrift }: { values: number[]; isDrift: boolean }) {
  const w = 80;
  const h = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke = isDrift ? "hsl(var(--destructive))" : "hsl(var(--primary))";
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
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
      ? "color-mix(in oklab, hsl(var(--primary)) 5%, hsl(var(--surface)))"
      : tone === "lime"
      ? "color-mix(in oklab, hsl(var(--accent-lime)) 6%, hsl(var(--surface)))"
      : "color-mix(in oklab, hsl(var(--destructive)) 5%, hsl(var(--surface)))";
  const border =
    tone === "primary"
      ? "border-primary/20"
      : tone === "lime"
      ? "border-accent-lime/30"
      : "border-destructive/20";
  const text =
    tone === "primary"
      ? "text-primary"
      : tone === "lime"
      ? "text-[oklch(0.42_0.18_130)] dark:text-[oklch(0.82_0.20_130)]"
      : "text-destructive";

  const Icon = tone === "primary" ? Cpu : tone === "lime" ? Activity : AlertTriangle;

  return (
    <div
      className={cn("rounded-2xl border p-6 shadow-[var(--shadow-soft)] hover:shadow-md transition-all hover:bg-surface/90 relative overflow-hidden flex items-start justify-between gap-4", border)}
      style={{ background: bg }}
    >
      <div className="space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80 leading-none">
          {label}
        </div>
        <div className="font-display text-3xl font-extrabold text-foreground tabular-nums tracking-tight leading-none">
          {value}
        </div>
      </div>
      <div className={cn("grid h-10 w-10 place-items-center rounded-xl bg-surface/50 border border-border/40 shrink-0", text)}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}
