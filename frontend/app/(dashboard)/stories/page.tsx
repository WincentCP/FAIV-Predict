"use client";

import { useState, useMemo } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { BarChart3, Filter, HelpCircle, Eye, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type StoryMetric = {
  id: string;
  date: string;
  type: "Photo" | "Video";
  reach: number;
  impressions: number;
  exits: number;
  replies: number;
  tapsForward: number;
  tapsBack: number;
};

const STORIES_DATA: Record<string, StoryMetric[]> = {
  "@lasence.bakeshop": [
    { id: "st_1", date: "2026-05-27", type: "Video", reach: 1540, impressions: 1890, exits: 120, replies: 18, tapsForward: 950, tapsBack: 140 },
    { id: "st_2", date: "2026-05-26", type: "Photo", reach: 1200, impressions: 1350, exits: 150, replies: 8, tapsForward: 820, tapsBack: 62 },
    { id: "st_3", date: "2026-05-25", type: "Video", reach: 1800, impressions: 2150, exits: 180, replies: 32, tapsForward: 1100, tapsBack: 210 },
    { id: "st_4", date: "2026-05-23", type: "Photo", reach: 980, impressions: 1100, exits: 75, replies: 4, tapsForward: 610, tapsBack: 40 },
  ],
  "@bisongym.mdn": [
    { id: "st_5", date: "2026-05-27", type: "Video", reach: 2100, impressions: 2600, exits: 290, replies: 14, tapsForward: 1450, tapsBack: 110 },
    { id: "st_6", date: "2026-05-25", type: "Photo", reach: 1650, impressions: 1980, exits: 140, replies: 9, tapsForward: 1120, tapsBack: 95 },
    { id: "st_7", date: "2026-05-24", type: "Video", reach: 2450, impressions: 3100, exits: 310, replies: 28, tapsForward: 1680, tapsBack: 180 },
  ]
};

export default function StoriesPage() {
  const [selectedBrand, setSelectedBrand] = useState<"@lasence.bakeshop" | "@bisongym.mdn">("@lasence.bakeshop");

  const stories = useMemo(() => {
    return STORIES_DATA[selectedBrand] || [];
  }, [selectedBrand]);

  const summary = useMemo(() => {
    const totalReach = stories.reduce((s, st) => s + st.reach, 0);
    const totalExits = stories.reduce((s, st) => s + st.exits, 0);
    const totalReplies = stories.reduce((s, st) => s + st.replies, 0);
    const totalTapsBack = stories.reduce((s, st) => s + st.tapsBack, 0);

    const completionRate = totalReach > 0 ? ((totalReach - totalExits) / totalReach) * 100 : 0;
    const avgSes = totalReach > 0 ? ((totalReplies * 10 + totalTapsBack * 2 - totalExits) / totalReach) * 100 : 0;

    return {
      totalReach,
      avgCompletion: completionRate.toFixed(1),
      avgSes: avgSes.toFixed(1)
    };
  }, [stories]);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto space-y-6">
      <SectionHeader
        eyebrow="Retention & Interaction"
        title="Story Analytics"
        description="Track user retention, exits, taps, and engagement scores for 24-hour Instagram Stories."
        actions={
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value as any)}
              className="h-9 rounded-lg border border-border bg-surface px-3 text-xs font-semibold outline-none focus:border-primary"
            >
              <option value="@lasence.bakeshop">@lasence.bakeshop</option>
              <option value="@bisongym.mdn">@bisongym.mdn</option>
            </select>
          </div>
        }
      />

      {/* Stories Metrics KPI Widgets */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Total Reach analyzed
          </div>
          <div className="font-display text-2xl font-extrabold text-foreground tabular-nums">
            {summary.totalReach.toLocaleString()}
          </div>
          <div className="text-[10px] text-muted-foreground/80 mt-1">Across latest active stories</div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
            Avg. Completion Rate
            <span title="((Reach - Exits) / Reach) * 100%">
              <HelpCircle className="h-3 w-3 text-muted-foreground" />
            </span>
          </div>
          <div className="font-display text-2xl font-extrabold text-primary tabular-nums">
            {summary.avgCompletion}%
          </div>
          <div className="text-[10px] text-muted-foreground/80 mt-1">Target benchmark: &gt;80%</div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
            Story Engagement Score (SES)
            <span title="((Replies * 10 + Taps Back * 2 - Exits) / Reach) * 100%">
              <HelpCircle className="h-3 w-3 text-muted-foreground" />
            </span>
          </div>
          <div className="font-display text-2xl font-extrabold text-accent-lime tabular-nums">
            {summary.avgSes}%
          </div>
          <div className="text-[10px] text-muted-foreground/80 mt-1">Measures story interaction impact</div>
        </div>
      </section>

      {/* Tabular Stories Grid */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="px-5 py-4 border-b border-border bg-surface-2/40">
          <h3 className="font-display text-sm font-bold text-foreground">
            Story Performance Metrics
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                <th className="px-6 py-4.5 font-bold">Post Date</th>
                <th className="px-6 py-4.5 font-bold">Type</th>
                <th className="px-6 py-4.5 font-bold text-right">Reach</th>
                <th className="px-6 py-4.5 font-bold text-right">Impressions</th>
                <th className="px-6 py-4.5 font-bold text-right">Exits</th>
                <th className="px-6 py-4.5 font-bold text-right">Replies</th>
                <th className="px-6 py-4.5 font-bold text-right">Taps Forward</th>
                <th className="px-6 py-4.5 font-bold text-right">Taps Back</th>
                <th className="px-6 py-4.5 font-bold text-right text-primary">Completion Rate</th>
                <th className="px-6 py-4.5 font-bold text-right text-accent-lime">SES Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {stories.map((st) => {
                const compRate = ((st.reach - st.exits) / st.reach) * 100;
                const sesScore = ((st.replies * 10 + st.tapsBack * 2 - st.exits) / st.reach) * 100;
                
                const [y, m, d] = st.date.split("-").map(Number);
                const dateObj = new Date(y, m - 1, d);
                const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short" });
                const dayNum = dateObj.getDate();
                const monthYear = dateObj.toLocaleDateString("en-US", { month: "short", year: "numeric" });

                return (
                  <tr key={st.id} className="hover:bg-surface-2/40 transition-colors group/row">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col items-center justify-center shrink-0 w-11 h-11 rounded-lg bg-surface-2 border border-border transition-colors group-hover/row:border-primary/30 group-hover/row:bg-primary/[0.02]">
                          <span className="text-[9px] uppercase font-extrabold text-muted-foreground/80 tracking-wider leading-none">
                            {weekday}
                          </span>
                          <span className="text-sm font-extrabold text-foreground leading-none mt-1">
                            {dayNum}
                          </span>
                        </div>
                        <div className="flex flex-col justify-center text-left">
                          <span className="text-xs font-bold text-foreground">
                            {monthYear}
                          </span>
                          <span className="text-[8px] font-bold text-muted-foreground/80 uppercase tracking-widest mt-0.5">
                            Published
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border inline-flex",
                        st.type === "Video"
                          ? "bg-primary/5 text-primary border-primary/20"
                          : "bg-surface-2 text-muted-foreground border-border"
                      )}>
                        {st.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-xs font-semibold tabular-nums">{st.reach.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right font-mono text-xs font-semibold tabular-nums">{st.impressions.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right font-mono text-xs font-semibold tabular-nums text-destructive">{st.exits.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right font-mono text-xs font-semibold tabular-nums text-success">+{st.replies}</td>
                    <td className="px-6 py-4 text-right font-mono text-xs font-semibold tabular-nums">{st.tapsForward.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right font-mono text-xs font-semibold tabular-nums text-primary">+{st.tapsBack}</td>
                    <td className="px-6 py-4 text-right font-mono text-xs font-bold text-primary tabular-nums">
                      {compRate.toFixed(1)}%
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-xs font-bold text-accent-lime-strong tabular-nums">
                      {sesScore.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
              {stories.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-10 text-center text-xs text-muted-foreground">
                    No story analytics collected for this account yet.
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
