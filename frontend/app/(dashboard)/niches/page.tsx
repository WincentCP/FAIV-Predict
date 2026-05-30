"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/SectionHeader";
import { ModelMaturity } from "@/components/ModelMaturity";
import { BRANDS, NICHES, type Brand } from "@/lib/mock-data";
import {
  Loader2,
  X,
  Trash2,
  Pencil,
  Users,
  Building2,
  ChevronDown,
  Check,
  Activity,
} from "lucide-react";

// ─── Local niche data (richer than NICHES string array) ─────────────────────
interface NicheRow {
  id: string;
  name: string;
  description: string;
  p33: string;
  p67: string;
}

const INITIAL_NICHES: NicheRow[] = [
  { id: "n1", name: "Bakery & Café", description: "Artisan food, pastry, and café hospitality brands", p33: "45%", p67: "72%" },
  { id: "n2", name: "Fitness & Wellness", description: "Gyms, personal training, and wellness lifestyle content", p33: "38%", p67: "68%" },
  { id: "n3", name: "Creative Agency", description: "Design studios, production houses, and creative services", p33: "50%", p67: "82%" },
  { id: "n4", name: "Lifestyle Retail", description: "Fashion-adjacent retail, home goods, and curated lifestyle", p33: "42%", p67: "70%" },
  { id: "n5", name: "Media & Publishing", description: "Editorial content, media brands, and online publishing", p33: "35%", p67: "65%" },
  { id: "n6", name: "Fashion Atelier", description: "Luxury and independent fashion labels and ateliers", p33: "48%", p67: "76%" },
];

// ─── Brand accounts enriched ─────────────────────────────────────────────────
const BRANDS_ENRICHED = [
  { ...BRANDS[0], followers: "15.4K" },
  { ...BRANDS[1], followers: "5.2K" },
  { ...BRANDS[2], followers: "8.7K" },
  { ...BRANDS[3], followers: "11.2K" },
  { ...BRANDS[4], followers: "4.8K" },
  { ...BRANDS[5], followers: "6.9K" },
];

// ─── Toast notification ───────────────────────────────────────────────────────
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <div
      className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 animate-[slide-up_0.2s_ease-out]"
      onAnimationEnd={() => setTimeout(onDone, 2800)}
    >
      <div className="flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-destructive/[0.08] px-4 py-3 text-sm font-semibold text-destructive shadow-lg backdrop-blur">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive animate-pulse" />
        {message}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function NichesPage() {
  const [activeTab, setActiveTab] = useState<"niches" | "brands">("niches");
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [niches, setNiches] = useState<NicheRow[]>(INITIAL_NICHES);
  const [shakeId, setShakeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handleDeleteNiche = (niche: NicheRow) => {
    const linked = BRANDS.some((b) => b.niche === niche.name);
    if (linked) {
      setShakeId(niche.id);
      setToast("Cannot delete niche because active accounts are linked to it.");
      setTimeout(() => setShakeId(null), 600);
      return;
    }
    setNiches((prev) => prev.filter((n) => n.id !== niche.id));
  };

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto space-y-8">
      <SectionHeader
        eyebrow="Category & Account Workspace"
        title="Niche & Brand Management"
        description="Configure performance thresholds for each niche category and monitor brand accounts as they progress toward dedicated personal models."
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

      {/* ── Underline Tabs ── */}
      <div className="flex gap-2 border-b border-border pb-px">
        {(["niches", "brands"] as const).map((tab) => {
          const labels = { niches: "Niche Configuration", brands: "Brand Accounts" };
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
              <span
                className={cn(
                  "absolute inset-x-0 bottom-0 h-[2px] rounded-t-full transition-all duration-200",
                  active ? "bg-primary" : "bg-transparent"
                )}
              />
            </button>
          );
        })}
      </div>

      {/* ── Tab 1: Niche Management ── */}
      {activeTab === "niches" && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface/70 backdrop-blur shadow-[var(--shadow-soft)]">
            <div className="flex items-center justify-between border-b border-border px-6 py-5 bg-surface-2/10">
              <div className="flex items-center gap-2">
                <Building2 className="h-4.5 w-4.5 text-primary" />
                <span className="text-sm font-semibold">{niches.length} niche categories</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] table-fixed">
                <thead>
                  <tr className="border-b border-border bg-surface-2/30 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    <th className="w-[180px] px-5 py-4 text-left">Niche Name</th>
                    <th className="w-[320px] px-5 py-4 text-left">Description</th>
                    <th className="w-[110px] px-5 py-4 text-right">Lower Boundary (P33)</th>
                    <th className="w-[110px] px-5 py-4 text-right">Upper Boundary (P67)</th>
                    <th className="w-[90px] px-5 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {niches.map((niche) => (
                    <tr
                      key={niche.id}
                      className={cn(
                        "group transition-colors hover:bg-surface-2/40",
                        shakeId === niche.id && "animate-[shake_0.5s_ease-in-out]"
                      )}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                            {niche.name[0]}
                          </span>
                          <span className="text-xs font-bold text-foreground truncate">{niche.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 max-w-[320px]">
                        <span className="block text-xs text-muted-foreground leading-normal truncate" title={niche.description}>
                          {niche.description}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="inline-flex items-center rounded-lg bg-surface-3 border border-border px-2.5 py-1 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground">
                          {niche.p33}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="inline-flex items-center rounded-lg bg-primary/5 border border-primary/15 px-2.5 py-1 font-mono text-[10px] font-bold tabular-nums text-primary">
                          {niche.p67}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                          <button
                            title="Edit niche"
                            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            title="Delete niche"
                            onClick={() => handleDeleteNiche(niche)}
                            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 2: Brand Accounts ── */}
      {activeTab === "brands" && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface/70 backdrop-blur shadow-[var(--shadow-soft)]">
            <div className="flex items-center justify-between border-b border-border px-6 py-5 bg-surface-2/10">
              <div className="flex items-center gap-2">
                <Users className="h-4.5 w-4.5 text-primary" />
                <span className="text-sm font-semibold">{BRANDS_ENRICHED.length} brand accounts</span>
              </div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-surface-3 border border-border px-2.5 py-1 rounded-lg">
                Model graduates at 200 samples
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[830px] table-fixed">
                <thead>
                  <tr className="border-b border-border bg-surface-2/30 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    <th className="w-[160px] px-6 py-4.5 text-left">Username</th>
                    <th className="w-[180px] px-6 py-4.5 text-left">Display Name</th>
                    <th className="w-[150px] px-6 py-4.5 text-left">Linked Niche</th>
                    <th className="w-[100px] px-6 py-4.5 text-right">Followers</th>
                    <th className="w-[240px] px-6 py-4.5 text-left pl-8">Model Maturity Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {BRANDS_ENRICHED.map((b) => {
                    const pct = Math.min(100, Math.round((b.samples / 200) * 100));
                    let barColor = "bg-amber-400";
                    let label = "Niche Fallback Active (Cold Start)";
                    let labelColor = "text-amber-600 dark:text-amber-400";
                    let animated = false;
                    let glowing = false;

                    if (b.samples >= 200) {
                      barColor = "bg-accent-lime";
                      label = "Personal Dedicated Model Active";
                      labelColor = "text-[oklch(0.42_0.18_130)] dark:text-[oklch(0.82_0.20_130)]";
                      glowing = true;
                    } else if (b.samples >= 100) {
                      barColor = "bg-primary";
                      label = "Learning — accumulating data";
                      labelColor = "text-primary";
                      animated = true;
                    }

                    return (
                      <tr key={b.id} className="group transition-colors hover:bg-surface-2/40">
                        {/* Username */}
                        <td className="px-6 py-5">
                          <span className="font-mono text-xs text-primary font-semibold bg-primary/5 border border-primary/10 rounded-lg px-2.5 py-1.5 inline-flex max-w-full truncate" title={b.handle}>
                            {b.handle}
                          </span>
                        </td>
                        {/* Display Name */}
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-xs font-bold text-primary">
                              {b.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                            </div>
                            <span className="text-sm font-bold text-foreground truncate" title={b.name}>{b.name}</span>
                          </div>
                        </td>
                        {/* Linked Niche */}
                        <td className="px-6 py-5">
                          <span className="inline-flex items-center rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground max-w-full truncate" title={b.niche}>
                            {b.niche}
                          </span>
                        </td>
                        {/* Followers */}
                        <td className="px-6 py-5 text-right">
                          <span className="font-mono text-xs font-bold tabular-nums text-foreground truncate">
                            {b.followers}
                          </span>
                        </td>
                        {/* Model Maturity progress bar */}
                        <td className="px-6 py-5 pl-8">
                          <div className="w-full space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider leading-tight min-w-0", labelColor)}>
                                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0",
                                  b.samples >= 200 ? "bg-accent-lime animate-pulse" :
                                  b.samples >= 100 ? "bg-primary" : "bg-amber-400"
                                )} />
                                <span className="truncate" title={label}>{label}</span>
                              </span>
                              <span className="shrink-0 font-mono text-[10px] font-bold tabular-nums text-muted-foreground">
                                {b.samples}
                                <span className="opacity-50">/200</span>
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-700",
                                  barColor,
                                  animated && "relative overflow-hidden",
                                  glowing && "shadow-[0_0_8px_2px_color-mix(in_oklab,hsl(var(--accent-lime))_60%,transparent)]"
                                )}
                                style={{ width: `${pct}%` }}
                              >
                                {animated && (
                                  <span
                                    className="absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent"
                                  />
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
        </div>
      )}

      {/* ── Add Brand Dialog ── */}
      {showAddBrand && <AddBrandDialog onClose={() => setShowAddBrand(false)} />}

      {/* ── Toast ── */}
      {toast && (
        <Toast message={toast} onDone={() => setToast(null)} />
      )}
    </div>
  );
}

// ─── AI Brand Classifier Dialog ───────────────────────────────────────────────
type AiState = "idle" | "loading" | "done";
type NicheSuggestion = { niche: string; match: number; reason: string };

const NICHE_REASONS: Record<string, string> = {
  "Bakery & Café": "The business profile emphasizes artisan food products and café-style hospitality, which closely aligns with high-engagement Bakery & Café patterns in our training corpus.",
  "Fitness & Wellness": "Strong signals around physical training, health routines, and community engagement match the Fitness & Wellness niche model.",
  "Creative Agency": "The description indicates design-driven work and visual storytelling — hallmarks of Creative Agency content.",
  "Lifestyle Retail": "The brand's focus on curated product discovery and aspirational lifestyle content maps to our Lifestyle Retail niche.",
  "Media & Publishing": "Editorial voice, information density, and content-first positioning match the Media & Publishing niche.",
  "Fashion Atelier": "Emphasis on craft, exclusivity, and visual identity aligns with Fashion Atelier category signals.",
  "Food & Beverage": "Product-centric food content with a hospitality angle fits the Food & Beverage niche classification.",
  "Beauty & Skincare": "Skin-focused, routine-driven content with tutorial potential maps strongly to Beauty & Skincare patterns.",
  "Hospitality": "Service-oriented, experience-driven content aligns with the Hospitality niche performance model.",
  "Tech & SaaS": "Problem-solution framing, audience of professionals, and product-focused copy match Tech & SaaS patterns.",
};

function AddBrandDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [aiState, setAiState] = useState<AiState>("idle");
  const [suggestions, setSuggestions] = useState<NicheSuggestion[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const classify = async () => {
    if (bio.trim().length < 10) return;
    setAiState("loading");
    setSuggestions([]);
    setPicked(null);
    await new Promise((r) => setTimeout(r, 1400));

    const seed = (name + bio).toLowerCase();
    const scored = NICHES.map((n) => {
      let s = 0.42 + Math.random() * 0.28;
      if (seed.includes(n.split(" ")[0].toLowerCase())) s += 0.35;
      return { niche: n, match: Math.min(0.98, s), reason: NICHE_REASONS[n] ?? "Strong contextual alignment with this category." };
    }).sort((a, b) => b.match - a.match).slice(0, 3);

    setSuggestions(scored);
    setPicked(scored[0]?.niche ?? null);
    setAiState("done");
  };

  const handleSave = async () => {
    if (!name || !picked) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 800));
    setSaving(false);
    setSaved(true);
    setTimeout(onClose, 900);
  };

  const topMatch = suggestions[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/60 p-4 backdrop-blur-sm sm:items-center"
      style={{ animation: "fade-in 0.18s ease-out" }}
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-[var(--shadow-elevated)]"
        style={{ animation: "page-enter 0.18s ease-out" }}
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
                Describe the business — AI will suggest the best niche match.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground active:scale-95"
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
                Username / Handle
              </label>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@lasence.bakeshop"
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
            </div>

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
          </div>

          {/* ── Right: AI Response panel ── */}
          <div className="flex flex-col p-7">
            {/* IDLE state */}
            {aiState === "idle" && (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-10">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-surface-2">
                  <Users className="h-5 w-5 text-muted-foreground/50" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-muted-foreground">AI Classification Ready</p>
                  <p className="mt-1 max-w-[200px] text-[11px] text-muted-foreground/70">
                    Fill in the business profile and click <em>Analyze with AI</em> to get niche suggestions.
                  </p>
                </div>
              </div>
            )}

            {/* LOADING state — skeleton shimmer */}
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

            {/* DONE state — results */}
            {aiState === "done" && suggestions.length > 0 && (
              <div className="flex flex-1 flex-col gap-5" style={{ animation: "page-enter 0.22s ease-out" }}>
                {/* Top recommendation badge */}
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
                  {/* Reasoning narrative */}
                  <p className="mt-3 rounded-lg bg-surface/80 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    {topMatch?.reason}
                  </p>
                </div>

                {/* All matches list */}
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

                {/* Manual override dropdown */}
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
            className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface-2 active:scale-95"
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
      </div>
    </div>
  );
}
