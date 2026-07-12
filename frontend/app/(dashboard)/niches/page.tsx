"use client";

import { fetchWithRetry } from "@/lib/fetch-retry";
import { useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/SectionHeader";
import { NICHES } from "@/lib/niches";
import { type Brand, type MlModel, SAMPLE_TARGET } from "@/lib/types";

import {
  Loader2,
  X,
  Users,
  Building2,
  ChevronDown,
  Check,
  Activity,
  Cpu,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 350, damping: 25 } },
};

export default function NichesPage() {
  const [activeTab, setActiveTab] = useState<"niches" | "brands">("brands");
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<MlModel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [brandsRes, modelsRes] = await Promise.all([
        fetchWithRetry("/api/brands"),
        fetchWithRetry("/api/models"),
      ]);
      if (brandsRes.ok) {
        setBrands((await brandsRes.json()) || []);
        setLoadError(null);
      } else {
        setLoadError("Brand accounts could not be loaded.");
      }
      if (modelsRes.ok) {
        const modelData = await modelsRes.json();
        setModels(Array.isArray(modelData) ? modelData : []);
      }
    } catch {
      setLoadError("Brand accounts could not be loaded.");
    }
  }, []);

  // Per-brand Instagram connection status (matched by immutable brand UUID).
  // Failure to load leaves the map empty: the column then shows "Not linked"
  // guidance rather than blocking the page.
  const [igStatus, setIgStatus] = useState<
    Record<string, { status: string; username?: string }>
  >({});
  const [igHealthState, setIgHealthState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/instagram-health");
        const data = await res.json().catch(() => null);
        if (res.ok && Array.isArray(data?.connections)) {
          const map: Record<string, { status: string; username?: string }> = {};
          for (const c of data.connections) {
            if (typeof c.brand_id === "string") {
              map[c.brand_id] = { status: c.status, username: c.username };
            }
          }
          setIgStatus(map);
          setIgHealthState("ready");
        } else {
          setIgHealthState("error");
        }
      } catch {
        setIgHealthState("error");
      }
    })();
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Niche overview derived from real data: registered niches (canonical list +
  // any legacy values already stored on brands) with brand counts and the
  // latest trained niche model, when one exists.
  const nicheRows = useMemo(() => {
    const names = new Set<string>(NICHES);
    brands.forEach((b) => names.add(b.niche));

    return Array.from(names)
      .sort()
      .map((name) => {
        const nicheBrands = brands.filter((b) => b.niche === name);
        const nicheModel = models.find((m) => m.scope === "Niche" && m.niche === name);
        return {
          name,
          brandCount: nicheBrands.length,
          samples: nicheBrands.reduce((s, b) => s + (b.samples ?? 0), 0),
          model: nicheModel ?? null,
        };
      });
  }, [brands, models]);

  const graduatedCount = brands.filter((b) => b.active_model_scope === "personal").length;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
    className="relative px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto space-y-8 min-h-[100dvh]"
    >

      <motion.div variants={itemVariants}>
        <SectionHeader
          eyebrow="Brand Readiness"
          title="Brands & Connections"
          description="Create a planning workspace, verify its Instagram data connection, and see whether a cohort or personal model is ready."
          actions={
            <button
              onClick={() => setShowAddBrand(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition-colors duration-200 hover:bg-primary/92"
            >
              <Users className="h-3.5 w-3.5" />
              Create Workspace
            </button>
          }
        />
      </motion.div>

      {loadError && (
        <motion.div
          variants={itemVariants}
          className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4 flex items-center gap-3 text-xs"
        >
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="font-semibold text-destructive">{loadError}</span>
          <button
            type="button"
            onClick={loadData}
            className="ml-auto rounded-lg border border-border bg-surface px-3 py-1.5 font-semibold hover:bg-surface-2"
          >
            Retry
          </button>
        </motion.div>
      )}

      <motion.div
        variants={itemVariants}
        className="rounded-2xl border border-primary/20 bg-primary/[0.035] p-4 text-xs leading-relaxed text-muted-foreground"
      >
        <div className="flex items-start gap-3">
          <Activity className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <div className="font-bold text-foreground">Connection flow for this thesis deployment</div>
            <p className="mt-1">
              New workspaces start in planning-only mode. An administrator authorizes the Meta account server-side and runs the verified sync; this page then changes automatically to Connected. Until then, Predict is available only when a trained cohort model exists, and brand-specific Insights remain unavailable.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Summary Widgets */}
      <motion.section variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Brand Workspaces"
          value={`${brands.length}`}
          tone="primary"
          icon={Users}
        />
        <SummaryCard
          label="Trained Models"
          value={`${models.length}`}
          tone="lime"
          icon={Cpu}
        />
        <SummaryCard
          label="Personal Models Active"
          value={`${graduatedCount}`}
          tone="violet"
          icon={Check}
        />
      </motion.section>

      {/* ── Underline Tabs ── */}
      <motion.div variants={itemVariants} className="flex gap-2 border-b border-border pb-px">
        {(["brands", "niches"] as const).map((tab) => {
        const labels = { niches: "Industry Cohorts", brands: "Brands & Connections" };
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "relative px-6 pb-4 pt-2 text-xs font-semibold tracking-wide transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {labels[tab]}
              {active && (
                <motion.span
                  layoutId="activeTabUnderline"
                  className="absolute inset-x-0 bottom-0 h-[2px] rounded-t-full bg-primary"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </motion.div>

      <AnimatePresence mode="wait">
        {/* ── Tab: Niche Overview ── */}
        {activeTab === "niches" && (
          <motion.div
            key="niches-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="overflow-hidden rounded-2xl border border-border bg-surface/70 backdrop-blur-xl shadow-[var(--shadow-soft)]">
              <div className="flex items-center justify-between border-b border-border px-6 py-5 bg-surface-2/10">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4.5 w-4.5 text-primary" />
                  <span className="text-sm font-semibold">{nicheRows.length} industry cohorts</span>
                </div>
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider bg-surface-3 border border-border px-2.5 py-1 rounded-lg">
                  Shared models per cohort
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/30 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      <th className="w-[180px] px-6 py-5 text-left">Industry Cohort</th>
                      <th className="w-[120px] px-6 py-5 text-right">Brands</th>
                      <th className="w-[140px] px-6 py-5 text-right">Total Samples</th>
                      <th className="w-[220px] px-6 py-5 text-left">Cohort Model</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {nicheRows.map((row) => (
                      <tr key={row.name} className="group transition-colors hover:bg-surface-2/40">
                        <td className="px-6 py-5 align-middle">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                              {row.name[0]}
                            </span>
                            <span className="text-xs font-bold text-foreground truncate">{row.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-5 align-middle text-right font-mono text-xs font-semibold tabular-nums">
                          {row.brandCount}
                        </td>
                        <td className="px-6 py-5 align-middle text-right font-mono text-xs font-semibold tabular-nums">
                          {row.samples}
                        </td>
                        <td className="px-6 py-5 align-middle">
                          {row.model ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-lime/10 border border-accent-lime/30 px-2.5 py-1 text-xs font-bold text-accent-lime-strong">
                              <Check className="h-3 w-3" />
                              Trained · {row.model.baselineAccuracy !== null ? `${row.model.baselineAccuracy.toFixed(1)}% acc` : "accuracy unavailable"} · {row.model.trained}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-surface-3 border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground">
                              Not trained yet
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Tab: Brand Accounts ── */}
        {activeTab === "brands" && (
          <motion.div
            key="brands-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="overflow-hidden rounded-2xl border border-border bg-surface/70 backdrop-blur-xl shadow-[var(--shadow-soft)]">
              <div className="flex items-center justify-between border-b border-border px-6 py-5 bg-surface-2/10">
                <div className="flex items-center gap-2">
                  <Users className="h-4.5 w-4.5 text-primary" />
                  <span className="text-sm font-semibold">{brands.length} brand accounts</span>
                </div>
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider bg-surface-3 border border-border px-2.5 py-1 rounded-lg">
                  Personal model at {SAMPLE_TARGET} samples
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] table-fixed">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/30 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                      <th className="w-[260px] px-6 py-5 text-left">Brand</th>
                      <th className="w-[150px] px-6 py-5 text-left">Industry Cohort</th>
                      <th className="w-[150px] px-6 py-5 text-left">Instagram</th>
                      <th className="w-[100px] px-6 py-5 text-right">Followers</th>
                      <th className="w-[240px] px-6 py-5 text-left">Model Maturity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {brands.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-10 text-center text-xs text-muted-foreground">
                          No brand accounts registered yet.
                        </td>
                      </tr>
                    )}
                    {brands.map((b) => {
                      const samples = b.samples ?? 0;
                      const pct = Math.min(100, Math.round((samples / SAMPLE_TARGET) * 100));
                      const personalActive = b.active_model_scope === "personal";
                      const cohortActive = b.active_model_scope === "cohort";
                      let barColor = "bg-amber-400";
                      let label = cohortActive ? "Cohort model available" : "No trained model";
                      let labelColor = cohortActive
                        ? "text-primary"
                        : "text-amber-700 dark:text-amber-400";

                      if (personalActive) {
                        barColor = "bg-accent-lime";
                        label = "Personal model active";
                        labelColor = "text-[oklch(0.42_0.18_130)] dark:text-[oklch(0.82_0.20_130)]";
                      } else if (samples >= 100 || cohortActive) {
                        barColor = "bg-primary";
                      }

                      return (
                        <tr key={b.id} className="group transition-colors hover:bg-surface-2/40">
                          <td className="px-6 py-5 align-middle">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-xs font-bold text-primary">
                                {b.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("")}
                              </div>
                              <span className="text-sm font-bold text-foreground truncate" title={b.name}>
                                {b.name}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle">
                            <span
                              className="inline-flex items-center rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted-foreground max-w-full truncate"
                              title={b.niche}
                            >
                              {b.niche}
                            </span>
                          </td>
                          <td className="px-6 py-5 align-middle">
                            {igHealthState === "loading" ? (
                              <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Checking
                              </span>
                            ) : igHealthState === "error" ? (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/[0.06] px-2.5 py-1 text-xs font-semibold text-warning-foreground" title="The connection service could not be reached. This does not mean the account is disconnected.">
                                <AlertTriangle className="h-3 w-3" />
                                Health unavailable
                              </span>
                            ) : igStatus[b.id]?.status === "connected" ? (
                              <span
                                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 max-w-full"
                                title={`Live Graph API connection verified as @${igStatus[b.id]?.username}`}
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                <span className="truncate">@{igStatus[b.id]?.username}</span>
                              </span>
                            ) : igStatus[b.id] ? (
                              <span
                                className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 border border-destructive/25 px-2.5 py-1 text-xs font-bold text-destructive"
                                title="The saved Meta connection needs administrator attention."
                              >
                                Token error
                              </span>
                            ) : (
                              <span
                                className="text-xs font-semibold text-muted-foreground"
                                title="No verified Instagram Business connection is stored for this workspace."
                              >
                                Not connected
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-5 align-middle text-right">
                            <span className="font-mono text-xs font-bold tabular-nums text-foreground truncate">
                              {typeof b.followers === "number" ? b.followers.toLocaleString() : "Not synced"}
                            </span>
                          </td>
                          <td className="px-6 py-5 align-middle">
                            <div className="w-full space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1.5 text-xs font-bold leading-tight min-w-0",
                                    labelColor
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "h-1.5 w-1.5 rounded-full shrink-0",
                                      personalActive
                                        ? "bg-accent-lime"
                                        : cohortActive || samples >= 100
                                        ? "bg-primary"
                                        : "bg-amber-400"
                                    )}
                                  />
                                  <span className="truncate" title={label}>{label}</span>
                                </span>
                                <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-muted-foreground">
                                  {samples}
                                  <span className="opacity-50">/{SAMPLE_TARGET}</span>
                                </span>
                              </div>
                              <div
                                className="h-2 overflow-hidden rounded-full bg-surface-3"
                                role="progressbar"
                                aria-label={`${b.name} personal model data maturity`}
                                aria-valuemin={0}
                                aria-valuemax={SAMPLE_TARGET}
                                aria-valuenow={Math.min(samples, SAMPLE_TARGET)}
                              >
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-[width] duration-300",
                                    barColor
                                  )}
                                  style={{ width: `${personalActive ? 100 : pct}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add Brand Dialog ── */}
      <AnimatePresence>
        {showAddBrand && (
          <AddBrandDialog
            onClose={() => setShowAddBrand(false)}
            onSaveSuccess={loadData}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── AI Brand Classifier Dialog ───────────────────────────────────────────────
type AiState = "idle" | "loading" | "done" | "manual";
type NicheSuggestion = { niche: string; reason: string };

function AddBrandDialog({ onClose, onSaveSuccess }: { onClose: () => void; onSaveSuccess: () => void }) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<NicheSuggestion[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const classify = async () => {
    if (bio.trim().length < 10) return;
    setAiState("loading");
    setAiError(null);
    setSuggestions([]);
    setPicked(null);

    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, bio }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && Array.isArray(data) && data.length > 0) {
        setSuggestions(data);
        setPicked(data[0]?.niche ?? null);
        setAiState("done");
      } else {
        // No fabricated scores: fall back to a plain manual niche selection.
        setAiError(data?.message || "AI classification is unavailable.");
        setPicked(NICHES[0]);
        setAiState("manual");
      }
    } catch {
      setAiError("AI classification is unavailable.");
      setPicked(NICHES[0]);
      setAiState("manual");
    }
  };

  const handleSave = async () => {
    if (!name || !picked) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          niche: picked,
          profile_summary: bio,
          timezone: "Asia/Jakarta",
        }),
      });
      if (res.ok) {
        setSaved(true);
        onSaveSuccess();
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to save the brand account to the database.");
      }
    } catch (err: any) {
      setSaveError(err.message || "Unable to save brand account.");
    } finally {
      setSaving(false);
    }
  };

  const topMatch = suggestions[0];

  const manualPicker = (
    <div className="space-y-1.5">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Select industry cohort
      </div>
      <div className="relative">
        <select
          value={picked ?? ""}
          onChange={(e) => setPicked(e.target.value)}
          className="h-9 w-full appearance-none rounded-lg border border-border bg-surface px-3 pr-8 text-xs font-semibold outline-none transition-all focus:border-primary"
        >
          {NICHES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/75 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 15 }}
        transition={{ type: "spring", stiffness: 350, damping: 25 }}
        className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-surface/95 backdrop-blur-xl shadow-[var(--shadow-elevated)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border px-7 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold tracking-tight">Create Planning Workspace</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Save the brand identity and cohort now. Instagram connection is the administrator-assisted next step in this thesis deployment.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground active:scale-95 transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — two columns */}
        <div className="grid flex-1 md:grid-cols-[1fr_1.1fr]">
          {/* ── Left: Registration form ── */}
          <div className="space-y-5 border-b border-border p-7 md:border-b-0 md:border-r">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Brand Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Northstar Bakery"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_color-mix(in_oklab,hsl(var(--ring))_16%,transparent)]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Brand Profile &amp; Intended Audience
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={5}
                maxLength={2000}
                placeholder="Describe the brand, products, intended audience, positioning, and boundaries the creative assistant should preserve..."
                className="w-full resize-none rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_color-mix(in_oklab,hsl(var(--ring))_16%,transparent)]"
              />
              <div className="text-xs text-muted-foreground">
                {bio.trim().length < 10 ? (
                  <span className="text-warning font-medium">
                    Optional to save; at least 10 characters are needed for AI cohort suggestions ({bio.trim().length}/10)
                  </span>
                ) : (
                  <span className="text-success font-semibold">Valid profile ({bio.trim().length} characters)</span>
                )}
              </div>
            </div>

            {saveError && (
              <div className="rounded-lg border border-destructive/25 bg-destructive/[0.03] p-3 text-xs font-semibold text-destructive leading-normal">
                {saveError}
              </div>
            )}

            <button
              type="button"
              onClick={classify}
              disabled={aiState === "loading" || bio.trim().length < 10}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-primary-foreground transition-colors duration-200 hover:bg-primary/92 disabled:opacity-50"
            >
              {aiState === "loading" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analyzing business profile…
                </>
              ) : (
                <>
                  <Activity className="h-3.5 w-3.5" />
                  Analyze with AI
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setAiError(null);
                setPicked((p) => p ?? NICHES[0]);
                setAiState("manual");
              }}
              className="w-full text-center text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip AI and select an industry cohort manually
            </button>
          </div>

          {/* ── Right: AI Response panel ── */}
          <div className="flex flex-col p-7 justify-center">
            {aiState === "idle" && (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-10">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-surface-2">
                  <Users className="h-5 w-5 text-muted-foreground/50" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-muted-foreground">Industry suggestion ready</p>
                  <p className="mt-1 max-w-[220px] text-xs text-muted-foreground/70">
                    Fill in the business profile and request a suggestion, or select the cohort manually.
                  </p>
                </div>
              </div>
            )}

            {aiState === "manual" && (
              <div className="flex flex-1 flex-col justify-center gap-4">
                {aiError && (
                  <div className="rounded-xl border border-warning/30 bg-warning/[0.03] p-4 flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground leading-relaxed">{aiError}</p>
                  </div>
                )}
                {manualPicker}
              </div>
            )}

            {aiState === "loading" && (
              <div className="flex flex-1 flex-col gap-4">
                <div className="h-5 w-2/3 motion-safe:animate-pulse rounded-md bg-surface-3" />
                <div className="h-16 w-full motion-safe:animate-pulse rounded-xl bg-surface-3" />
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 motion-safe:animate-pulse rounded-lg bg-surface-3" style={{ animationDelay: `${i * 80}ms` }} />
                  ))}
                </div>
              </div>
            )}

            {aiState === "done" && suggestions.length > 0 && (
              <div className="flex flex-1 flex-col gap-5" style={{ animation: "page-enter 0.22s ease-out" }}>
                <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        AI Suggestion
                      </div>
                      <div className="mt-1 text-lg font-bold text-primary">
                        {topMatch?.niche}
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-muted-foreground">
                        Ranked first by the AI assistant · confirm or override below
                      </div>
                    </div>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                      <Check className="h-4 w-4" />
                    </span>
                  </div>
                  <p className="mt-3 rounded-lg bg-surface/80 p-3 text-xs leading-relaxed text-muted-foreground">
                    {topMatch?.reason}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    All matches
                  </div>
                  {suggestions.map((s) => {
                    const active = picked === s.niche;
                    return (
                      <button
                        key={s.niche}
                        type="button"
                        onClick={() => setPicked(s.niche)}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all",
                          active
                            ? "border-primary bg-primary/[0.03]"
                            : "border-border bg-surface hover:border-border-strong"
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors",
                            active ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground"
                          )}
                        >
                          {active ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-foreground">{s.niche}</div>
                          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{s.reason}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Override industry cohort
                  </div>
                  <div className="relative">
                    <select
                      value={picked ?? ""}
                      onChange={(e) => setPicked(e.target.value)}
                      className="h-9 w-full appearance-none rounded-lg border border-border bg-surface px-3 pr-8 text-xs font-semibold outline-none transition-all focus:border-primary"
                    >
                      {NICHES.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/30 px-7 py-4">
          {saved ? (
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" role="status">
              <div className="flex items-start gap-2 text-xs">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <div className="font-bold text-foreground">Planning workspace created</div>
                  <div className="mt-0.5 text-muted-foreground">
                    The profile is preserved. Ask the administrator to authorize this Instagram account and run the initial sync; connection, data freshness, and model readiness will then appear here.
                  </div>
                </div>
              </div>
              <button type="button" onClick={onClose} className="h-9 shrink-0 rounded-lg bg-primary px-5 text-xs font-bold text-primary-foreground hover:bg-primary/95">
                Done
              </button>
            </div>
          ) : (
            <>
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface-2 active:scale-95 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name || !picked || saving}
            onClick={handleSave}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-5 text-xs font-bold text-primary-foreground transition-colors duration-200 hover:bg-primary/92 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Create Planning Workspace"
            )}
          </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: "primary" | "lime" | "violet";
  icon: React.ComponentType<{ className?: string }>;
}) {
  const bg =
    tone === "primary"
      ? "color-mix(in oklab, hsl(var(--primary)) 6%, hsl(var(--surface)))"
      : tone === "lime"
      ? "color-mix(in oklab, hsl(var(--accent-lime)) 8%, hsl(var(--surface)))"
      : "color-mix(in oklab, hsl(var(--secondary-glow)) 6%, hsl(var(--surface)))";
  const border =
    tone === "primary"
      ? "border-primary/20 hover:border-primary/45"
      : tone === "lime"
      ? "border-accent-lime/35 hover:border-accent-lime-strong/50"
      : "border-secondary-glow/20 hover:border-secondary-glow/45";
  const text =
    tone === "primary"
      ? "text-primary"
      : tone === "lime"
      ? "text-[oklch(0.42_0.18_130)] dark:text-[oklch(0.82_0.20_130)]"
      : "text-secondary-glow";

  return (
    <motion.div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-6 backdrop-blur-xl transition-colors duration-200 shadow-[var(--shadow-soft)] flex items-start justify-between gap-4",
        border
      )}
      style={{ background: bg }}
    >
      <div className="relative z-10 space-y-3">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/80 leading-none">
          {label}
        </div>
        <div className="font-display text-2xl font-extrabold text-foreground tracking-tight leading-none">
          {value}
        </div>
      </div>
      <div
        className={cn(
          "relative z-10 grid h-10 w-10 place-items-center rounded-xl bg-surface/80 border border-border/40 shrink-0 shadow-sm",
          text
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
    </motion.div>
  );
}
