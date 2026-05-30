"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import { BRANDS, type Tier, type ContentFormat } from "@/lib/mock-data";
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

const HISTORY: HistoryItem[] = [
  { id: "p_8821", brand: "Nova Studio", account: "@nova.studio", format: "Reels", caption: "Behind the scenes — week 17 shoot day", tier: "High", confidence: 94, when: "2 min ago" },
  { id: "p_8820", brand: "Kindred", account: "@kindred.brand", format: "Carousel", caption: "New drop · linen series 02 now live", tier: "High", confidence: 88, when: "6 min ago" },
  { id: "p_8819", brand: "Orbit Media", account: "@orbit.media", format: "Single Image", caption: "Editor's picks for the long weekend", tier: "Average", confidence: 71, when: "11 min ago" },
  { id: "p_8818", brand: "Solène Atelier", account: "@solene.atelier", format: "Reels", caption: "Atelier walkthrough · the cutting room", tier: "Low", confidence: 64, when: "18 min ago" },
  { id: "p_8817", brand: "Lasence Bakeshop", account: "@lasence.bakeshop", format: "Carousel", caption: "Spring menu lineup, 6 new pastries", tier: "Average", confidence: 82, when: "24 min ago" },
  { id: "p_8816", brand: "Bison Gym", account: "@bison.gym", format: "Reels", caption: "Morning mobility flow, 6 minutes flat", tier: "Average", confidence: 76, when: "1 hour ago" },
  { id: "p_8815", brand: "Nova Studio", account: "@nova.studio", format: "Single Image", caption: "Soft launch poster, comment what you see", tier: "High", confidence: 90, when: "2 hours ago" },
  { id: "p_8814", brand: "Kindred", account: "@kindred.brand", format: "Reels", caption: "Day-in-the-life — store opening", tier: "Low", confidence: 58, when: "3 hours ago" },
  { id: "p_8813", brand: "Lasence Bakeshop", account: "@lasence.bakeshop", format: "Reels", caption: "Croissant lamination, slow motion", tier: "High", confidence: 92, when: "Yesterday" },
  { id: "p_8812", brand: "Solène Atelier", account: "@solene.atelier", format: "Carousel", caption: "Lookbook spring 25 — sneak peek", tier: "Average", confidence: 79, when: "Yesterday" },
  { id: "p_8811", brand: "Orbit Media", account: "@orbit.media", format: "Reels", caption: "Studio tour with the new hires", tier: "Low", confidence: 62, when: "2 days ago" },
  { id: "p_8810", brand: "Bison Gym", account: "@bison.gym", format: "Single Image", caption: "Membership promo — May only", tier: "Average", confidence: 73, when: "2 days ago" },
];

export default function HistoryPage() {
  const [tier, setTier] = useState<"All" | Tier>("All");
  const [brand, setBrand] = useState<string>("All");
  const [q, setQ] = useState("");

  // Actual evaluation outcomes map for closed-loop tracking
  const [outcomes, setOutcomes] = useState<Record<string, string>>({
    p_8821: "HIGH",
    p_8820: "HIGH",
    p_8819: "AVERAGE",
    p_8818: "LOW",
  });

  const updateOutcome = (id: string, val: string) => {
    setOutcomes((prev) => ({ ...prev, [id]: val }));
  };

  const filtered = useMemo(
    () =>
      HISTORY.filter(
        (h) =>
          (tier === "All" || h.tier === tier) &&
          (brand === "All" || h.brand === brand) &&
          (q === "" ||
            h.account.toLowerCase().includes(q.toLowerCase()) ||
            h.caption.toLowerCase().includes(q.toLowerCase())),
      ),
    [tier, brand, q],
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
          {BRANDS.map((b) => (
            <option key={b.id} value={b.name}>
              {b.name}
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
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[9px] uppercase tracking-[0.18em] text-muted-foreground font-semibold bg-surface-2/40">
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Caption preview</th>
                <th className="px-4 py-3 text-center">Confidence</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actual outcome</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((h) => (
                <tr
                  key={h.id}
                  className="border-b border-border/50 last:border-0 hover:bg-surface-2/50 transition-colors"
                >
                  {/* Account + brand stacked */}
                  <td className="px-4 py-3">
                    <div className="font-semibold text-xs text-foreground leading-tight">{h.account}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{h.brand}</div>
                  </td>

                  {/* Format badge */}
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase text-muted-foreground/90">
                      {h.format}
                    </span>
                  </td>

                  {/* Caption — clamped */}
                  <td className="px-4 py-3 max-w-[220px]">
                    <p className="truncate text-[11px] text-muted-foreground italic">
                      &quot;{h.caption}&quot;
                    </p>
                  </td>

                  {/* Confidence */}
                  <td className="px-4 py-3 text-center">
                    <span className="font-mono text-xs font-semibold tabular-nums">{h.confidence}%</span>
                  </td>

                  {/* Tier badge */}
                  <td className="px-4 py-3">
                    <TierBadge tier={h.tier} />
                  </td>

                  {/* Timestamp */}
                  <td className="px-4 py-3 text-[11px] text-muted-foreground whitespace-nowrap">{h.when}</td>

                  {/* Actual outcome dropdown */}
                  <td className="px-4 py-3">
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
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">
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
