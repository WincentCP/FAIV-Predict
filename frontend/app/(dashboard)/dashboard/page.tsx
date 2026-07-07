"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import {
  KPIS,
  PERFORMANCE_DISTRIBUTION,
  USAGE_TREND,
  RECENT_PREDICTIONS,
  BRANDS,
} from "@/lib/mock-data";
import dynamic from "next/dynamic";

const DashboardChart = dynamic(() => import("@/components/DashboardChart"), {
  ssr: false,
  loading: () => <div className="h-[260px] w-full animate-pulse bg-muted/40 rounded-xl" />,
});

import {
  ArrowUpRight,
  ArrowDownRight,
  CalendarRange,
  History,
  AlertTriangle,
  TrendingUp,
  Activity,
  Target,
  BarChart3,
  Users,
  ShieldCheck,
} from "lucide-react";
import { PostingHeatmap } from "@/components/PostingHeatmap";
import { motion, Variants } from "framer-motion";
import { Tier } from "@/lib/mock-data";

const LOCAL_KPIS = [
  {
    id: "predictions",
    label: "Total Predictions",
    value: "0",
    delta: "0%",
    trend: "up" as const,
    sub: "No predictions recorded",
    colorClass: "text-success bg-success/10 border-success/20",
    iconColor: "text-success",
    glowColor: "hsl(var(--success) / 0.2)",
    icon: Activity,
  },
  {
    id: "accounts",
    label: "Active Accounts",
    value: BRANDS.length.toString(),
    delta: "Active",
    trend: "up" as const,
    sub: `${BRANDS.length} brands connected`,
    colorClass: "text-chart-3 bg-chart-3/10 border-chart-3/20",
    iconColor: "text-chart-3",
    glowColor: "hsl(var(--chart-3) / 0.2)",
    icon: Users,
  },
  {
    id: "models",
    label: "Active Models",
    value: "0",
    delta: "Offline",
    trend: "up" as const,
    sub: "No models deployed",
    colorClass: "text-primary bg-primary/10 border-primary/20",
    iconColor: "text-primary",
    glowColor: "hsl(var(--primary) / 0.2)",
    icon: ShieldCheck,
  },
  {
    id: "confidence",
    label: "Average Confidence",
    value: "0%",
    delta: "N/A",
    trend: "up" as const,
    sub: "No metrics evaluated",
    colorClass: "text-warning bg-warning/10 border-warning/20",
    iconColor: "text-warning",
    glowColor: "hsl(var(--warning) / 0.2)",
    icon: TrendingUp,
  },
];

const LOCAL_RECENT_PREDICTIONS: any[] = [];

const ACCURACY_TREND = [
  { day: "05/01", accuracy: 82.5 },
  { day: "05/02", accuracy: 83.1 },
  { day: "05/03", accuracy: 84.0 },
  { day: "05/04", accuracy: 82.9 },
  { day: "05/05", accuracy: 83.5 },
  { day: "05/06", accuracy: 85.1 },
  { day: "05/07", accuracy: 84.8 },
  { day: "05/08", accuracy: 85.6 },
  { day: "05/09", accuracy: 86.2 },
  { day: "05/10", accuracy: 85.0 },
  { day: "05/11", accuracy: 84.4 },
  { day: "05/12", accuracy: 85.3 },
  { day: "05/13", accuracy: 86.8 },
  { day: "05/14", accuracy: 87.2 },
  { day: "05/15", accuracy: 86.5 },
  { day: "05/16", accuracy: 85.9 },
  { day: "05/17", accuracy: 86.4 },
  { day: "05/18", accuracy: 87.0 },
  { day: "05/19", accuracy: 88.1 },
  { day: "05/20", accuracy: 87.5 },
  { day: "05/21", accuracy: 86.9 },
  { day: "05/22", accuracy: 87.3 },
  { day: "05/23", accuracy: 88.4 },
  { day: "05/24", accuracy: 89.0 },
  { day: "05/25", accuracy: 88.2 },
  { day: "05/26", accuracy: 87.6 },
  { day: "05/27", accuracy: 88.5 },
];

export default function DashboardPage() {
  const personalCount = BRANDS.filter((b) => b.stage === "Personal").length;
  const driftCount = BRANDS.filter((b) => b.drift).length;

  const [kpis, setKpis] = useState(LOCAL_KPIS);
  const [recentPredictions, setRecentPredictions] = useState(LOCAL_RECENT_PREDICTIONS);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await fetch("/api/dashboard");
        if (res.ok) {
          const data = await res.json();
          
          setKpis((prev) =>
            prev.map((kpi) => {
              if (kpi.id === "predictions" && data.totalPredictions !== undefined) {
                return { ...kpi, value: data.totalPredictions.toLocaleString() };
              }
              if (kpi.id === "models" && data.totalModels !== undefined) {
                return { ...kpi, value: `${data.totalModels} Live` };
              }
              if (kpi.id === "accounts") {
                return { ...kpi, value: BRANDS.length.toString(), sub: `${BRANDS.length} brands connected` };
              }
              return kpi;
            })
          );

          if (data.recent && data.recent.length > 0) {
            const mappedRecent = data.recent.map((r: any) => ({
              id: r.id,
              account: r.brand ? `@${r.brand.toLowerCase().replace(/\s+/g, "")}` : "@unknown",
              format: "Single Image" as const,
              caption: r.caption,
              tier: r.tier as any,
              confidence: 85.0,
              when: new Date(r.when).toLocaleDateString()
            }));
            setRecentPredictions(mappedRecent);
          }
        }
      } catch (err) {
        console.warn("Could not fetch dashboard metrics, using local mock data:", err);
      }
    }
    fetchDashboard();
  }, []);

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
  };

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="px-5 py-6 md:px-10 md:py-8 space-y-6 max-w-7xl mx-auto"
    >
      {/* HERO — fills viewport, no duplicate KPI strip */}
      <motion.section 
        variants={itemVariants}
        className="relative overflow-hidden rounded-3xl border border-border-strong bg-gradient-to-br from-surface via-surface-2 to-surface p-1 shadow-[0_12px_40px_rgba(0,0,0,0.03)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.2)]"
      >
        <div className="relative flex w-full flex-col overflow-hidden rounded-[22px] p-6 md:p-12 py-10 md:py-16">
          <div aria-hidden className="absolute inset-0 grid-bg opacity-30" />
          
          <motion.div
            animate={{
              scale: [1, 1.05, 0.95, 1],
              rotate: [0, 5, -5, 0],
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
            aria-hidden
            className="absolute -top-32 -right-20 h-[500px] w-[500px] rounded-full opacity-60"
            style={{
              background:
                "radial-gradient(circle, color-mix(in oklab, hsl(var(--primary-glow)) 40%, transparent), transparent 70%)",
              filter: "blur(80px)",
            }}
          />
          
          <motion.div
            animate={{
              scale: [1, 0.95, 1.05, 1],
              rotate: [0, -4, 4, 0],
            }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
            aria-hidden
            className="absolute -bottom-40 -left-10 h-[500px] w-[500px] rounded-full opacity-50"
            style={{
              background:
                "radial-gradient(circle, color-mix(in oklab, hsl(var(--secondary-glow)) 35%, transparent), transparent 70%)",
              filter: "blur(80px)",
            }}
          />

          {/* Top row: greeting + status pills */}
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface/70 px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary shadow-sm backdrop-blur">
              <span className="h-2 w-2 animate-ping rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
              {BRANDS.length} accounts analyzed
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3.5 py-2 text-[10px] font-bold text-muted-foreground shadow-sm backdrop-blur">
                <TrendingUp className="h-3.5 w-3.5 text-[oklch(0.65_0.18_155)]" />
                Forecasts <span className="font-mono text-foreground">+18.4%</span> this week
              </div>
              {driftCount > 0 && (
                <div className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_oklab,hsl(var(--destructive))_45%,transparent)] bg-[color-mix(in_oklab,hsl(var(--destructive))_10%,transparent)] px-3.5 py-2 text-[10px] font-extrabold text-destructive shadow-sm backdrop-blur">
                  <AlertTriangle className="h-3.5 w-3.5 animate-bounce" />
                  {driftCount} account{driftCount === 1 ? "" : "s"} need attention
                </div>
              )}
            </div>
          </div>

          {/* Centered headline + sub — vertically anchored to fill space */}
          <div className="relative z-10 my-auto max-w-3xl py-8">
            <motion.h1 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="font-display text-[40px] font-extrabold leading-[1.05] tracking-tight md:text-[60px]"
            >
              Good morning,{" "}
              <span className="text-gradient-primary">Wincent</span>.
            </motion.h1>
            
            <motion.h2 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="mt-3.5 font-display text-2xl font-bold leading-tight tracking-tight text-muted-foreground md:text-3.5xl"
            >
              Your content is performing well today.
            </motion.h2>
            
            <motion.p 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="mt-6 max-w-xl text-base font-medium text-muted-foreground/90 leading-relaxed"
            >
              <span className="font-extrabold text-foreground">{personalCount}</span> of your brands now have a dedicated AI, and the rest are learning fast. Pick a workflow below to keep momentum going.
            </motion.p>

            <motion.div 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="mt-9 flex flex-wrap gap-3.5"
            >
              <Link
                href="/predict"
                className="group inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground shadow-[0_8px_25px_hsl(var(--primary-glow)/0.4)] transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Activity className="h-4.5 w-4.5" />
                Analyze New Post
                <ArrowUpRight className="h-4.5 w-4.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
              <Link
                href="/calendar"
                className="inline-flex items-center gap-2 rounded-xl border border-border-strong bg-surface/80 px-6 py-3.5 text-sm font-semibold text-foreground backdrop-blur shadow-sm transition-all hover:bg-surface-2 hover:scale-[1.01] active:scale-[0.98]"
              >
                <CalendarRange className="h-4.5 w-4.5 text-primary" />
                Plan a Calendar
              </Link>
              <Link
                href="/history"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface/50 px-6 py-3.5 text-sm font-semibold text-muted-foreground backdrop-blur shadow-sm transition-all hover:text-foreground hover:bg-surface-2 hover:scale-[1.01] active:scale-[0.98]"
              >
                <History className="h-4.5 w-4.5" />
                View History
              </Link>
            </motion.div>
          </div>

          {/* Bottom row: scroll cue + brand snapshot strip (no duplicated KPIs) */}
          <div className="relative z-10 mt-auto flex flex-wrap items-end justify-between gap-4 border-t border-border/50 pt-6">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
              <span className="inline-block h-px w-8 bg-border-strong" />
              Scroll for performance details
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-[11px] font-semibold text-muted-foreground">
              <span>
                Dedicated AI accounts{" "}
                <span className="font-mono font-bold text-foreground bg-surface-3/50 px-1.5 py-0.5 rounded">{personalCount}/{BRANDS.length}</span>
              </span>
              <span className="hidden h-3 w-px bg-border-strong sm:inline-block" />
              <span>
                Last update{" "}
                <span className="font-mono font-bold text-foreground bg-surface-3/50 px-1.5 py-0.5 rounded">12h ago</span>
              </span>
              <span className="hidden h-3 w-px bg-border-strong sm:inline-block" />
              <span>
                Forecasts today{" "}
                <span className="font-mono font-bold text-foreground bg-surface-3/50 px-1.5 py-0.5 rounded">428</span>
              </span>
            </div>
          </div>
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
              whileHover={{ y: -4, scale: 1.01 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              className="group relative overflow-hidden rounded-2xl border border-border bg-surface/70 p-5 backdrop-blur-xl transition-all duration-300 hover:border-primary/30 hover:shadow-[0_12px_30px_rgba(0,0,0,0.04)] dark:hover:shadow-[0_12px_30px_rgba(0,0,0,0.15)]"
            >
              {/* Radial glow follow */}
              <div
                aria-hidden
                className="absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                style={{
                  background: `radial-gradient(circle, ${kpi.glowColor}, transparent 70%)`,
                  filter: "blur(28px)",
                }}
              />
              <div className="relative">
                <div className="flex items-start justify-between gap-2">
                  <div className={`grid h-10 w-10 place-items-center rounded-xl ${kpi.colorClass} shadow-sm group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300`}>
                    <KpiIcon className="h-5 w-5" />
                  </div>
                  <div
                    className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-1 text-[10px] font-bold bg-[color-mix(in_oklab,hsl(var(--success))_15%,transparent)] text-[oklch(0.55_0.18_150)] dark:text-[oklch(0.78_0.18_150)]`}
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {kpi.delta}
                  </div>
                </div>
                <div className="mt-5 font-display text-3xl font-extrabold tabular-nums tracking-tight">
                  {kpi.value}
                </div>
                <div className="mt-1.5 text-[11px] font-bold text-muted-foreground/90">{kpi.label}</div>
                <div className="mt-0.5 text-[10px] font-medium text-muted-foreground/60">{kpi.sub}</div>
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
            title={<span className="text-2xl font-bold">Success Rate Trend (Last 30 Days)</span>}
            description="Daily success rate tracking between 80% to 89%."
          />
          <div className="mt-6 h-[260px]">
            <DashboardChart data={ACCURACY_TREND} />
          </div>
        </div>

        {/* Right Column: Recent Forecasts */}
        <div className="rounded-2xl border border-border bg-surface/70 backdrop-blur-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border/60 pb-4 mb-4">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,hsl(var(--primary))_30%,transparent)] bg-[color-mix(in_oklab,hsl(var(--primary))_8%,transparent)] px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-primary">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  Live feed
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
              {recentPredictions.map((r) => (
                <li
                  key={r.id}
                  className="group flex flex-col justify-between py-3 transition-all duration-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground truncate">{r.account}</span>
                        <span className="rounded-md border border-border/80 bg-surface-3 px-2 py-0.5 text-[9px] font-bold text-muted-foreground shadow-sm whitespace-nowrap">
                          {r.format}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground/80 line-clamp-1 italic">
                        &quot;{r.caption}&quot;
                      </p>
                      <div className="mt-1 text-[10px] font-medium text-muted-foreground/50">{r.when}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <TierBadge tier={r.tier} />
                      <div className="flex items-center gap-1 text-[11px] font-bold">
                        <span className="font-mono text-foreground">{r.confidence}%</span>
                        <span className="text-[9px] text-muted-foreground/60 font-medium">conf</span>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </motion.section>

      {/* Posting heatmap */}
      <motion.section 
        variants={itemVariants}
        className="rounded-2xl border border-border bg-surface p-6 shadow-sm hover:border-border-strong transition-all duration-300"
      >
        <PostingHeatmap />
      </motion.section>

      {/* Hierarchy panel — AI status per brand */}
      <motion.section 
        variants={itemVariants}
        className="rounded-2xl border border-border bg-surface/70 p-6 backdrop-blur-xl shadow-sm"
      >
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,hsl(var(--primary))_30%,transparent)] bg-[color-mix(in_oklab,hsl(var(--primary))_8%,transparent)] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              AI Levels
            </div>
            <h3 className="mt-3 font-display text-lg font-bold">
              Per-Account AI Status
            </h3>
            <p className="mt-1.5 text-xs font-medium text-muted-foreground/80">
              Dedicated AI activates after 200 posts analyzed. Otherwise, it falls back to General Niche AI.
            </p>
          </div>
          <Link href="/niches" className="shrink-0 text-xs font-bold text-primary hover:text-primary-glow hover:underline">
            Manage brands →
          </Link>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {BRANDS.slice(0, 6).map((b) => {
            const pct = Math.min(100, Math.round((b.samples / 200) * 100));
            return (
              <li
                key={b.id}
                className="group rounded-2xl border border-border/80 bg-surface p-4 transition-all duration-300 hover:border-primary/20 hover:shadow-sm hover:-translate-y-0.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-display text-sm font-bold text-foreground">{b.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] font-bold text-muted-foreground/70">{b.handle}</div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wider ring-1 ring-inset ${
                      b.stage === "Personal"
                        ? "bg-[color-mix(in_oklab,hsl(var(--accent-lime))_18%,transparent)] text-[oklch(0.40_0.18_130)] dark:text-[oklch(0.85_0.20_130)] ring-[color-mix(in_oklab,hsl(var(--accent-lime))_45%,transparent)]"
                        : "bg-[color-mix(in_oklab,hsl(var(--primary))_12%,transparent)] text-primary ring-[color-mix(in_oklab,hsl(var(--primary))_35%,transparent)]"
                    }`}
                  >
                    {b.stage} AI
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between text-[11px] font-bold">
                  <span className="text-muted-foreground/80">
                    <span className="font-mono tabular-nums text-foreground">{b.samples}</span>
                    {b.stage === "Personal" ? " posts analyzed · Dedicated active" : `/200 · ${pct}%`}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-foreground">
                    {b.accuracy.toFixed(1)}% Success Rate
                    {b.drift && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,hsl(var(--destructive))_18%,transparent)] px-2 py-0.5 text-[8px] font-extrabold uppercase text-destructive animate-pulse">
                        <AlertTriangle className="h-3 w-3" />
                        Needs Update
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3/80">
                  <motion.div
                     initial={{ width: 0 }}
                     animate={{ width: `${pct}%` }}
                     transition={{ duration: 1, ease: "easeOut" }}
                     className="h-full rounded-full"
                     style={{
                       background:
                         b.stage === "Personal" ? "var(--gradient-lime)" : "var(--gradient-primary)",
                     }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </motion.section>

      {/* Quick actions + Tier distribution */}
      <motion.section 
        variants={itemVariants}
        className="grid gap-5 lg:grid-cols-[1fr_1.4fr]"
      >
        <div>
          <h3 className="mb-4 font-display text-lg font-bold">Quick actions</h3>
          <div className="grid gap-4">
            {[
              {
                href: "/predict",
                icon: Activity,
                title: "Analyze New Post",
                desc: "Forecast post potential in seconds",
                glow: "hsl(var(--primary))",
              },
              {
                href: "/calendar",
                icon: CalendarRange,
                title: "Content Calendar",
                desc: "Upload an Excel file to score in batch",
                glow: "hsl(var(--secondary-glow))",
              },
              {
                href: "/history",
                icon: History,
                title: "Forecast History",
                desc: "Browse and filter past forecasts",
                glow: "hsl(var(--success))",
              },
            ].map((a, i) => (
              <Link
                key={a.title}
                href={a.href}
                className="group relative flex items-center gap-6 overflow-hidden rounded-xl border border-border bg-surface/60 p-6 backdrop-blur transition-all duration-300 hover:border-primary/20 hover:-translate-y-0.5 active:scale-[0.98] shadow-sm"
              >
                <div
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-border-strong/60 transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground"
                  style={{
                    background: `color-mix(in oklab, ${a.glow} 14%, transparent)`,
                    boxShadow: `inset 0 0 20px color-mix(in oklab, ${a.glow} 25%, transparent)`,
                  }}
                >
                  <a.icon className="h-6 w-6 text-primary group-hover:text-inherit" style={{ color: a.glow }} />
                </div>
                <div className="flex-1">
                  <div className="text-base font-bold text-foreground">{a.title}</div>
                  <div className="text-xs text-muted-foreground/80 mt-1.5">{a.desc}</div>
                </div>
                <ArrowUpRight className="h-5 w-5 text-muted-foreground transition-all duration-300 group-hover:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            ))}
          </div>
        </div>

        {/* Tier Distribution Chart */}
        <div className="rounded-2xl border border-border bg-surface/70 p-6 backdrop-blur-xl shadow-sm flex flex-col justify-between">
          <div>
            <SectionHeader
              eyebrow="This week"
              title={<span className="text-2xl font-bold">Performance Potential Distribution</span>}
              description="Distribution of forecast results."
            />
          </div>
          <div className="mt-4 space-y-5">
            {PERFORMANCE_DISTRIBUTION.map((d) => {
              const max = Math.max(...PERFORMANCE_DISTRIBUTION.map((x) => x.count));
              const pct = (d.count / max) * 100;
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
                        boxShadow: `0 0 12px ${d.color}33`,
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
