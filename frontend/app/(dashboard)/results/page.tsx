"use client";

import { useEffect, useState } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { cn } from "@/lib/utils";
import { PublishedView } from "./_components/PublishedView";
import { PredictionsView } from "./_components/PredictionsView";

type ResultsTab = "published" | "predictions";

type OutcomeVerification = {
  linkedMaturePredictions: number;
  exactTierMatchRate: number | null;
  withinOneTierRate: number | null;
};

type SummaryData = {
  totalPredictions: number;
  observedCount: number;
  outcomeVerification: OutcomeVerification | null;
};

/**
 * Results answers one question — "how did it go?" — from two angles:
 * verified published Instagram posts and the prediction ledger. The summary
 * strip shows only computed verification aggregates, never invented accuracy.
 */
export default function ResultsPage() {
  const [tab, setTab] = useState<ResultsTab>(() => "published");
  const [tabReady, setTabReady] = useState(false);
  const [summary, setSummary] = useState<SummaryData | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "predictions") setTab("predictions");
    setTabReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchWithRetry("/api/dashboard", { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (cancelled || !response.ok || !payload) return;
        setSummary({
          totalPredictions: Number(payload.totalPredictions || 0),
          observedCount: Number(payload.observedCount || 0),
          outcomeVerification: payload.outcomeVerification ?? null,
        });
      } catch {
        // The strip is optional context; each tab reports its own errors.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const verification = summary?.outcomeVerification ?? null;
  const hasVerified = Boolean(verification && verification.linkedMaturePredictions > 0);

  return (
    <div className="mx-auto min-h-dvh max-w-[1500px] space-y-6 px-4 py-6 md:px-8 md:py-8">
      <SectionHeader
        title="Results"
        description="Published posts and how earlier predictions turned out."
        actions={
          <div role="tablist" aria-label="Results view" className="grid grid-cols-2 rounded-full border border-border bg-surface-2/60 p-1">
            {([
              ["published", "Published"],
              ["predictions", "Predictions"],
            ] as Array<[ResultsTab, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                aria-controls={`results-panel-${value}`}
                onClick={() => {
                  setTab(value);
                  const url = new URL(window.location.href);
                  url.searchParams.set("tab", value);
                  window.history.replaceState(null, "", url.toString());
                }}
                className={cn(
                  "min-h-10 rounded-full px-5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  tab === value ? "bg-surface text-primary shadow-sm ring-1 ring-inset ring-border" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {summary && (
        <div aria-label="Verification summary" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
          <div className="grid gap-px bg-border sm:grid-cols-3">
            <StripMetric
              label="Tier match rate"
              value={hasVerified && verification?.exactTierMatchRate != null ? `${verification.exactTierMatchRate.toFixed(0)}%` : "—"}
              helper={hasVerified
                ? `${verification?.linkedMaturePredictions} verified outcome${verification?.linkedMaturePredictions === 1 ? "" : "s"}${verification?.withinOneTierRate != null ? ` · ${verification.withinOneTierRate.toFixed(0)}% within one tier` : ""}`
                : "No verified outcomes yet — link published posts to predictions"}
            />
            <StripMetric label="Predictions" value={summary.totalPredictions.toLocaleString()} helper="Active estimates in this workspace" />
            <StripMetric label="Verified outcomes" value={summary.observedCount.toLocaleString()} helper="Mature linked Instagram results" />
          </div>
        </div>
      )}

      {tabReady && (
        <div id={`results-panel-${tab}`} role="tabpanel">
          {tab === "published" ? <PublishedView /> : <PredictionsView />}
        </div>
      )}
    </div>
  );
}

function StripMetric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="bg-surface p-4 sm:p-5">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{helper}</p>
    </div>
  );
}
