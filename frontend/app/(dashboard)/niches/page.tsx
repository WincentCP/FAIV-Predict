"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/SectionHeader";
import { NICHES } from "@/lib/niches";
import { type Brand, type MlModel, SAMPLE_TARGET, brandHandle } from "@/lib/types";

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
        fetch("/api/brands"),
        fetch("/api/models"),
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

  const graduatedCount = brands.filter((b) => (b.samples ?? 0) >= SAMPLE_TARGET).length;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="relative px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto space-y-8 min-h-screen"
    >
      {/* Ambient Backglow */}
      <div
        aria-hidden
        className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[350px] rounded-full filter blur-[120px] pointer-events-none -z-10 bg-indigo-500/10 dark:bg-indigo-500/5"
      />

      <motion.div variants={itemVariants}>
        <SectionHeader
          eyebrow="Category & Account Workspace"
          title="Niche & Brand Management"
          description="Register brand accounts and monitor their progress toward a dedicated personal model."
          actions={
            <button
              onClick={() => setShowAddBrand(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-[var(--shadow-glow-purple)] transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Users className="h-3.5 w-3.5" />
              Register New Brand
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

      {/* Summary Widgets */}
      <motion.section variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Registered Brands"
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
          label="Personal Model Graduates"
          value={`${graduatedCount}`}
          tone="violet"
          icon={Check}
        />
      </motion.section>

      {/* ── Underline Tabs ── */}
      <motion.div variants={itemVariants} className="flex gap-2 border-b border-border pb-px">
        {(["brands", "niches"] as const).map((tab) => {
          const labels = { niches: "Niche Overview", brands: "Brand Accounts" };
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
                  <span className="text-sm font-semibold">{nicheRows.length} niche categories</span>
                </div>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-surface-3 border border-border px-2.5 py-1 rounded-lg">
                  Shared models per niche
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/30 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      <th className="w-[180px] px-6 py-5 text-left">Niche</th>
                      <th className="w-[120px] px-6 py-5 text-right">Brands</th>
                      <th className="w-[140px] px-6 py-5 text-right">Total Samples</th>
                      <th className="w-[220px] px-6 py-5 text-left">Niche Model</th>
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
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-lime/10 border border-accent-lime/30 px-2.5 py-1 text-[10px] font-bold text-accent-lime-strong">
                              <Check className="h-3 w-3" />
                              Trained · {row.model.baselineAccuracy.toFixed(1)}% acc · {row.model.trained}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-surface-3 border border-border px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
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
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-surface-3 border border-border px-2.5 py-1 rounded-lg">
                  Personal model at {SAMPLE_TARGET} samples
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[830px] table-fixed">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/30 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                      <th className="w-[160px] px-6 py-5 text-left">Username</th>
                      <th className="w-[180px] px-6 py-5 text-left">Display Name</th>
                      <th className="w-[150px] px-6 py-5 text-left">Linked Niche</th>
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
                      const handle = brandHandle(b.name);
                      let barColor = "bg-amber-400";
                      let label = "Niche fallback (cold start)";
                      let labelColor = "text-amber-600 dark:text-amber-400";
                      let animated = false;
                      let glowing = false;

                      if (samples >= SAMPLE_TARGET) {
                        barColor = "bg-accent-lime";
                        label = "Personal model active";
                        labelColor = "text-[oklch(0.42_0.18_130)] dark:text-[oklch(0.82_0.20_130)]";
                        glowing = true;
                      } else if (samples >= 100) {
                        barColor = "bg-primary";
                        label = "Learning — accumulating data";
                        labelColor = "text-primary";
                        animated = true;
                      }

                      return (
                        <tr key={b.id} className="group transition-colors hover:bg-surface-2/40">
                          <td className="px-6 py-5 align-middle">
                            <span
                              className="font-mono text-xs text-primary font-semibold bg-primary/5 border border-primary/10 rounded-lg px-2.5 py-1.5 inline-flex max-w-full truncate"
                              title={handle}
                            >
                              {handle}
                            </span>
                          </td>
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
                              className="inline-flex items-center rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground max-w-full truncate"
                              title={b.niche}
                            >
                              {b.niche}
                            </span>
                          </td>
                          <td className="px-6 py-5 align-middle text-right">
                            <span className="font-mono text-xs font-bold tabular-nums text-foreground truncate">
                              {(b.followers ?? 0).toLocaleString()}
                            </span>
                          </td>
                          <td className="px-6 py-5 align-middle">
                            <div className="w-full space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider leading-tight min-w-0",
                                    labelColor
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "h-1.5 w-1.5 rounded-full shrink-0",
                                      samples >= SAMPLE_TARGET
                                        ? "bg-accent-lime animate-pulse"
                                        : samples >= 100
                                        ? "bg-primary"
                                        : "bg-amber-400"
                                    )}
                                  />
                                  <span className="truncate" title={label}>{label}</span>
                                </span>
                                <span className="shrink-0 font-mono text-[10px] font-bold tabular-nums text-muted-foreground">
                                  {samples}
                                  <span className="opacity-50">/{SAMPLE_TARGET}</span>
                                </span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all duration-700",
                                    barColor,
                                    animated && "relative overflow-hidden",
                                    glowing &&
                                      "shadow-[0_0_8px_2px_color-mix(in_oklab,hsl(var(--accent-lime))_60%,transparent)]"
                                  )}
                                  style={{ width: `${pct}%` }}
                                >
                                  {animated && (
                                    <span className="absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                                  )}
                                </div>
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
type NicheSuggestion = { niche: string; match: number; reason: string };

function AddBrandDialog({ onClose, onSaveSuccess }: { onClose: () => void; onSaveSuccess: () => void }) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [followers, setFollowers] = useState("");
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
          followers: followers ? Number(followers) : 0,
        }),
      });
      if (res.ok) {
        setSaved(true);
        onSaveSuccess();
        setTimeout(onClose, 900);
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
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        Select niche
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
              <h2 className="font-display text-base font-bold tracking-tight">Register New Brand</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Describe the business — AI suggests the best niche, or pick one manually.
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
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Brand Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lasence Bakeshop"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_color-mix(in_oklab,hsl(var(--ring))_16%,transparent)]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Followers (optional)
              </label>
              <input
                value={followers}
                onChange={(e) => setFollowers(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="e.g. 5400"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono text-sm outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_color-mix(in_oklab,hsl(var(--ring))_16%,transparent)]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Business Profile &amp; Target Audience
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={5}
                placeholder="Describe the business core, products, and who they sell to..."
                className="w-full resize-none rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_color-mix(in_oklab,hsl(var(--ring))_16%,transparent)]"
              />
              <div className="text-[10px] text-muted-foreground">
                {bio.trim().length < 10 ? (
                  <span className="text-warning font-medium">
                    Requires at least 10 characters to analyze ({bio.trim().length}/10)
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
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-primary-foreground transition-all hover:scale-[1.01] hover:shadow-[var(--shadow-glow-purple)] active:scale-[0.98] disabled:opacity-50"
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
              className="w-full text-center text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip AI and pick a niche manually
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
                  <p className="text-sm font-semibold text-muted-foreground">AI Classification Ready</p>
                  <p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground/70">
                    Fill in the business profile and click <em>Analyze with AI</em>, or pick the niche manually.
                  </p>
                </div>
              </div>
            )}

            {aiState === "manual" && (
              <div className="flex flex-1 flex-col justify-center gap-4">
                {aiError && (
                  <div className="rounded-xl border border-warning/30 bg-warning/[0.03] p-4 flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{aiError}</p>
                  </div>
                )}
                {manualPicker}
              </div>
            )}

            {aiState === "loading" && (
              <div className="flex flex-1 flex-col gap-4">
                <div className="h-5 w-2/3 animate-pulse rounded-md bg-surface-3" />
                <div className="h-16 w-full animate-pulse rounded-xl bg-surface-3" />
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-3" style={{ animationDelay: `${i * 80}ms` }} />
                  ))}
                </div>
              </div>
            )}

            {aiState === "done" && suggestions.length > 0 && (
              <div className="flex flex-1 flex-col gap-5" style={{ animation: "page-enter 0.22s ease-out" }}>
                <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        AI Suggestion
                      </div>
                      <div className="mt-1 text-lg font-bold text-primary">
                        {topMatch?.niche}
                      </div>
                      <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
                        Match Confidence:{" "}
                        <span className="font-mono font-bold tabular-nums text-foreground">
                          {Math.round((topMatch?.match ?? 0) * 100)}%
                        </span>
                      </div>
                    </div>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                      <Check className="h-4 w-4" />
                    </span>
                  </div>
                  <p className="mt-3 rounded-lg bg-surface/80 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    {topMatch?.reason}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    All matches
                  </div>
                  {suggestions.map((s) => {
                    const active = picked === s.niche;
                    const pct = Math.round(s.match * 100);
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
                          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className={cn("h-full rounded-full transition-all", active ? "bg-primary" : "bg-muted-foreground/30")}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-foreground">
                          {pct}%
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    Override niche
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
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface-2 active:scale-95 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name || !picked || saving || saved}
            onClick={handleSave}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-5 text-xs font-bold text-primary-foreground transition-all hover:scale-[1.02] hover:shadow-[var(--shadow-glow-purple)] active:scale-[0.98] disabled:opacity-50"
          >
            {saved ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Saved!
              </>
            ) : saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Confirm & Save Account"
            )}
          </button>
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
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ type: "spring", stiffness: 350, damping: 25 }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border p-6 backdrop-blur-xl transition-all duration-300 shadow-[var(--shadow-soft)] hover:shadow-md flex items-start justify-between gap-4",
        border
      )}
      style={{ background: bg }}
    >
      <div className="relative z-10 space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80 leading-none">
          {label}
        </div>
        <div className="font-display text-2xl font-extrabold text-foreground tracking-tight leading-none">
          {value}
        </div>
      </div>
      <div
        className={cn(
          "relative z-10 grid h-10 w-10 place-items-center rounded-xl bg-surface/80 border border-border/40 shrink-0 shadow-sm group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary/10 transition-all duration-300",
          text
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
    </motion.div>
  );
}
