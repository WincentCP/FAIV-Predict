"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { NICHES } from "@/lib/niches";
import { type Brand, type MlModel, SAMPLE_TARGET } from "@/lib/types";
import { cn } from "@/lib/utils";

type Connection = { status: string; username?: string; last_synced?: string | null };
type LoadState = "loading" | "ready" | "error";
type AiState = "idle" | "loading" | "done" | "unavailable";
type NicheSuggestion = { niche: string; reason: string };

export function BrandWorkspaces() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<MlModel[]>([]);
  const [connections, setConnections] = useState<Record<string, Connection>>({});
  const [dataState, setDataState] = useState<LoadState>("loading");
  const [connectionState, setConnectionState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddBrand, setShowAddBrand] = useState(false);

  const loadWorkspaceData = useCallback(async () => {
    setDataState("loading");
    setLoadError(null);
    try {
      const [brandsRes, modelsRes] = await Promise.all([
        fetchWithRetry("/api/brands"),
        fetchWithRetry("/api/models"),
      ]);
      const [brandPayload, modelPayload] = await Promise.all([
        brandsRes.json().catch(() => null),
        modelsRes.json().catch(() => null),
      ]);
      if (!brandsRes.ok || !Array.isArray(brandPayload)) {
        throw new Error("Brands could not be loaded.");
      }
      setBrands(brandPayload);
      setModels(modelsRes.ok && Array.isArray(modelPayload) ? modelPayload : []);
      setDataState("ready");
    } catch (error: unknown) {
      setBrands([]);
      setModels([]);
      setDataState("error");
      setLoadError(error instanceof Error ? error.message : "Brands could not be loaded.");
    }
  }, []);

  const loadConnectionHealth = useCallback(async () => {
    setConnectionState("loading");
    try {
      const response = await fetchWithRetry("/api/instagram-health", { cache: "no-store" }, 0);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.connections)) throw new Error("Instagram status is unavailable.");
      const next: Record<string, Connection> = {};
      for (const connection of payload.connections) {
        if (typeof connection?.brand_id === "string") {
          next[connection.brand_id] = {
            status: connection.status,
            username: connection.username,
            last_synced: connection.last_synced,
          };
        }
      }
      setConnections(next);
      setConnectionState("ready");
    } catch {
      setConnections({});
      setConnectionState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadWorkspaceData(), loadConnectionHealth()]);
  }, [loadConnectionHealth, loadWorkspaceData]);

  const summary = useMemo(() => ({
    connected: brands.filter((brand) => connections[brand.id]?.status === "connected").length,
    ready: brands.filter((brand) => brand.active_model_scope === "personal" || brand.active_model_scope === "cohort").length,
    personal: brands.filter((brand) => brand.active_model_scope === "personal").length,
  }), [brands, connections]);

  const cohortRows = useMemo(() => {
    const names = new Set<string>(NICHES);
    brands.forEach((brand) => names.add(brand.niche));
    return Array.from(names).sort().map((name) => ({
      name,
      brands: brands.filter((brand) => brand.niche === name),
      model: models.find((model) => model.scope === "Niche" && model.niche === name) || null,
    }));
  }, [brands, models]);

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Brand workspaces</h2>
          <p className="mt-1 text-sm text-muted-foreground">Connection status and prediction readiness per brand.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddBrand(true)}
          className="inline-flex min-h-11 items-center justify-center self-start rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Add brand
        </button>
      </div>

      {loadError && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-destructive/25 bg-destructive/[0.04] p-4 text-sm sm:flex-row sm:items-center">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <p className="flex-1 text-muted-foreground">{loadError}</p>
          <button type="button" onClick={loadWorkspaceData} className="min-h-10 rounded-lg border border-border bg-surface px-3 font-semibold hover:bg-surface-2">Try again</button>
        </div>
      )}

      {dataState === "loading" ? (
        <BrandSkeleton />
      ) : (
        <>
          <section aria-labelledby="brand-readiness-summary" className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-soft)]">
            <h2 id="brand-readiness-summary" className="sr-only">Brand readiness summary</h2>
            <div className="grid gap-px bg-border sm:grid-cols-3">
              <SummaryMetric label="Brands" value={brands.length} helper="Active profiles" />
              <SummaryMetric label="Instagram connected" value={connectionState === "error" ? "—" : summary.connected} helper={connectionState === "error" ? "Status unavailable" : "Accounts available"} />
              <SummaryMetric label="Ready to predict" value={summary.ready} helper={`${summary.personal} personalized`} />
            </div>
          </section>

          <section aria-labelledby="brand-list-title" className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="brand-list-title" className="text-xl font-semibold tracking-tight">Brand status</h2>
                <p className="mt-1 text-sm text-muted-foreground">See which brands are ready to predict.</p>
              </div>
              <button
                type="button"
                onClick={loadConnectionHealth}
                disabled={connectionState === "loading"}
                className="inline-flex min-h-10 items-center gap-2 self-start rounded-lg px-2 text-sm font-semibold text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
              >
                <RefreshCw className={cn("h-4 w-4", connectionState === "loading" && "animate-spin")} aria-hidden="true" />
                Refresh connections
              </button>
            </div>

            {connectionState === "error" && brands.length > 0 && (
              <div role="status" className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/[0.04] p-4 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
                <p>Instagram status could not be checked. Saved brand and prediction data are still available.</p>
              </div>
            )}

            {brands.length === 0 ? (
              <EmptyBrands onAdd={() => setShowAddBrand(true)} />
            ) : (
              <ul className="grid gap-4 xl:grid-cols-2" aria-label="Brands">
                {brands.map((brand) => (
                  <BrandReadinessCard
                    key={brand.id}
                    brand={brand}
                    connection={connections[brand.id]}
                    connectionState={connectionState}
                  />
                ))}
              </ul>
            )}
          </section>

          <details className="group rounded-3xl border border-border bg-surface shadow-[var(--shadow-soft)]">
            <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-5 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 md:px-6">
              Niche prediction models
              <span className="ml-auto hidden text-sm font-normal text-muted-foreground sm:inline group-open:hidden">{cohortRows.filter((row) => row.model).length} available</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="border-t border-border p-5 md:p-6">
              <p className="mb-4 rounded-2xl bg-surface-2/55 p-4 text-sm leading-relaxed text-muted-foreground">New brands use patterns from their niche until enough brand history is available for personalized predictions.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cohortRows.map((row) => (
                  <div key={row.name} className="rounded-2xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">{row.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{row.brands.length} registered brand{row.brands.length === 1 ? "" : "s"}</p>
                      </div>
                      <StatusPill tone={row.model ? "success" : "neutral"} label={row.model ? "Available" : "Not trained"} />
                    </div>
                    {row.model && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Test accuracy {row.model.baselineAccuracy == null ? "unavailable" : `${row.model.baselineAccuracy.toFixed(1)}%`} · trained {row.model.trained}</p>}
                  </div>
                ))}
              </div>
              <a href="#model-evidence" className="mt-5 inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-semibold text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40">
                Review model quality below
              </a>
            </div>
          </details>
        </>
      )}

      {showAddBrand && (
        <AddBrandDialog
          onClose={() => setShowAddBrand(false)}
          onSaveSuccess={async () => {
            await loadWorkspaceData();
            await loadConnectionHealth();
          }}
        />
      )}
    </div>
  );
}

function BrandReadinessCard({ brand, connection, connectionState }: { brand: Brand; connection?: Connection; connectionState: LoadState }) {
  const connected = connection?.status === "connected";
  const personal = brand.active_model_scope === "personal";
  const cohort = brand.active_model_scope === "cohort";
  const modelReady = personal || cohort;
  const samples = brand.samples ?? 0;
  const maturity = Math.min(100, Math.round((samples / SAMPLE_TARGET) * 100));

  const connectionLabel = connectionState === "loading"
    ? "Checking Instagram"
    : connectionState === "error"
      ? "Health unavailable"
      : connected
        ? `@${connection?.username || "verified account"}`
        : connection?.status === "error"
          ? "Ask an admin to reconnect Instagram"
          : "Ask an admin to connect Instagram";

  return (
    <li>
      <article className="h-full overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-soft)]">
        <div className="p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-sm font-semibold text-primary">
                {brand.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold tracking-tight" title={brand.name}>{brand.name}</h3>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{brand.niche} · {brand.timezone || "Asia/Jakarta"}</p>
              </div>
            </div>
            <StatusPill tone={modelReady ? "success" : "warning"} label={personal ? "Personalized" : cohort ? "Uses niche data" : "Not ready"} />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
              <div className="text-sm font-semibold text-foreground">Instagram</div>
              <p className={cn("mt-2 text-sm leading-relaxed", connected ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>{connectionLabel}</p>
            </div>

            <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
              <div className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
                <span>Comparable posts</span>
                <span className="tabular-nums text-muted-foreground">{samples}/{SAMPLE_TARGET}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={`${brand.name} comparable post progress`} aria-valuemin={0} aria-valuemax={SAMPLE_TARGET} aria-valuenow={Math.min(samples, SAMPLE_TARGET)}>
                <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${personal ? 100 : maturity}%` }} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Posts at least 7 days old that can be used for learning.</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-5">
            {modelReady ? (
              <Link href="/predict" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                Predict a draft
              </Link>
            ) : (
              <a href="#model-evidence" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-2">
                Check readiness
              </a>
            )}
            {connected && (
              <Link href={`/results?tab=published&brand_id=${encodeURIComponent(brand.id)}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-2">
                Results
              </Link>
            )}
          </div>
        </div>

        {!connected && connectionState !== "error" && (
          <details className="group border-t border-border bg-surface-2/25">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 md:px-6">
              How to connect
              <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="border-t border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground md:px-6">
              Ask an admin to connect the Instagram account, then update its data and retrain the model.
            </div>
          </details>
        )}
      </article>
    </li>
  );
}

function AddBrandDialog({ onClose, onSaveSuccess }: { onClose: () => void; onSaveSuccess: () => Promise<void> | void }) {
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [cohort, setCohort] = useState<string>(NICHES[0]);
  const [aiState, setAiState] = useState<AiState>("idle");
  const [suggestions, setSuggestions] = useState<NicheSuggestion[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nameRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const suggestCohort = async () => {
    if (profile.trim().length < 10) return;
    setAiState("loading");
    setAiError(null);
    try {
      const response = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, bio: profile }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload) || payload.length === 0) {
        throw new Error(payload?.message || "AI niche suggestion is unavailable.");
      }
      setSuggestions(payload);
      if (typeof payload[0]?.niche === "string") setCohort(payload[0].niche);
      setAiState("done");
    } catch (error: unknown) {
      setSuggestions([]);
      setAiState("unavailable");
      setAiError(error instanceof Error ? error.message : "AI niche suggestion is unavailable. Select a niche manually.");
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !cohort || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          niche: cohort,
          profile_summary: profile.trim(),
          timezone: "Asia/Jakarta",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "The brand could not be added.");
      await onSaveSuccess();
      setSaved(true);
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : "The brand could not be added.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-brand-title" aria-describedby="add-brand-description" className="flex max-h-[95dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-[var(--shadow-elevated)] sm:max-h-[90dvh] sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-5 md:px-6">
          <div>
            <h2 id="add-brand-title" className="text-xl font-semibold tracking-tight">Add a brand</h2>
            <p id="add-brand-description" className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">Add the brand now. An admin can connect Instagram next.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close add brand dialog" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {saved ? (
          <div className="overflow-y-auto p-6 sm:p-8">
            <div className="rounded-3xl border border-emerald-500/25 bg-emerald-500/[0.06] p-6 text-center">
              <h3 className="text-xl font-semibold">Brand created</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">The brand is ready for Instagram connection.</p>
              <ol className="mx-auto mt-6 max-w-md space-y-3 text-left text-sm">
                <SetupStep done label="Brand saved" />
                <SetupStep label="Admin connects Instagram" />
                <SetupStep label="Past posts import" />
                <SetupStep label="Predictions become ready" />
              </ol>
              <button type="button" onClick={onClose} className="mt-6 min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 md:p-6">
              <div>
                <label htmlFor="brand-name" className="text-sm font-semibold text-foreground">Brand name</label>
                <input ref={nameRef} id="brand-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={255} required placeholder="e.g. Northstar Bakery" className="mt-2 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="brand-profile" className="text-sm font-semibold text-foreground">Brand and audience</label>
                  <span className="text-xs text-muted-foreground">Optional · {profile.length}/2000</span>
                </div>
                <textarea id="brand-profile" value={profile} onChange={(event) => setProfile(event.target.value)} maxLength={2000} rows={5} placeholder="Describe the products, audience, voice, and creative boundaries." className="mt-2 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Used to tailor creative suggestions.</p>
              </div>

              <div>
                <label htmlFor="brand-cohort" className="text-sm font-semibold text-foreground">Niche</label>
                <div className="relative mt-2">
                  <select id="brand-cohort" value={cohort} onChange={(event) => setCohort(event.target.value)} className="min-h-11 w-full appearance-none rounded-xl border border-border bg-background px-3 pr-10 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/15">
                    {NICHES.map((niche) => <option key={niche} value={niche}>{niche}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Provides an initial prediction while the brand builds history.</p>
              </div>

              <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Suggest a niche</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Add at least 10 profile characters. You choose the final niche.</p>
                  </div>
                  <button type="button" onClick={suggestCohort} disabled={profile.trim().length < 10 || aiState === "loading"} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">
                    {aiState === "loading" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {aiState === "loading" ? "Analyzing…" : "Suggest niche"}
                  </button>
                </div>
                {aiError && <p role="status" className="mt-3 text-sm text-warning">{aiError}</p>}
                {aiState === "done" && suggestions.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {suggestions.slice(0, 3).map((suggestion) => (
                      <button key={suggestion.niche} type="button" onClick={() => setCohort(suggestion.niche)} className={cn("w-full rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40", cohort === suggestion.niche ? "border-primary bg-primary/[0.06]" : "border-border bg-surface hover:bg-surface-2")}>
                        <span className="font-semibold text-foreground">{suggestion.niche}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{suggestion.reason}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {saveError && <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[0.04] p-3 text-sm text-destructive">{saveError}</p>}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:justify-end md:px-6">
              <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={!name.trim() || !cohort || saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {saving ? "Adding brand…" : "Add brand"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SetupStep({ label, done = false }: { label: string; done?: boolean }) {
  return <li className="flex items-center gap-3"><span className={cn("h-2 w-2 shrink-0 rounded-full", done ? "bg-success" : "bg-border-strong")} aria-hidden /><span className={done ? "font-semibold text-foreground" : "text-muted-foreground"}>{label}</span></li>;
}

function SummaryMetric({ label, value, helper }: { label: string; value: number | string; helper: string }) {
  return (
    <div className="min-h-32 bg-surface p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{value}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{helper}</p>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "warning" | "neutral" }) {
  return <span className={cn("inline-flex min-h-7 shrink-0 items-center rounded-full border px-2.5 text-xs font-semibold", tone === "success" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", tone === "warning" && "border-warning/30 bg-warning/10 text-warning", tone === "neutral" && "border-border bg-surface-2 text-muted-foreground")}>{label}</span>;
}

function EmptyBrands({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-surface p-10 text-center">
      <h3 className="text-lg font-semibold">Add your first brand</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">Add a brand, then ask an admin to connect its Instagram account.</p>
      <button type="button" onClick={onAdd} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Add brand</button>
    </div>
  );
}

function BrandSkeleton() {
  return (
    <div role="status" aria-label="Loading brand readiness" className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-32 motion-safe:animate-pulse rounded-2xl bg-surface-2" />)}</div>
      <div className="grid gap-4 xl:grid-cols-2">{[0, 1].map((item) => <div key={item} className="h-80 motion-safe:animate-pulse rounded-3xl bg-surface-2" />)}</div>
      <span className="sr-only">Loading brands and Instagram status</span>
    </div>
  );
}
