"use client";

import { fetchWithRetry } from "@/lib/fetch-retry";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import { type Brand } from "@/lib/types";
import dynamic from "next/dynamic";

const DashboardChart = dynamic(() => import("@/components/DashboardChart"), {
  ssr: false,
  loading: () => <div className="h-[260px] w-full motion-safe:animate-pulse bg-muted/40 rounded-xl" />,
});

import {
  ArrowUpRight,
  History,
  AlertTriangle,
  TrendingUp,
  Activity,
  Target,
  BarChart3,
  Users,
  ShieldCheck,
  Building2,
  ArrowRight,
} from "lucide-react";
import { motion, Variants } from "framer-motion";


const KPI_DEFINITIONS = [
  {
    id: "predictions",
    label: "Total Predictions",
    value: "—",
    sub: "Loading verified data",
    colorClass: "text-success bg-success/10 border-success/20",
    iconColor: "text-success",
    glowColor: "hsl(var(--success) / 0.2)",
    icon: Activity,
  },
  {
    id: "accounts",
    label: "Brand Workspaces",
    value: "—",
    sub: "Loading verified data",
    colorClass: "text-chart-3 bg-chart-3/10 border-chart-3/20",
    iconColor: "text-chart-3",
    glowColor: "hsl(var(--chart-3) / 0.2)",
    icon: Users,
  },
  {
    id: "models",
    label: "Available Models",
    value: "—",
    sub: "Loading verified data",
    colorClass: "text-primary bg-primary/10 border-primary/20",
    iconColor: "text-primary",
    glowColor: "hsl(var(--primary) / 0.2)",
    icon: ShieldCheck,
  },
  {
    id: "confidence",
    label: "Average Confidence",
    value: "—",
    sub: "Loading verified data",
    colorClass: "text-warning bg-warning/10 border-warning/20",
    iconColor: "text-warning",
    glowColor: "hsl(var(--warning) / 0.2)",
    icon: TrendingUp,
  },
];

export default function DashboardPage() {
  const [brandsList, setBrandsList] = useState<Brand[]>([]);
  const [isWorkspaceEmpty, setIsWorkspaceEmpty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [accuracyTrend, setAccuracyTrend] = useState<{ label: string; accuracy: number; scope: string }[]>([]);
  const [tierDistribution, setTierDistribution] = useState<Array<{
    tier: "High" | "Average" | "Low";
    count: number;
    color: string;
  }>>([]);

  const personalCount = useMemo(() => {
    return brandsList.filter((b) => b.active_model_scope === "personal").length;
  }, [brandsList]);

  const [kpis, setKpis] = useState(KPI_DEFINITIONS);
  const [recentPredictions, setRecentPredictions] = useState<any[]>([]);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await fetchWithRetry("/api/dashboard");
        if (!res.ok) {
          setLoadError("Workspace metrics could not be loaded right now.");
          return;
        }
        {
          const data = await res.json();
          setLoadError(null);

          setKpis((prev) =>
            prev.map((kpi) => {
              if (kpi.id === "predictions" && data.totalPredictions !== undefined) {
                return { ...kpi, value: data.totalPredictions.toLocaleString(), sub: data.totalPredictions === 0 ? "No predictions recorded" : "Authenticated workspace only" };
              }
              if (kpi.id === "models" && data.totalModels !== undefined) {
                return { ...kpi, value: data.totalModels.toString(), sub: data.totalModels === 0 ? "No models available" : "Latest account and cohort scopes" };
              }
              if (kpi.id === "accounts" && data.totalBrands !== undefined) {
                return { ...kpi, value: data.totalBrands.toString(), sub: `${data.totalBrands} registered brand${data.totalBrands === 1 ? "" : "s"}` };
              }
              if (kpi.id === "confidence" && data.avgConfidence !== undefined) {
                return { ...kpi, value: data.avgConfidence, sub: data.avgConfidence === "—" ? "No confidence values recorded" : "Across recent predictions" };
              }
              return kpi;
            })
          );

          if (data.highCount !== undefined) {
            setTierDistribution([
              { tier: "High" as const, count: data.highCount, color: "hsl(var(--primary))" },
              { tier: "Average" as const, count: data.avgCount, color: "hsl(var(--warning))" },
              { tier: "Low" as const, count: data.lowCount, color: "hsl(var(--foreground) / 0.35)" },
            ]);
          }

          if (data.accuracyTrend && data.accuracyTrend.length > 0) {
            setAccuracyTrend(data.accuracyTrend);
          }

          if (data.recent && data.recent.length > 0) {
            const mappedRecent = data.recent.map((r: any) => ({
              id: r.id,
              account: r.brand || "Unknown Brand",
              caption: r.caption,
              tier: r.tier as any,
              confidence: r.confidence ?? null,
              when: new Date(r.when).toLocaleDateString()
            }));
            setRecentPredictions(mappedRecent);
          }
        }
      } catch (err) {
        console.warn("Could not fetch dashboard metrics aggregates:", err);
        setLoadError("Workspace metrics could not be loaded right now.");
      } finally {
        setDashboardLoaded(true);
      }
    }

    async function fetchBrands() {
      try {
        const res = await fetchWithRetry("/api/brands");
        if (res.ok) {
          const data = await res.json();
          setBrandsList(data || []);
          setIsWorkspaceEmpty((data || []).length === 0);
        } else {
          setIsWorkspaceEmpty(false);
          setLoadError((current) => current || "Brand workspaces could not be loaded right now.");
        }
      } catch (err) {
        console.warn("Could not fetch brands on dashboard mount:", err);
        setIsWorkspaceEmpty(false);
        setLoadError((current) => current || "Brand workspaces could not be loaded right now.");
      }
    }

    fetchDashboard();
    fetchBrands();
  }, []);

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.04,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.2, 0, 0, 1] } },
  };

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="px-5 py-6 md:px-10 md:py-8 space-y-6 max-w-7xl mx-auto"
    >
      {/* First-run guidance: shown only when the workspace has no brands yet */}
      {isWorkspaceEmpty && (
        <motion.section
          variants={itemVariants}
          className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-primary/[0.04] p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">Set up your workspace</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Register your first brand to unlock predictions. Everything else — models,
                history, and this dashboard — builds on it.
              </p>
            </div>
          </div>
          <Link
            href="/niches"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98]"
          >
            Register a brand
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </motion.section>
      )}

      {/* Compact workspace header */}
      <motion.section
        variants={itemVariants}
        className="rounded-2xl border border-border-strong bg-surface p-6 shadow-[var(--shadow-soft)] md:p-8"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-bold text-primary">
              <Building2 className="h-4 w-4" />
              Workspace overview
            </div>
            <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">
              Make the next post a stronger decision.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Review verified workspace activity, then analyze a real draft with the latest available model.
            </p>
          </div>
          <Link
            href="/predict"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/92 active:scale-[0.98]"
          >
            <Activity className="h-4 w-4" />
            Analyze a post
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4 text-xs font-semibold text-muted-foreground">
          <span>{brandsList.length} registered brand{brandsList.length === 1 ? "" : "s"}</span>
          <span>{personalCount} personal model{personalCount === 1 ? "" : "s"}</span>
          {loadError && (
            <span role="alert" className="inline-flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {loadError}
            </span>
          )}
        </div>
      </motion.section>

      {/* KPIs */}
      <motion.section 
        variants={itemVariants}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {kpis.map((kpi) => {
          const KpiIcon = kpi.icon;
          return (
            <motion.div
              key={kpi.id}
              className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-soft)]"
            >
              <div className="relative">
                <div className="flex items-start justify-between gap-2">
                  <div className={`grid h-10 w-10 place-items-center rounded-xl ${kpi.colorClass} shadow-sm`}>
                    <KpiIcon className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-5 font-display text-3xl font-extrabold tabular-nums tracking-tight">
                  {dashboardLoaded ? kpi.value : <span className="block h-8 w-20 motion-safe:animate-pulse rounded-lg bg-surface-2" aria-label="Loading metric" />}
                </div>
                <div className="mt-1.5 text-xs font-bold text-muted-foreground">{kpi.label}</div>
                <div className="mt-1 text-xs font-medium text-muted-foreground">{kpi.sub}</div>
              </div>
            </motion.div>
          );
        })}
      </motion.section>

      {/* Charts row */}
      <motion.section 
        variants={itemVariants}
        className="grid gap-5 lg:grid-cols-[1.6fr_1fr]"
      >
        <div className="rounded-2xl border border-border bg-surface/70 p-6 backdrop-blur-xl shadow-sm">
          <SectionHeader
            eyebrow="AI Validation"
            title={<span className="text-2xl font-bold">Recent Validation Runs</span>}
            description={accuracyTrend.length > 0 ? `Latest ${accuracyTrend.length} owned model runs. Each bar is a separate scope, not a continuous trend.` : "No model training data available yet."}
          />
          <div className="mt-6 h-[260px]">
            {accuracyTrend.length > 0 ? (
              <DashboardChart data={accuracyTrend} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/65 text-center">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground">No training sessions yet</p>
                <p className="text-xs text-muted-foreground">Accuracy appears after the scheduled training pipeline registers a validated model.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Recent Forecasts */}
        <div className="rounded-2xl border border-border bg-surface/70 backdrop-blur-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border/60 pb-4 mb-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-primary">
                  <History className="h-3.5 w-3.5" />
                  Recent activity
                </div>
                <h3 className="mt-2 font-display text-base font-bold">
                  Recent Forecasts
                </h3>
              </div>
              <Link href="/history" className="text-xs font-bold text-primary hover:text-primary-glow hover:underline">
                View all →
              </Link>
            </div>
            <ul className="divide-y divide-border/60">
              {recentPredictions.length === 0 ? (
                <li className="py-10 text-center">
                  <p className="text-sm font-semibold text-muted-foreground">No predictions yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Make your first prediction to see it here.</p>
                </li>
              ) : (
                recentPredictions.map((r) => (
                  <li
                    key={r.id}
                    className="group flex flex-col justify-between py-3 transition-all duration-300"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-foreground truncate">{r.account}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground/80 line-clamp-1 italic">
                          &quot;{r.caption}&quot;
                        </p>
                        <div className="mt-1 text-xs font-medium text-muted-foreground/50">{r.when}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <TierBadge tier={r.tier} />
                        {r.confidence != null && (
                          <div className="flex items-center gap-1 text-xs font-bold">
                            <span className="font-mono text-foreground">{r.confidence}%</span>
                            <span className="text-xs text-muted-foreground/60 font-medium">conf</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </motion.section>

      {/* Hierarchy panel — AI status per brand */}
      <motion.section 
        variants={itemVariants}
        className="rounded-2xl border border-border bg-surface/70 p-6 backdrop-blur-xl shadow-sm"
      >
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,hsl(var(--primary))_30%,transparent)] bg-[color-mix(in_oklab,hsl(var(--primary))_8%,transparent)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              AI Levels
            </div>
            <h3 className="mt-3 font-display text-lg font-bold">
              Per-Account AI Status
            </h3>
            <p className="mt-1.5 text-xs font-medium text-muted-foreground/80">
              A personal model activates only after successful training on at least 200 verified posts. Until then, the brand uses its shared industry-cohort model.
            </p>
          </div>
          <Link href="/niches" className="shrink-0 text-xs font-bold text-primary hover:text-primary-glow hover:underline">
            Manage brands →
          </Link>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {brandsList.length === 0 ? (
            <li className="col-span-2 text-center py-10 border border-dashed border-border rounded-2xl bg-surface-2/30 text-xs text-muted-foreground">
              No brand workspaces registered. Click &quot;Manage brands&quot; above to add your first brand.
            </li>
          ) : (
            brandsList.slice(0, 6).map((b) => {
              const stage = b.active_model_scope === "personal"
                ? "Personal"
                : b.active_model_scope === "cohort"
                  ? "Cohort"
                  : "No model";
              const followers = typeof b.followers === "number" ? b.followers : null;
              return (
                <li
                  key={b.id}
                  className="rounded-2xl border border-border/88 bg-surface p-4 transition-colors duration-200 hover:border-primary/20 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-display text-sm font-bold text-foreground">{b.name}</div>
                      <div className="mt-1 text-xs font-semibold text-muted-foreground">{b.niche} cohort</div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold uppercase tracking-wider ring-1 ring-inset ${
                        stage === "Personal"
                          ? "bg-[color-mix(in_oklab,hsl(var(--accent-lime))_18%,transparent)] text-[oklch(0.40_0.18_130)] dark:text-[oklch(0.85_0.20_130)] ring-[color-mix(in_oklab,hsl(var(--accent-lime))_45%,transparent)]"
                          : stage === "Cohort"
                            ? "bg-[color-mix(in_oklab,hsl(var(--primary))_12%,transparent)] text-primary ring-[color-mix(in_oklab,hsl(var(--primary))_35%,transparent)]"
                            : "bg-warning/10 text-warning-foreground ring-warning/30"
                      }`}
                    >
                      {stage}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs font-bold">
                    <span className="text-muted-foreground/80">
                      {followers === null ? "Followers not synced" : <><span className="font-mono tabular-nums text-foreground">{followers.toLocaleString()}</span> followers</>}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-mono text-muted-foreground/80">
                      {stage === "Personal"
                        ? "Personal model active"
                        : stage === "Cohort"
                          ? "Cohort model available"
                          : "Train a cohort model"}
                    </span>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </motion.section>

      {/* Tier distribution */}
      <motion.section 
        variants={itemVariants}
        className="block"
      >

        {/* Tier Distribution Chart */}
        <div className="rounded-2xl border border-border bg-surface/70 p-6 backdrop-blur-xl shadow-sm flex flex-col justify-between">
          <div>
            <SectionHeader
              eyebrow="Authenticated history"
              title={<span className="text-2xl font-bold">Performance Potential Distribution</span>}
              description="Distribution across predictions generated by your account."
            />
          </div>
          <div className="mt-4 space-y-5">
            {!dashboardLoaded ? (
              [1, 2, 3].map((item) => <div key={item} className="h-12 motion-safe:animate-pulse rounded-xl bg-surface-2" />)
            ) : tierDistribution.reduce((sum, item) => sum + item.count, 0) === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                No prediction results yet.
              </div>
            ) : tierDistribution.map((d) => {
              const max = Math.max(...tierDistribution.map((x) => x.count), 1);
              const pct = d.count > 0 ? (d.count / max) * 100 : 0;
              return (
                <div key={d.tier} className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: d.color, boxShadow: `0 0 10px ${d.color}` }}
                      />
                      <span className="uppercase tracking-wider">{d.tier}</span>
                    </div>
                    <span className="font-mono text-muted-foreground">{d.count}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-surface-3/60 border border-border/20 shadow-inner">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 1.2, ease: "easeOut" }}
                      className="h-full rounded-full"
                      style={{
                        background: `linear-gradient(90deg, ${d.color}, color-mix(in oklab, ${d.color} 75%, transparent))`,
                        boxShadow: `0 0 12px color-mix(in oklab, ${d.color} 25%, transparent)`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}
