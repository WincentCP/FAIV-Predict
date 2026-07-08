"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import { type Tier, type ContentFormat } from "@/lib/mock-data";
import { Search, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

type HistoryItem = {
  id: string;
  brand: string;
  account: string;
  format: ContentFormat;
  caption: string;
  tier: Tier;
  confidence: number;
  when: string;
};


import { useEffect } from "react";

export default function HistoryPage() {
  const [tier, setTier] = useState<"All" | Tier>("All");
  const [brand, setBrand] = useState<string>("All");
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Actual evaluation outcomes map for closed-loop tracking (in-memory)
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch("/api/history");
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            setHistory(data);
          } else {
            setHistory([]);
          }
        } else {
          console.warn("API returned non-ok status for history.");
          setHistory([]);
        }
      } catch (err) {
        console.warn("Could not fetch history from API:", err);
        setHistory([]);
      }
    }
    fetchHistory();
  }, []);

  const updateOutcome = (id: string, val: string) => {
    setOutcomes((prev) => ({ ...prev, [id]: val }));
  };

  const uniqueBrandsInHistory = useMemo(() => {
    const list = new Set(history.map((h) => h.brand));
    return Array.from(list).sort();
  }, [history]);

  const filtered = useMemo(
    () =>
      history.filter(
        (h) =>
          (tier === "All" || h.tier === tier) &&
          (brand === "All" || h.brand === brand) &&
          (q === "" ||
            h.account.toLowerCase().includes(q.toLowerCase()) ||
            h.caption.toLowerCase().includes(q.toLowerCase())),
      ),
    [history, tier, brand, q],
  );

  return (
    <div className="px-4 py-6 md:px-6 md:py-8 max-w-full mx-auto space-y-6 overflow-x-hidden">
      <SectionHeader
        eyebrow="Prediction Log"
        title="Prediction History"
        description="Every classification this workspace has produced. Filter by brand or tier to spot patterns."
      />

      {/* Filters */}
      <section className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2.5 backdrop-blur focus-within:border-ring">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by account or caption…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
        </div>

        {/* Brand select */}
        <select
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="h-10 shrink-0 rounded-xl border border-border bg-surface/60 px-3 text-sm outline-none focus:border-ring sm:w-44"
        >
          <option value="All">All brands</option>
          {uniqueBrandsInHistory.map((bName) => (
            <option key={bName} value={bName}>
              {bName}
            </option>
          ))}
        </select>

        {/* Tier pill filter */}
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-surface/60 p-1">
          {(["All", "High", "Average", "Low"] as const).map((t) => {
            const active = tier === t;
            return (
              <button
                key={t}
                onClick={() => setTier(t)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      </section>

      {/* Table */}
      <section className="overflow-hidden rounded-2xl border border-border bg-surface/70 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-primary" />
            <h3 className="font-display text-sm font-semibold">
              {filtered.length} prediction{filtered.length === 1 ? "" : "s"}
            </h3>
          </div>
          <Link href="/predict" className="text-xs font-bold text-primary hover:underline">
            + New prediction
          </Link>
        </div>

        {/* Horizontal scroll container — only for the table itself */}
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[9px] uppercase tracking-[0.18em] text-muted-foreground font-semibold bg-surface-2/40">
                <th className="px-6 py-5">Account</th>
                <th className="px-6 py-5">Format</th>
                <th className="px-6 py-5">Caption preview</th>
                <th className="px-6 py-5 text-center">Confidence</th>
                <th className="px-6 py-5">Result</th>
                <th className="px-6 py-5">When</th>
                <th className="px-6 py-5">Actual outcome</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((h) => (
                <tr
                  key={h.id}
                  className="border-b border-border/50 last:border-0 hover:bg-surface-2/50 transition-colors"
                >
                  {/* Account + brand stacked */}
                  <td className="px-6 py-5 align-middle">
                    <div className="font-semibold text-xs text-foreground leading-tight">{h.account}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{h.brand}</div>
                  </td>

                  {/* Format badge */}
                  <td className="px-6 py-5 align-middle">
                    <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase text-muted-foreground/90">
                      {h.format}
                    </span>
                  </td>

                  {/* Caption — clamped */}
                  <td className="px-6 py-5 align-middle max-w-[220px]">
                    <p className="truncate text-[11px] text-muted-foreground italic">
                      &quot;{h.caption}&quot;
                    </p>
                  </td>

                  {/* Confidence */}
                  <td className="px-6 py-5 align-middle text-center">
                    <span className="font-mono text-xs font-semibold tabular-nums">{h.confidence}%</span>
                  </td>

                  {/* Tier badge */}
                  <td className="px-6 py-5 align-middle">
                    <TierBadge tier={h.tier} />
                  </td>

                  {/* Timestamp */}
                  <td className="px-6 py-5 align-middle text-[11px] text-muted-foreground whitespace-nowrap">{h.when}</td>

                  {/* Actual outcome dropdown */}
                  <td className="px-6 py-5 align-middle">
                    <select
                      value={outcomes[h.id] || "PENDING"}
                      onChange={(e) => updateOutcome(h.id, e.target.value)}
                      className={cn(
                        "h-7 rounded border text-[9px] font-extrabold px-2 focus:border-primary outline-none uppercase bg-surface tracking-wider",
                        outcomes[h.id] === "HIGH"
                          ? "text-primary border-primary/20 bg-primary/5"
                          : outcomes[h.id] === "AVERAGE"
                          ? "text-warning border-warning/20 bg-warning/5"
                          : outcomes[h.id] === "LOW"
                          ? "text-destructive border-destructive/20 bg-destructive/5"
                          : "text-muted-foreground border-border bg-surface-2"
                      )}
                    >
                      <option value="PENDING">Pending</option>
                      <option value="HIGH">High</option>
                      <option value="AVERAGE">Average</option>
                      <option value="LOW">Low</option>
                    </select>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-muted-foreground">
                    No predictions match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
