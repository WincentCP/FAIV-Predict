"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import { BRANDS, type Tier, type ContentFormat } from "@/lib/mock-data";
import {
  UploadCloud,
  Download,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  List,
  LayoutGrid,
  X,
  Plus,
  Save,
  Loader2,
  Clock,
  Award,
  Users,
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type CalendarEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  account: string;
  format: ContentFormat;
  caption: string;
  tier: Tier;
  confidence: number;
  status: "draft" | "screening" | "ready_to_post" | "published";
  picName: string;
  platform: string;
  postingNote?: string;
};

// ---------------------------------------------------------------------------
// Mock data — anchored to the current month so the grid always has content
// ---------------------------------------------------------------------------
const today = new Date();
const yyyy = today.getFullYear();
const mm = today.getMonth();
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const SEED_ENTRIES: CalendarEntry[] = [
  { id: "e1", date: ymd(yyyy, mm, 3), time: "09:00", account: "@lasence.bakeshop", format: "Reels", caption: "Behind the scenes — week 17 shoot day", tier: "High", confidence: 91, status: "ready_to_post", picName: "Alice", platform: "IG" },
  { id: "e2", date: ymd(yyyy, mm, 5), time: "19:30", account: "@lasence.bakeshop", format: "Carousel", caption: "Spring menu lineup, 6 new pastries arriving", tier: "High", confidence: 87, status: "screening", picName: "Bob", platform: "IG" },
  { id: "e3", date: ymd(yyyy, mm, 8), time: "12:15", account: "@bisongym.mdn", format: "Single Image", caption: "New drop · linen series 02 now live", tier: "Average", confidence: 74, status: "draft", picName: "Alice", platform: "FB" },
  { id: "e4", date: ymd(yyyy, mm, 10), time: "20:00", account: "@lasence.bakeshop", format: "Reels", caption: "Morning mobility flow, 6 minutes flat", tier: "Average", confidence: 68, status: "published", picName: "Dave", platform: "IG" },
  { id: "e5", date: ymd(yyyy, mm, 12), time: "18:45", account: "@lasence.bakeshop", format: "Carousel", caption: "Editor's picks — 5 reads to close the week", tier: "Low", confidence: 61, status: "screening", picName: "Bob", platform: "IG" },
  { id: "e6", date: ymd(yyyy, mm, 15), time: "20:15", account: "@bisongym.mdn", format: "Reels", caption: "Atelier walkthrough · the cutting room", tier: "High", confidence: 93, status: "ready_to_post", picName: "Charlie", platform: "IG" },
  { id: "e7", date: ymd(yyyy, mm, 17), time: "11:30", account: "@lasence.bakeshop", format: "Single Image", caption: "Soft launch poster, comment what you see", tier: "Average", confidence: 76, status: "ready_to_post", picName: "Alice", platform: "IG" },
  { id: "e8", date: ymd(yyyy, mm, 17), time: "21:00", account: "@lasence.bakeshop", format: "Reels", caption: "Croissant lamination, slow motion", tier: "High", confidence: 89, status: "screening", picName: "Bob", platform: "IG" },
  { id: "e9", date: ymd(yyyy, mm, 22), time: "10:00", account: "@bisongym.mdn", format: "Reels", caption: "Studio tour — SS25 launch details", tier: "High", confidence: 90, status: "draft", picName: "Charlie", platform: "IG" },
  { id: "e10", date: ymd(yyyy, mm, 24), time: "19:00", account: "@lasence.bakeshop", format: "Single Image", caption: "Coach spotlight — meet Mia", tier: "Average", confidence: 72, status: "published", picName: "Dave", platform: "FB" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const [entries, setEntries] = useState<CalendarEntry[]>(SEED_ENTRIES);
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: yyyy, m: mm });
  const [view, setView] = useState<"board" | "month" | "list">("month");
  const [editing, setEditing] = useState<CalendarEntry | null>(null);
  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [runningPredictId, setRunningPredictId] = useState<string | null>(null);
  
  // Drag over tracking
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const monthEntries = useMemo(
    () =>
      entries.filter((e) => {
        const d = new Date(e.date);
        return d.getFullYear() === cursor.y && d.getMonth() === cursor.m;
      }),
    [entries, cursor],
  );

  const grid = useMemo(() => buildMonthGrid(cursor.y, cursor.m), [cursor]);

  // ------- Excel Import -------
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    await new Promise((r) => setTimeout(r, 1100));

    const fresh: CalendarEntry[] = [
      {
        id: `imp-${Date.now()}-1`,
        date: ymd(cursor.y, cursor.m, 6),
        time: "08:30",
        account: "@lasence.bakeshop",
        format: "Reels",
        caption: file.name + " · Row 1 Import",
        tier: "High",
        confidence: 88,
        status: "screening",
        picName: "Alice",
        platform: "IG"
      },
      {
        id: `imp-${Date.now()}-2`,
        date: ymd(cursor.y, cursor.m, 14),
        time: "13:00",
        account: "@lasence.bakeshop",
        format: "Carousel",
        caption: file.name + " · Row 2 Import",
        tier: "Average",
        confidence: 72,
        status: "draft",
        picName: "Bob",
        platform: "IG"
      },
    ];
    setEntries((prev) => [...prev, ...fresh]);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleExport = async () => {
    setExporting(true);
    await new Promise((r) => setTimeout(r, 600));
    setExporting(false);
  };

  const handleSave = (next: CalendarEntry) => {
    setEntries((prev) =>
      prev.some((e) => e.id === next.id)
        ? prev.map((e) => (e.id === next.id ? next : e))
        : [...prev, next],
    );
    setEditing(null);
    setCreatingDate(null);
  };

  const handleDelete = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setEditing(null);
  };

  const goPrev = () =>
    setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const goNext = () =>
    setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));
  const goToday = () => setCursor({ y: yyyy, m: mm });

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDropOnStatus = (e: React.DragEvent, targetStatus: "draft" | "screening" | "ready_to_post" | "published") => {
    e.preventDefault();
    setDragOverCol(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    setEntries((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: targetStatus } : item))
    );
  };

  const handleDropOnDate = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDate(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    setEntries((prev) =>
      prev.map((item) => (item.id === id ? { ...item, date: targetDate } : item))
    );
  };

  // Predict Shortcut Action for screening/ready_to_post cards
  const runPredictShortcut = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setRunningPredictId(id);
    await new Promise((r) => setTimeout(r, 700));
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.id === id) {
          return {
            ...entry,
            tier: "High",
            confidence: 89,
            postingNote: "Best Time: 19:00"
          };
        }
        return entry;
      })
    );
    setRunningPredictId(null);
  };

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto">
      <SectionHeader
        eyebrow="Content Planning Workspace"
        title="Content Calendar"
        description="Plan your scheduled content. Drag posts between dates in the monthly grid, or move them across production stages in the board view."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={handleImport}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:bg-surface-2 disabled:opacity-60"
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UploadCloud className="h-3.5 w-3.5" />
              )}
              Upload Document
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/95 disabled:opacity-60"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Export Excel
            </button>
          </div>
        }
      />

      {/* Control panel: Toggles, Month Selector */}
      <div className="mt-8 flex flex-col md:flex-row items-center justify-between gap-4 border border-border bg-surface/40 p-3 rounded-xl">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={goPrev}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface hover:bg-surface-2 active:scale-95"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface hover:bg-surface-2 active:scale-95"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold hover:bg-surface-2 active:scale-95"
          >
            Today
          </button>
          <div className="ml-2 font-display text-lg font-bold">
            {MONTH_NAMES[cursor.m]} {cursor.y}
          </div>
        </div>

        {/* View Switcher: Board | Calendar | List */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-1 text-xs w-full md:w-auto justify-center">
          <button
            type="button"
            onClick={() => setView("board")}
            className={cn(
              "flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition active:scale-95",
              view === "board"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Board
          </button>
          <button
            type="button"
            onClick={() => setView("month")}
            className={cn(
              "flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition active:scale-95",
              view === "month"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition active:scale-95",
              view === "list"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="h-3.5 w-3.5" />
            List
          </button>
        </div>
      </div>

      {/* Main Views Container */}
      <div className="mt-6">
        {/* VIEW 1: KANBAN BOARD */}
        {view === "board" && (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-4 min-w-[900px]">
              {(["draft", "screening", "ready_to_post", "published"] as const).map((colStatus) => {
                const colEntries = monthEntries.filter((e) => e.status === colStatus);
                const colTitle =
                  colStatus === "draft"
                    ? "Draft"
                    : colStatus === "screening"
                    ? "Screening"
                    : colStatus === "ready_to_post"
                    ? "Ready to Post"
                    : "Published";
                const isOver = dragOverCol === colStatus;

                return (
                  <div
                    key={colStatus}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragOverCol !== colStatus) setDragOverCol(colStatus);
                    }}
                    onDragLeave={() => setDragOverCol(null)}
                    onDrop={(e) => handleDropOnStatus(e, colStatus)}
                    className={cn(
                      "flex-1 min-h-[500px] rounded-xl border p-4 transition-colors bg-surface/20",
                      isOver ? "border-primary bg-primary/[0.01]" : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-border/60">
                      <h3 className="font-display text-sm font-bold capitalize text-foreground flex items-center gap-2">
                        <span className={cn(
                          "h-2 w-2 rounded-full",
                          colStatus === "draft" ? "bg-slate-400" :
                          colStatus === "screening" ? "bg-amber-400" :
                          colStatus === "ready_to_post" ? "bg-purple-400" : "bg-emerald-400"
                        )} />
                        {colTitle}
                      </h3>
                      <span className="font-mono text-xs text-muted-foreground bg-surface-2 px-2 py-0.5 rounded-full">
                        {colEntries.length}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {colEntries.map((e) => (
                        <div
                          key={e.id}
                          draggable
                          onDragStart={(evt) => handleDragStart(evt, e.id)}
                          onClick={() => setEditing(e)}
                          className="group relative bg-surface border border-border rounded-xl p-4 cursor-grab active:cursor-grabbing hover:border-border-strong hover:shadow-sm transition-all"
                        >
                          <div className="flex items-start gap-2 mb-2">
                            {/* Thumbnail */}
                            <div className="h-7 w-7 rounded bg-gradient-to-br from-primary/10 to-primary/30 flex items-center justify-center font-bold text-[9px] text-primary shrink-0 border border-border">
                              {e.format[0]}
                            </div>
                            <div className="min-w-0 flex-1 leading-tight">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-xs text-foreground truncate">{e.account}</span>
                                <span className="text-[9px] text-muted-foreground font-mono font-semibold">{e.platform}</span>
                              </div>
                              <div className="text-[9px] text-muted-foreground">PIC: {e.picName}</div>
                            </div>
                          </div>

                          <h4 className="text-xs font-semibold text-foreground/80 line-clamp-2 leading-relaxed mb-3 italic">
                            &quot;{e.caption || "No caption yet."}&quot;
                          </h4>

                          <div className="flex items-center justify-between pt-2.5 border-t border-border/40 text-[10px]">
                            <span className="rounded border border-border bg-surface-2 px-2 py-0.5 font-bold text-muted-foreground font-mono">
                              {e.format}
                            </span>
                            {e.status !== "draft" && <TierBadge tier={e.tier} />}
                          </div>
                        </div>
                      ))}

                      {colEntries.length === 0 && (
                        <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-xl bg-surface/10">
                          Drag posts here
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 2: DEDICATED CALENDAR MONTHLY GRID */}
        {view === "month" && (
          <section className="overflow-hidden rounded-xl border border-border bg-surface/30">
            {/* Weekday labels */}
            <div className="grid grid-cols-7 border-b border-border bg-surface-2/60">
              {WEEK_LABELS.map((w) => (
                <div
                  key={w}
                  className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  {w}
                </div>
              ))}
            </div>
            {/* Days grid */}
            <div className="grid grid-cols-7">
              {grid.map((cell, idx) => {
                const dateStr = ymd(cell.year, cell.month, cell.day);
                const dayEntries = entries.filter((e) => e.date === dateStr);
                const isToday =
                  cell.year === today.getFullYear() &&
                  cell.month === today.getMonth() &&
                  cell.day === today.getDate();
                const isOverDate = dragOverDate === dateStr;

                return (
                  <div
                    key={idx}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragOverDate !== dateStr) setDragOverDate(dateStr);
                    }}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={(e) => handleDropOnDate(e, dateStr)}
                    className={cn(
                      "group relative min-h-[160px] border-b border-r border-border p-2.5 transition-colors hover:bg-surface-2/30",
                      cell.inMonth ? "bg-surface/10" : "bg-surface-2/20 text-muted-foreground/40",
                      (idx + 1) % 7 === 0 ? "border-r-0" : "",
                      isOverDate ? "bg-primary/[0.04] border-primary" : ""
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className={cn(
                          "grid h-6 w-6 place-items-center rounded-full text-xs font-extrabold tabular-nums",
                          isToday ? "bg-primary text-primary-foreground font-semibold" : "text-foreground/80"
                        )}
                      >
                        {cell.day}
                      </span>
                      {cell.inMonth && (
                        <button
                          type="button"
                          onClick={() => setCreatingDate(dateStr)}
                          className="grid h-5 w-5 place-items-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-surface-3 transition-opacity"
                          aria-label="Add entry"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Mini Content Cards Grid in Monthly Cells */}
                    <div className="space-y-2">
                      {dayEntries.slice(0, 3).map((e) => {
                        const isRunning = runningPredictId === e.id;

                        let statusColor = "bg-slate-100 text-slate-700 border-slate-200";
                        if (e.status === "screening") statusColor = "bg-amber-500/10 text-amber-600 border-amber-500/20";
                        else if (e.status === "ready_to_post") statusColor = "bg-purple-500/10 text-purple-600 border-purple-500/20";
                        else if (e.status === "published") statusColor = "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";

                        return (
                          <div
                            key={e.id}
                            draggable
                            onDragStart={(evt) => handleDragStart(evt, e.id)}
                            onClick={() => setEditing(e)}
                            className="group/card relative flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 cursor-grab active:cursor-grabbing hover:border-border-strong hover:shadow-xs transition-all text-[10px]"
                          >
                            <div className="flex items-center gap-1.5">
                              {/* Thumbnail */}
                              <div className="h-6 w-6 rounded bg-gradient-to-br from-primary/10 to-primary/30 flex items-center justify-center font-bold text-[8px] text-primary shrink-0">
                                {e.format[0]}
                              </div>
                              <div className="min-w-0 flex-1 leading-tight">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-mono font-bold text-foreground truncate">{e.account}</span>
                                  <span className="text-[8px] text-muted-foreground font-semibold font-mono">{e.platform}</span>
                                </div>
                                <div className="text-[8px] text-muted-foreground font-semibold">
                                  PIC: {e.picName || "Unassigned"}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-1.5 border-t border-border/40 pt-1.5">
                              <span className="rounded border border-border bg-surface-2 px-1 py-0.5 text-[8px] font-bold text-muted-foreground font-mono">
                                {e.format}
                              </span>
                              <span className={cn("rounded border px-1 py-0.5 text-[7px] font-bold uppercase tracking-wider scale-95", statusColor)}>
                                {e.status === "ready_to_post" ? "Ready" : e.status}
                              </span>
                            </div>

                            {/* Predict shortcut trigger */}
                            {(e.status === "screening" || e.status === "ready_to_post") && (
                              <button
                                type="button"
                                onClick={(evt) => runPredictShortcut(evt, e.id)}
                                className="absolute top-1.5 right-1.5 grid h-4 w-4 place-items-center rounded bg-primary/10 text-primary opacity-0 group-hover/card:opacity-100 hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                                title="Predict performance"
                              >
                                {isRunning ? (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                ) : (
                                  <Activity className="h-2.5 w-2.5" />
                                )}
                              </button>
                            )}

                            {/* Inline posting note */}
                            {e.postingNote && (
                              <div className="text-[8.5px] font-bold text-primary bg-primary/5 border border-primary/15 rounded px-1.5 py-0.5 mt-0.5">
                                {e.postingNote}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {dayEntries.length > 3 && (
                        <div className="px-1 text-[8px] font-bold text-primary">
                          +{dayEntries.length - 3} posts
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* VIEW 3: LIST TABLE */}
        {view === "list" && (
          <section className="overflow-hidden rounded-xl border border-border bg-surface/30 shadow-[var(--shadow-soft)]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-border bg-surface-2/60 text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
                    <th className="px-6 py-5 font-semibold">Date</th>
                    <th className="px-6 py-5 font-semibold">Time</th>
                    <th className="px-6 py-5 font-semibold">Account</th>
                    <th className="px-6 py-5 font-semibold">Format</th>
                    <th className="px-6 py-5 font-semibold">PIC</th>
                    <th className="px-6 py-5 font-semibold">Caption Preview</th>
                    <th className="px-6 py-5 font-semibold">Status</th>
                    <th className="px-6 py-5 font-semibold">Tier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {monthEntries
                    .slice()
                    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
                    .map((r) => {
                      const [y, m, d] = r.date.split("-").map(Number);
                      const dateObj = new Date(y, m - 1, d);
                      const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short" });
                      const dayNum = dateObj.getDate();
                      const monthYear = dateObj.toLocaleDateString("en-US", { month: "short", year: "numeric" });

                      return (
                        <tr
                          key={r.id}
                          onClick={() => setEditing(r)}
                          className="cursor-pointer hover:bg-surface-2/40 transition-colors group/row"
                        >
                          <td className="px-6 py-5 align-middle">
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col items-center justify-center shrink-0 w-11 h-11 rounded-lg bg-surface-2 border border-border transition-colors group-hover/row:border-primary/30 group-hover/row:bg-primary/[0.02]">
                                <span className="text-[9px] uppercase font-extrabold text-muted-foreground/80 tracking-wider leading-none">
                                  {weekday}
                                </span>
                                <span className="text-sm font-extrabold text-foreground leading-none mt-1">
                                  {dayNum}
                                </span>
                              </div>
                              <div className="flex flex-col justify-center">
                                <span className="text-xs font-bold text-foreground">
                                  {monthYear}
                                </span>
                                <span className="text-[8px] font-bold text-muted-foreground/80 uppercase tracking-widest mt-0.5">
                                  Scheduled
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle font-mono text-xs font-semibold">{r.time}</td>
                          <td className="px-6 py-5 align-middle">
                            <div className="max-w-[120px] md:max-w-[140px] truncate font-bold text-foreground" title={r.account}>
                              {r.account}
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle">
                            <span className="rounded border border-border bg-surface px-2 py-0.5 text-xs text-muted-foreground font-mono font-semibold">
                              {r.format}
                            </span>
                          </td>
                          <td className="px-6 py-5 align-middle">
                            <div className="max-w-[80px] md:max-w-[100px] truncate font-semibold" title={r.picName}>
                              {r.picName}
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle">
                            <div className="max-w-[200px] md:max-w-[280px] truncate text-xs text-muted-foreground italic" title={r.caption}>
                              &quot;{r.caption}&quot;
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle capitalize text-xs text-foreground/80 font-bold">
                            {r.status.replace(/_/g, " ")}
                          </td>
                          <td className="px-6 py-5 align-middle">
                            <TierBadge tier={r.tier} />
                          </td>
                        </tr>
                      );
                    })}
                  {monthEntries.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-10 text-center text-xs text-muted-foreground">
                        No entries scheduled. Upload document or select dates above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* Edit / Create dialog popup modal */}
      {(editing || creatingDate) && (
        <EntryModal
          initial={
            editing ?? {
              id: `new-${Date.now()}`,
              date: creatingDate!,
              time: "19:00",
              account: BRANDS[0]?.handle ?? "@lasence.bakeshop",
              format: "Reels" as const,
              caption: "",
              tier: "Average",
              confidence: 70,
              status: "draft",
              picName: "Alice",
              platform: "IG"
            }
          }
          isNew={!editing}
          onClose={() => {
            setEditing(null);
            setCreatingDate(null);
          }}
          onSave={handleSave}
          onDelete={editing ? () => handleDelete(editing.id) : undefined}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry Modal Dialog
// ---------------------------------------------------------------------------
function EntryModal({
  initial,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  initial: CalendarEntry;
  isNew: boolean;
  onClose: () => void;
  onSave: (next: CalendarEntry) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<CalendarEntry>(initial);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border p-4">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-primary">
              {isNew ? "Create Entry" : "Configure Entry"}
            </div>
            <h3 className="mt-1 font-display text-sm font-bold">
              {formatDayLabel(draft.date)} · {draft.time}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <ModalField label="Date">
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
              />
            </ModalField>
            <ModalField label="Time">
              <input
                type="time"
                value={draft.time}
                onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
              />
            </ModalField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ModalField label="Brand Account">
              <select
                value={draft.account}
                onChange={(e) => setDraft({ ...draft, account: e.target.value })}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
              >
                {BRANDS.map((b) => (
                  <option key={b.id} value={b.handle}>
                    {b.handle} ({b.name})
                  </option>
                ))}
              </select>
            </ModalField>
            <ModalField label="PIC Owner">
              <input
                type="text"
                value={draft.picName}
                onChange={(e) => setDraft({ ...draft, picName: e.target.value })}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
                placeholder="e.g. Alice"
              />
            </ModalField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ModalField label="Content Format">
              <select
                value={draft.format}
                onChange={(e) => setDraft({ ...draft, format: e.target.value as ContentFormat })}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
              >
                <option value="Reels">Reels</option>
                <option value="Carousel">Carousel</option>
                <option value="Single Image">Single Image</option>
              </select>
            </ModalField>
            <ModalField label="Platform Code">
              <input
                type="text"
                value={draft.platform}
                onChange={(e) => setDraft({ ...draft, platform: e.target.value })}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
                placeholder="e.g. IG, FB"
              />
            </ModalField>
          </div>

          <ModalField label="Caption Text">
            <textarea
              value={draft.caption}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-primary"
              placeholder="What's the caption for this content?"
            />
          </ModalField>

          <div className="grid gap-3 sm:grid-cols-2">
            <ModalField label="Workflow Status">
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as any })}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
              >
                <option value="draft">Draft</option>
                <option value="screening">Screening</option>
                <option value="ready_to_post">Ready to Post</option>
                <option value="published">Published</option>
              </select>
            </ModalField>
            {draft.status !== "draft" ? (
              <ModalField label="Performance Score">
                <div className="flex items-center gap-2.5 h-10 px-3 bg-surface-2 rounded-lg border border-border text-xs font-mono text-foreground font-semibold">
                  <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${draft.confidence}%` }}
                    />
                  </div>
                  <span>{draft.confidence}%</span>
                </div>
              </ModalField>
            ) : (
              <div />
            )}
          </div>

          {draft.status !== "draft" && (
            <ModalField label="Performance Potential">
              <div className="flex items-center h-10 px-3 bg-surface-2 rounded-lg border border-border">
                <TierBadge tier={draft.tier} />
              </div>
            </ModalField>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2/40 p-4">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="text-xs font-semibold text-destructive hover:underline"
            >
              Delete post
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold hover:bg-surface-2 active:scale-95"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/95 active:scale-95"
            >
              <Save className="h-3.5 w-3.5" />
              {isNew ? "Create" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/80">
        {label}
      </div>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type GridCell = { year: number; month: number; day: number; inMonth: boolean };

function buildMonthGrid(year: number, month: number): GridCell[] {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells: GridCell[] = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const date = new Date(year, month - 1, d);
    cells.push({ year: date.getFullYear(), month: date.getMonth(), day: d, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ year, month, day: d, inMonth: true });
  }
  while (cells.length < 42) {
    const next = cells.length - (startWeekday + daysInMonth) + 1;
    const date = new Date(year, month + 1, next);
    cells.push({
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      inMonth: false,
    });
  }
  return cells;
}

function formatDayLabel(yyyymmdd: string) {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
