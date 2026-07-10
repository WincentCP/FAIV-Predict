"use client";

import { fetchWithRetry } from "@/lib/fetch-retry";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { SectionHeader } from "@/components/SectionHeader";
import { TierBadge } from "@/components/TierBadge";
import { type Tier, type ContentFormat, type Brand, brandHandle } from "@/lib/types";
import {
  UploadCloud,
  Download,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  List,
  X,
  Plus,
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type CalendarEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:00 from the prediction's post_hour feature
  account: string;
  brand: string;
  format: ContentFormat;
  caption: string;
  title: string;
  tier: Tier;
  confidence: number | null;
};

type ImportReport = {
  total: number;
  predicted: number;
  skipped: number;
  failed: number;
  running: boolean;
  errors: string[];
};

type CsvField = "brand" | "format" | "caption" | "date" | "time";

type CsvStage = {
  fileName: string;
  headers: string[];
  rows: string[][];
  mapping: Record<CsvField, number>; // header index per field, -1 = unmapped
};

const CSV_FIELDS: { field: CsvField; label: string; required: boolean }[] = [
  { field: "brand", label: "Brand", required: true },
  { field: "format", label: "Format", required: true },
  { field: "caption", label: "Caption", required: true },
  { field: "date", label: "Date", required: false },
  { field: "time", label: "Time", required: false },
];

// Header synonyms so exports from different tools map automatically.
const CSV_SYNONYMS: Record<CsvField, string[]> = {
  brand: ["brand", "account", "client", "brand_name", "akun", "brand name"],
  format: ["format", "type", "media", "media_type", "content_type", "content format"],
  caption: ["caption", "text", "content", "copy", "teks", "description"],
  date: ["date", "scheduled", "scheduled_date", "day", "tanggal", "publish date"],
  time: ["time", "hour", "jam", "post_time", "posting time"],
};

function detectColumns(headers: string[]): Record<CsvField, number> {
  // Compare with spacing/punctuation stripped so "Media Type", "media_type",
  // and "MediaType" all match the same synonym.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalized = headers.map(norm);
  const mapping = { brand: -1, format: -1, caption: -1, date: -1, time: -1 } as Record<CsvField, number>;
  for (const field of Object.keys(CSV_SYNONYMS) as CsvField[]) {
    for (const syn of CSV_SYNONYMS[field]) {
      const idx = normalized.indexOf(norm(syn));
      if (idx !== -1) {
        mapping[field] = idx;
        break;
      }
    }
  }
  return mapping;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALLOWED_FORMATS: ContentFormat[] = ["Reels", "Carousel", "Single Image"];

const today = new Date();
const yyyy = today.getFullYear();
const mm = today.getMonth();
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function CalendarPage() {
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: yyyy, m: mm });
  const [view, setView] = useState<"month" | "list">("month");
  const [editing, setEditing] = useState<CalendarEntry | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [brandsList, setBrandsList] = useState<Brand[]>([]);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const loadPredictions = useCallback(async () => {
    try {
      const res = await fetchWithRetry("/api/history");
      if (!res.ok) {
        throw new Error("Could not load predictions");
      }
      const data = await res.json();
      const mapped: CalendarEntry[] = (data || []).map((p: any) => ({
        id: p.id,
        date: p.scheduled_date ? p.scheduled_date : p.when.split("T")[0],
        time: typeof p.post_hour === "number" ? `${String(p.post_hour).padStart(2, "0")}:00` : null,
        account: p.account || "@unknown",
        brand: p.brand || "Unknown Brand",
        format: p.format as ContentFormat,
        caption: p.caption,
        title: p.title || "",
        tier: p.tier as Tier,
        confidence: p.confidence ?? null,
      }));
      setEntries(mapped);
      setLoadError(null);
    } catch {
      setLoadError("The prediction history could not be loaded.");
    }
  }, []);

  useEffect(() => {
    loadPredictions();

    async function loadBrands() {
      try {
        const res = await fetchWithRetry("/api/brands");
        if (res.ok) {
          const data = await res.json();
          setBrandsList(data || []);
        }
      } catch {
        // brand resolution simply unavailable; imports will report it per-row
      }
    }
    loadBrands();
  }, [loadPredictions]);

  const monthEntries = useMemo(
    () =>
      entries.filter((e) => {
        const d = new Date(e.date);
        return d.getFullYear() === cursor.y && d.getMonth() === cursor.m;
      }),
    [entries, cursor],
  );

  const grid = useMemo(() => buildMonthGrid(cursor.y, cursor.m), [cursor]);

  const resolveBrand = useCallback(
    (identifier: string): Brand | undefined => {
      const needle = identifier.trim().toLowerCase().replace(/^@/, "");
      return brandsList.find(
        (b) =>
          b.name.toLowerCase() === identifier.trim().toLowerCase() ||
          brandHandle(b.name).replace(/^@/, "") === needle
      );
    },
    [brandsList]
  );

  // ------- CSV Import: upload → detect columns → review → confirm → score -------
  const [csvStage, setCsvStage] = useState<CsvStage | null>(null);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) {
      setImportReport({
        total: 0, predicted: 0, skipped: 0, failed: 0, running: false,
        errors: ["The file has no data rows. Expected a header row plus content rows."],
      });
      return;
    }
    const headers = rows[0].map((h) => h.trim());
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
    setImportReport(null);
    setCsvStage({
      fileName: file.name,
      headers,
      rows: dataRows,
      mapping: detectColumns(headers),
    });
  };

  // Row-level validation, recomputed live as the user adjusts column mapping.
  const csvValidation = useMemo(() => {
    if (!csvStage) return null;
    const { rows, mapping } = csvStage;
    const seenInFile = new Set<string>();
    const alreadyPredicted = new Set(
      entries.map((en) => `${en.brand}||${en.caption}`.toLowerCase())
    );
    const results = rows.map((row) => {
      const get = (f: CsvField) => (mapping[f] >= 0 ? (row[mapping[f]] || "").trim() : "");
      const brandValue = get("brand");
      const formatValue = get("format");
      const caption = get("caption");
      const dateValue = get("date");
      const timeValue = get("time");
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!caption) errors.push("empty caption");
      if (!ALLOWED_FORMATS.includes(formatValue as ContentFormat))
        errors.push(`format "${formatValue || "—"}" must be Reels, Carousel, or Single Image`);
      const brand = resolveBrand(brandValue);
      if (!brand) errors.push(`brand "${brandValue || "—"}" is not registered`);
      if (dateValue && !/^\d{4}-\d{2}-\d{2}$/.test(dateValue))
        warnings.push("date will be ignored (use YYYY-MM-DD)");
      if (caption && caption.length < 10) warnings.push("suspiciously short caption");
      const key = `${brandValue}||${caption}`.toLowerCase();
      if (caption && seenInFile.has(key)) warnings.push("duplicate of another row in this file");
      seenInFile.add(key);
      if (caption && brand && alreadyPredicted.has(`${brand.name}||${caption}`.toLowerCase()))
        warnings.push("this caption was already predicted before");
      return { brand, formatValue, caption, dateValue, timeValue, errors, warnings };
    });
    return { results, importable: results.filter((r) => r.errors.length === 0) };
  }, [csvStage, entries, resolveBrand]);

  const runImport = async () => {
    if (!csvStage || !csvValidation) return;
    const valid = csvValidation.importable;
    const skipped = csvValidation.results.length - valid.length;
    setCsvStage(null);

    const report: ImportReport = {
      total: csvValidation.results.length, predicted: 0, skipped, failed: 0, running: true,
      errors: skipped > 0 ? [`${skipped} row${skipped === 1 ? "" : "s"} excluded during review (validation errors).`] : [],
    };
    setImportReport({ ...report });

    for (let idx = 0; idx < valid.length; idx++) {
      const r = valid[idx];
      const hourMatch = r.timeValue.match(/^(\d{1,2})/);
      const postHour = hourMatch ? Math.min(23, Math.max(0, parseInt(hourMatch[1], 10))) : 19;
      try {
        const res = await fetch("/api/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caption: r.caption,
            format: r.formatValue,
            post_hour: postHour,
            brand_id: r.brand!.id,
            niche: r.brand!.niche,
            scheduled_date: /^\d{4}-\d{2}-\d{2}$/.test(r.dateValue) ? r.dateValue : undefined,
          }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.predicted_class) {
          report.predicted++;
        } else {
          report.failed++;
          report.errors.push(`"${r.caption.slice(0, 40)}…": ${data?.message || "prediction failed"}.`);
        }
      } catch {
        report.failed++;
        report.errors.push(`"${r.caption.slice(0, 40)}…": prediction service unreachable.`);
      }
      setImportReport({ ...report });
    }

    report.running = false;
    setImportReport({ ...report });
    await loadPredictions();
  };

  // ------- CSV Export of the visible month -------
  const handleExport = () => {
    const header = ["date", "time", "brand", "account", "format", "caption", "predicted_tier", "confidence"];
    const lines = [header.join(",")];
    for (const e of monthEntries) {
      lines.push(
        [
          e.date,
          e.time ?? "",
          csvEscape(e.brand),
          e.account,
          e.format,
          csvEscape(e.caption),
          e.tier,
          e.confidence != null ? `${e.confidence}%` : "",
        ].join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `faiv-calendar-${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async (next: CalendarEntry) => {
    setEditing(null);
    try {
      const res = await fetch("/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: next.id,
          scheduled_date: next.date,
          caption: next.caption,
          title: next.title,
        }),
      });
      if (!res.ok) throw new Error();
      setEntries((prev) => prev.map((e) => (e.id === next.id ? next : e)));
    } catch {
      setLoadError("Saving the change failed — the database rejected the update.");
    }
  };

  const handleDelete = async (id: string) => {
    setEditing(null);
    try {
      const res = await fetch("/api/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error();
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setLoadError("Deleting the prediction failed — the database rejected the delete.");
    }
  };

  const goPrev = () =>
    setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const goNext = () =>
    setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));
  const goToday = () => setCursor({ y: yyyy, m: mm });

  // Drag and drop between dates → persists scheduled_date
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDropOnDate = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDate(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;

    const prevEntries = entries;
    setEntries((prev) =>
      prev.map((item) => (item.id === id ? { ...item, date: targetDate } : item))
    );

    try {
      const res = await fetch("/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, scheduled_date: targetDate }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setEntries(prevEntries); // roll back the optimistic move
      setLoadError("Rescheduling failed — the database rejected the update.");
    }
  };

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto">
      <SectionHeader
        eyebrow="Content Planning"
        title="Content Calendar"
        description="Every scored prediction on its scheduled date. Drag posts between dates to reschedule; import a CSV to score drafts in batch."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelected}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={importReport?.running}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:bg-surface-2 disabled:opacity-60"
            >
              {importReport?.running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UploadCloud className="h-3.5 w-3.5" />
              )}
              Import CSV
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={monthEntries.length === 0}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/95 disabled:opacity-60"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
        }
      />

      {loadError && (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4 flex items-center gap-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="font-semibold text-destructive">{loadError}</span>
          <button
            type="button"
            onClick={() => { setLoadError(null); loadPredictions(); }}
            className="ml-auto rounded-lg border border-border bg-surface px-3 py-1.5 font-semibold hover:bg-surface-2"
          >
            Retry
          </button>
        </div>
      )}

      {importReport && (
        <div
          className={cn(
            "mt-6 rounded-xl border p-4 text-xs space-y-2",
            importReport.running
              ? "border-primary/25 bg-primary/[0.03]"
              : importReport.failed > 0
              ? "border-warning/30 bg-warning/[0.03]"
              : "border-accent-lime/30 bg-accent-lime/[0.04]"
          )}
        >
          <div className="flex items-center gap-2 font-bold text-foreground">
            {importReport.running ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-accent-lime-strong" />
            )}
            {importReport.running ? "Scoring imported rows…" : "Import finished"}
            <span className="font-mono font-semibold text-muted-foreground">
              {importReport.predicted} predicted · {importReport.skipped} skipped · {importReport.failed} failed
              {importReport.total > 0 && ` (of ${importReport.total})`}
            </span>
            {!importReport.running && (
              <button
                type="button"
                onClick={() => setImportReport(null)}
                className="ml-auto grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-surface-2"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {importReport.errors.length > 0 && (
            <ul className="list-disc pl-5 text-muted-foreground space-y-0.5 max-h-28 overflow-y-auto">
              {importReport.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* CSV review: nothing imports until the user confirms here */}
      {csvStage && csvValidation && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-4 backdrop-blur-sm"
          onClick={() => setCsvStage(null)}
        >
          <div
            className="relative w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden rounded-3xl border border-border bg-surface/95 backdrop-blur-2xl shadow-[var(--shadow-elevated)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border p-5 shrink-0">
              <div>
                <h3 className="font-display text-base font-bold text-foreground">Review CSV import</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {csvStage.fileName} · {csvStage.rows.length} data row{csvStage.rows.length === 1 ? "" : "s"} —
                  nothing is imported until you confirm.
                </p>
              </div>
              <button
                onClick={() => setCsvStage(null)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                aria-label="Cancel import"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto flex-1">
              {/* Column mapping */}
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Column mapping <span className="font-normal normal-case">(auto-detected — adjust if wrong)</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-5">
                  {CSV_FIELDS.map(({ field, label, required }) => (
                    <label key={field} className="block">
                      <span className="text-[10px] font-semibold text-foreground">
                        {label}
                        {required ? <span className="text-destructive"> *</span> : ""}
                      </span>
                      <select
                        value={csvStage.mapping[field]}
                        onChange={(e) =>
                          setCsvStage({
                            ...csvStage,
                            mapping: { ...csvStage.mapping, [field]: Number(e.target.value) },
                          })
                        }
                        className={cn(
                          "mt-1 h-9 w-full rounded-lg border bg-surface px-2 text-xs outline-none",
                          required && csvStage.mapping[field] === -1
                            ? "border-destructive/50"
                            : "border-border"
                        )}
                      >
                        <option value={-1}>— not in file —</option>
                        {csvStage.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              {/* Validation summary */}
              <div
                className={cn(
                  "rounded-xl border p-3.5 text-xs font-semibold",
                  csvValidation.importable.length === 0
                    ? "border-destructive/30 bg-destructive/[0.04] text-destructive"
                    : "border-accent-lime/30 bg-accent-lime/[0.04] text-foreground"
                )}
              >
                {csvValidation.importable.length} of {csvValidation.results.length} rows will be imported
                and scored.{" "}
                {csvValidation.results.length - csvValidation.importable.length > 0 &&
                  `${csvValidation.results.length - csvValidation.importable.length} will be skipped (errors below).`}{" "}
                {csvValidation.results.some((r) => r.warnings.length > 0) &&
                  "Rows with warnings still import."}
              </div>

              {/* Preview table (first 8 rows) */}
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/40 text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
                      <th className="px-3 py-2.5 w-8">#</th>
                      <th className="px-3 py-2.5">Brand</th>
                      <th className="px-3 py-2.5">Format</th>
                      <th className="px-3 py-2.5">Caption</th>
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {csvValidation.results.slice(0, 8).map((r, i) => (
                      <tr key={i} className={r.errors.length > 0 ? "opacity-60" : undefined}>
                        <td className="px-3 py-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2.5 font-semibold">{r.brand?.name || "—"}</td>
                        <td className="px-3 py-2.5">{r.formatValue || "—"}</td>
                        <td className="px-3 py-2.5 max-w-[200px] truncate italic text-muted-foreground">
                          {r.caption || "—"}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[10px]">{r.dateValue || "—"}</td>
                        <td className="px-3 py-2.5">
                          {r.errors.length > 0 ? (
                            <span className="text-[10px] font-bold text-destructive" title={r.errors.join("; ")}>
                              Skipped: {r.errors[0]}
                            </span>
                          ) : r.warnings.length > 0 ? (
                            <span className="text-[10px] font-bold text-warning" title={r.warnings.join("; ")}>
                              Warning: {r.warnings[0]}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-600">Ready</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {csvValidation.results.length > 8 && (
                  <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
                    …and {csvValidation.results.length - 8} more row
                    {csvValidation.results.length - 8 === 1 ? "" : "s"} (validated the same way).
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/40 p-4 shrink-0">
              <button
                onClick={() => setCsvStage(null)}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={runImport}
                disabled={csvValidation.importable.length === 0}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/95 disabled:opacity-50"
              >
                Import {csvValidation.importable.length} post
                {csvValidation.importable.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls: month navigation + view switcher */}
      <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-4 border border-border bg-surface/40 p-3 rounded-xl">
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

        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-1 text-xs w-full md:w-auto justify-center">
          {(
            [
              { id: "month", label: "Calendar", icon: CalendarIcon },
              { id: "list", label: "List", icon: List },
            ] as const
          ).map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={cn(
                "flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition active:scale-95",
                view === v.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <v.icon className="h-3.5 w-3.5" />
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {/* MONTH GRID */}
        {view === "month" && (
          <section className="overflow-hidden rounded-xl border border-border bg-surface/30">
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
                      "group relative min-h-[130px] border-b border-r border-border p-2.5 transition-colors hover:bg-surface-2/30",
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
                        <Link
                          href="/predict"
                          className="grid h-5 w-5 place-items-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-surface-3 transition-opacity"
                          aria-label="Analyze a new post"
                          title="Analyze a new post"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>

                    <div className="space-y-2">
                      {dayEntries.slice(0, 3).map((e) => (
                        <div
                          key={e.id}
                          draggable
                          onDragStart={(evt) => handleDragStart(evt, e.id)}
                          onClick={() => setEditing(e)}
                          className="relative flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 cursor-grab active:cursor-grabbing hover:border-border-strong hover:shadow-xs transition-all text-[10px]"
                        >
                          <div className="flex items-center gap-1.5">
                            <div className="h-6 w-6 rounded bg-gradient-to-br from-primary/10 to-primary/30 flex items-center justify-center font-bold text-[8px] text-primary shrink-0">
                              {e.format[0]}
                            </div>
                            <div className="min-w-0 flex-1 leading-tight">
                              <span className="font-mono font-bold text-foreground truncate block">
                                {e.account}
                              </span>
                              {e.time && (
                                <span className="text-[8px] text-muted-foreground font-semibold">{e.time}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-1.5 border-t border-border/40 pt-1.5">
                            <span className="rounded border border-border bg-surface-2 px-1 py-0.5 text-[8px] font-bold text-muted-foreground font-mono">
                              {e.format}
                            </span>
                            <TierBadge tier={e.tier} className="scale-90 origin-right" />
                          </div>
                        </div>
                      ))}
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

        {/* LIST VIEW */}
        {view === "list" && (
          <section className="overflow-hidden rounded-xl border border-border bg-surface/30 shadow-[var(--shadow-soft)]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-border bg-surface-2/60 text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
                    <th className="px-6 py-4 font-semibold">Date</th>
                    <th className="px-6 py-4 font-semibold">Time</th>
                    <th className="px-6 py-4 font-semibold">Account</th>
                    <th className="px-6 py-4 font-semibold">Format</th>
                    <th className="px-6 py-4 font-semibold">Caption Preview</th>
                    <th className="px-6 py-4 font-semibold text-center">Confidence</th>
                    <th className="px-6 py-4 font-semibold">Tier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {monthEntries
                    .slice()
                    .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))
                    .map((r) => {
                      const [y, m, d] = r.date.split("-").map(Number);
                      const dateObj = new Date(y, m - 1, d);
                      const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short" });

                      return (
                        <tr
                          key={r.id}
                          onClick={() => setEditing(r)}
                          className="cursor-pointer hover:bg-surface-2/40 transition-colors group/row"
                        >
                          <td className="px-6 py-4 align-middle">
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col items-center justify-center shrink-0 w-11 h-11 rounded-lg bg-surface-2 border border-border transition-colors group-hover/row:border-primary/30">
                                <span className="text-[9px] uppercase font-extrabold text-muted-foreground/80 tracking-wider leading-none">
                                  {weekday}
                                </span>
                                <span className="text-sm font-extrabold text-foreground leading-none mt-1">
                                  {dateObj.getDate()}
                                </span>
                              </div>
                              <span className="text-xs font-bold text-foreground">
                                {dateObj.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 align-middle font-mono text-xs font-semibold">
                            {r.time ?? "—"}
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <div className="max-w-[140px] truncate font-bold text-foreground" title={r.account}>
                              {r.account}
                            </div>
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <span className="rounded border border-border bg-surface px-2 py-0.5 text-xs text-muted-foreground font-mono font-semibold">
                              {r.format}
                            </span>
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <div className="max-w-[280px] truncate text-xs text-muted-foreground italic" title={r.caption}>
                              &quot;{r.caption}&quot;
                            </div>
                          </td>
                          <td className="px-6 py-4 align-middle text-center font-mono text-xs font-semibold tabular-nums">
                            {r.confidence != null ? `${r.confidence}%` : "—"}
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <TierBadge tier={r.tier} />
                          </td>
                        </tr>
                      );
                    })}
                  {monthEntries.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-10 text-center text-xs text-muted-foreground">
                        No predictions scheduled this month. Analyze a post or import a CSV to populate the calendar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {editing && (
        <EntryModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={() => handleDelete(editing.id)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry Modal — edits persist through /api/history PATCH
// ---------------------------------------------------------------------------
function EntryModal({
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  initial: CalendarEntry;
  onClose: () => void;
  onSave: (next: CalendarEntry) => void;
  onDelete: () => void;
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
              Edit Scheduled Prediction
            </div>
            <h3 className="mt-1 font-display text-sm font-bold">
              {formatDayLabel(draft.date)} · {draft.account}
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
          <ModalField label="Scheduled Date">
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
            />
          </ModalField>

          <ModalField label="Title / Note">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
              placeholder="Optional label for this post"
            />
          </ModalField>

          <ModalField label="Caption Text">
            <textarea
              value={draft.caption}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              rows={4}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-primary"
            />
          </ModalField>

          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/50 px-3 py-2.5">
            <div className="text-[10px] text-muted-foreground font-semibold">
              Predicted result
              <span className="block text-[9px] font-normal">
                Re-run the analysis on the Prediction page after editing the caption.
              </span>
            </div>
            <div className="flex items-center gap-2">
              {draft.confidence != null && (
                <span className="font-mono text-xs font-bold tabular-nums">{draft.confidence}%</span>
              )}
              <TierBadge tier={draft.tier} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2/40 p-4">
          <button
            type="button"
            onClick={onDelete}
            className="text-xs font-semibold text-destructive hover:underline"
          >
            Delete prediction
          </button>
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
              Save Changes
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

/** Minimal CSV parser with support for quoted fields and escaped quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
