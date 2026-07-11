"use client";

import { fetchWithRetry } from "@/lib/fetch-retry";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { type ContentFormat, type Brand, normalizeBrandReference } from "@/lib/types";
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
  time: string | null;
  account: string;
  brand: string;
  format: ContentFormat | "Unspecified";
  caption: string;
  title: string;
  brand_id: string | null;
  visualReference: string;
  voiceOver: "Need" | "No Need" | "Done" | null;
  pic: string;
  status: "Need Shooting" | "Need Design" | "Need Editing" | "Screening" | "Ready to Post" | "Posted" | null;
  source: "manual" | "import";
  createdAt: string | null;
};

type ImportReport = {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  running: boolean;
  errors: string[];
};

type CsvField = "number" | "brand" | "format" | "contentDetails" | "visualReference" | "caption" | "voiceOver" | "pic" | "status" | "date" | "time";

type CsvStage = {
  fileName: string;
  headers: string[];
  rows: string[][];
  mapping: Record<CsvField, number>; // header index per field, -1 = unmapped
};

const CALENDAR_STATUSES = [
  "Need Shooting",
  "Need Design",
  "Need Editing",
  "Screening",
  "Ready to Post",
  "Posted",
] as const;

const VOICE_OVER_VALUES = ["Need", "No Need", "Done"] as const;

const CSV_FIELDS: { field: CsvField; label: string; required: boolean }[] = [
  { field: "number", label: "No.", required: false },
  { field: "date", label: "Posting Date", required: true },
  { field: "time", label: "Time", required: false },
  { field: "brand", label: "Brand", required: false },
  { field: "format", label: "Type", required: false },
  { field: "contentDetails", label: "Content Details", required: false },
  { field: "visualReference", label: "Visual Reference", required: false },
  { field: "caption", label: "Caption", required: false },
  { field: "voiceOver", label: "Voice Over", required: false },
  { field: "pic", label: "PIC", required: false },
  { field: "status", label: "Status", required: false },
];

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5_000;

// Header synonyms so exports from different tools map automatically.
const CSV_SYNONYMS: Record<CsvField, string[]> = {
  number: ["no", "no.", "number", "nomor", "#"],
  brand: ["brand", "account", "client", "brand_name", "akun", "brand name"],
  format: ["format", "type", "media", "media_type", "content_type", "content format"],
  caption: ["caption", "text", "content", "copy", "teks", "description"],
  date: ["date", "scheduled", "scheduled_date", "day", "tanggal", "publish date", "posting date", "tanggal posting"],
  time: ["time", "hour", "jam", "post_time", "posting time"],
  contentDetails: ["content details", "content detail", "details", "detail konten", "judul", "topic"],
  visualReference: ["visual reference", "visual", "reference", "referensi visual", "link visual"],
  voiceOver: ["voice over", "voiceover", "vo"],
  pic: ["pic", "person in charge", "owner", "assignee"],
  status: ["status", "workflow status", "progress"],
};

function detectColumns(headers: string[]): Record<CsvField, number> {
  // Compare with spacing/punctuation stripped so "Media Type", "media_type",
  // and "MediaType" all match the same synonym.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalized = headers.map(norm);
  const mapping = Object.fromEntries(
    (Object.keys(CSV_SYNONYMS) as CsvField[]).map((field) => [field, -1])
  ) as Record<CsvField, number>;
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

function detectHeaderRow(rows: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  rows.slice(0, 20).forEach((row, index) => {
    const mapping = detectColumns(row.map((cell) => String(cell || "").trim()));
    const matched = Object.values(mapping).filter((column) => column >= 0).length;
    const score = matched + (mapping.date >= 0 ? 4 : 0) + (mapping.caption >= 0 ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

  const loadCalendar = useCallback(async () => {
    try {
      const res = await fetchWithRetry("/api/calendar");
      if (!res.ok) {
        throw new Error("Could not load calendar entries");
      }
      const data = await res.json();
      const mapped: CalendarEntry[] = (data || []).map((entry: any) => ({
        id: entry.id,
        date: entry.posting_date,
        time: entry.posting_time ? String(entry.posting_time).slice(0, 5) : null,
        account: entry.brands?.name || "Unassigned",
        brand: entry.brands?.name || "Unassigned",
        brand_id: entry.brand_id || null,
        format: normalizeFormat(entry.content_type),
        caption: entry.caption || "",
        title: entry.content_details || "",
        visualReference: entry.visual_reference || "",
        voiceOver: entry.voice_over || null,
        pic: entry.pic || "",
        status: entry.status || null,
        source: entry.source === "import" ? "import" : "manual",
        createdAt: entry.created_at || null,
      }));
      setEntries(mapped);
      setLoadError(null);
    } catch {
      setLoadError("The content calendar could not be loaded. Apply the ownership migration if this is the first production run.");
    }
  }, []);

  useEffect(() => {
    loadCalendar();

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
  }, [loadCalendar]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const syncView = () => {
      if (media.matches) setView("list");
    };
    syncView();
    media.addEventListener("change", syncView);
    return () => media.removeEventListener("change", syncView);
  }, []);

  const monthEntries = useMemo(
    () =>
      entries.filter((e) => {
        const [year, month] = e.date.split("-").map(Number);
        return year === cursor.y && month === cursor.m + 1;
      }),
    [entries, cursor],
  );

  const grid = useMemo(() => buildMonthGrid(cursor.y, cursor.m), [cursor]);

  const resolveBrand = useCallback(
    (identifier: string): Brand | undefined => {
      const needle = normalizeBrandReference(identifier);
      return brandsList.find(
        (b) => normalizeBrandReference(b.name) === needle
      );
    },
    [brandsList]
  );

  // ------- CSV/XLSX Import: parse → detect columns → review → confirm -------
  const [csvStage, setCsvStage] = useState<CsvStage | null>(null);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setImportReport({
        total: 0, imported: 0, skipped: 0, failed: 0, running: false,
        errors: ["Choose a CSV or XLSX content-calendar file."],
      });
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setImportReport({
        total: 0, imported: 0, skipped: 0, failed: 0, running: false,
        errors: ["The spreadsheet is larger than 10 MB. Split it into smaller calendar files before importing."],
      });
      return;
    }

    let rows: string[][];
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const ExcelJS = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer() as any);
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error("The workbook has no readable worksheet.");
        rows = [];
        sheet.eachRow({ includeEmpty: true }, (row) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : [];
          rows.push(values.map(excelCellToString));
        });
      } else {
        rows = parseCsv(await file.text());
      }
    } catch (error: any) {
      setImportReport({
        total: 0, imported: 0, skipped: 0, failed: 0, running: false,
        errors: [error.message || "The spreadsheet could not be read."],
      });
      return;
    }
    if (rows.length < 2) {
      setImportReport({
        total: 0, imported: 0, skipped: 0, failed: 0, running: false,
        errors: ["The file has no data rows. Expected a header row plus content rows."],
      });
      return;
    }
    if (rows.length - 1 > MAX_IMPORT_ROWS) {
      setImportReport({
        total: rows.length - 1, imported: 0, skipped: rows.length - 1, failed: 0, running: false,
        errors: [`This file contains more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it into smaller calendar files before review.`],
      });
      return;
    }
    const headerIndex = detectHeaderRow(rows);
    const headers = rows[headerIndex].map((h) => String(h || "").trim());
    const dataRows = rows
      .slice(headerIndex + 1)
      .map((row) => row.map((cell) => String(cell || "")))
      .filter((r) => r.some((c) => c.trim() !== ""));
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
    const existingEntries = new Set(
      entries.map((entry) => `${entry.date}||${entry.brand}||${entry.caption}`.toLowerCase())
    );
    const results = rows.map((row) => {
      const get = (f: CsvField) => (mapping[f] >= 0 ? (row[mapping[f]] || "").trim() : "");
      const brandValue = get("brand");
      const formatRaw = get("format");
      const formatValue = normalizeFormat(formatRaw);
      const caption = get("caption");
      const dateValue = normalizeDate(get("date"));
      const timeValue = get("time");
      const contentDetails = get("contentDetails");
      const visualReference = get("visualReference");
      const voiceOver = normalizeVoiceOver(get("voiceOver"));
      const pic = get("pic");
      const status = normalizeStatus(get("status"));
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!dateValue) errors.push("posting date is missing or not recognized");
      if (!formatRaw) warnings.push("content type missing; imported as Unspecified");
      else if (formatValue === "Unspecified") warnings.push(`content type "${formatRaw}" was not recognized; imported as Unspecified`);
      const brand = brandValue ? resolveBrand(brandValue) : undefined;
      if (brandValue && !brand) warnings.push(`brand "${brandValue}" is not registered; imported as unassigned`);
      if (get("voiceOver") && !voiceOver) warnings.push("voice-over value ignored; use Need, No Need, or Done");
      if (get("status") && !status) warnings.push("status value ignored because it is not in the supported workflow");
      if (caption && caption.length < 10) warnings.push("suspiciously short caption");
      const key = `${dateValue}||${brandValue}||${caption}`.toLowerCase();
      if (caption && seenInFile.has(key)) warnings.push("duplicate of another row in this file");
      seenInFile.add(key);
      if (dateValue && existingEntries.has(`${dateValue}||${brand?.name || "Unassigned"}||${caption}`.toLowerCase()))
        warnings.push("a matching calendar entry already exists");
      return {
        brand, formatValue, caption, dateValue, timeValue, contentDetails,
        visualReference, voiceOver, pic, status, errors, warnings,
      };
    });
    return { results, importable: results.filter((r) => r.errors.length === 0) };
  }, [csvStage, entries, resolveBrand]);

  const runImport = async () => {
    if (!csvStage || !csvValidation) return;
    const valid = csvValidation.importable;
    const skipped = csvValidation.results.length - valid.length;
    setCsvStage(null);

    const report: ImportReport = {
      total: csvValidation.results.length, imported: 0, skipped, failed: 0, running: true,
      errors: skipped > 0 ? [`${skipped} row${skipped === 1 ? "" : "s"} excluded during review (validation errors).`] : [],
    };
    setImportReport({ ...report });

    if (valid.length === 0) {
      report.running = false;
      report.errors.push("No importable rows remain. Review the posting-date mapping and validation messages.");
      setImportReport({ ...report });
      return;
    }

    const payloads = valid.map((row) => ({
      brand_id: row.brand?.id || null,
      posting_date: row.dateValue,
      posting_time: normalizeTime(row.timeValue),
      content_type: row.formatValue,
      content_details: row.contentDetails,
      visual_reference: row.visualReference,
      caption: row.caption,
      voice_over: row.voiceOver,
      pic: row.pic,
      status: row.status,
    }));
    for (let start = 0; start < payloads.length; start += 500) {
      const batch = payloads.slice(start, start + 500);
      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: batch }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.message || "calendar import failed");
        report.imported += Array.isArray(data?.entries) ? data.entries.length : batch.length;
      } catch (error: any) {
        report.failed += batch.length;
        report.errors.push(`Rows ${start + 1}–${start + batch.length}: ${error.message || "import failed"}`);
      }
      setImportReport({ ...report });
    }

    report.running = false;
    setImportReport({ ...report });
    await loadCalendar();
  };

  // ------- Editable CSV export of the visible month -------
  const handleExportCsv = () => {
    const header = ["posting_date", "time", "brand", "type", "content_details", "visual_reference", "caption", "voice_over", "pic", "status"];
    const lines = [header.join(",")];
    for (const e of monthEntries) {
      lines.push(
        [
          e.date,
          e.time ?? "",
          csvEscape(e.brand),
          e.format,
          csvEscape(e.title),
          csvEscape(e.visualReference),
          csvEscape(e.caption),
          e.voiceOver || "",
          csvEscape(e.pic),
          e.status || "",
        ].join(",")
      );
    }
    const blob = new Blob(["\uFEFF", lines.join("\n")], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `faiv-calendar-${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}.csv`);
  };

  const handleExportXlsx = async () => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FAIV Predict";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Content Calendar", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "Posting Date", width: 14 }, { header: "Time", width: 10 },
      { header: "Brand", width: 22 }, { header: "Type", width: 16 },
      { header: "Content Details", width: 30 }, { header: "Visual Reference", width: 30 },
      { header: "Caption", width: 48 }, { header: "Voice Over", width: 14 },
      { header: "PIC", width: 20 }, { header: "Status", width: 20 },
    ];
    for (const entry of monthEntries) {
      sheet.addRow([
        entry.date, entry.time || "", entry.brand === "Unassigned" ? "" : entry.brand,
        entry.format, entry.title, entry.visualReference, entry.caption,
        entry.voiceOver || "", entry.pic, entry.status || "",
      ]);
    }
    const header = sheet.getRow(1);
    header.height = 24;
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B41B8" } };
    header.alignment = { vertical: "middle" };
    sheet.autoFilter = { from: "A1", to: "J1" };
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
    });
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `faiv-calendar-${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}.xlsx`,
    );
  };

  const handleExportPdf = async () => {
    const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const autoTable = autoTableModule.default;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`Content Calendar — ${MONTH_NAMES[cursor.m]} ${cursor.y}`, 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text("Exported from FAIV Predict. Only user-created and imported planning records are included.", 14, 22);
    autoTable(doc, {
      startY: 28,
      head: [["Date", "Time", "Brand", "Type", "Content", "Caption", "VO", "PIC", "Status"]],
      body: monthEntries.map((entry) => [
        entry.date, entry.time || "—", entry.brand, entry.format, entry.title || "—",
        entry.caption || "—", entry.voiceOver || "—", entry.pic || "—", entry.status || "—",
      ]),
      styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: [91, 65, 184], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 247, 251] },
      columnStyles: { 4: { cellWidth: 38 }, 5: { cellWidth: 55 } },
      margin: { left: 10, right: 10 },
    });
    doc.save(`faiv-calendar-${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}.pdf`);
  };

  const handleSave = async (next: CalendarEntry) => {
    setEditing(null);
    try {
      const isNew = next.id.startsWith("new:");
      const res = await fetch("/api/calendar", {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isNew ? {} : { id: next.id }),
          ...toCalendarPayload(next),
        }),
      });
      if (!res.ok) throw new Error();
      await loadCalendar();
    } catch {
      setLoadError("Saving the change failed — the database rejected the update.");
    }
  };

  const handleDelete = async (id: string) => {
    setEditing(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error();
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setLoadError("Deleting the calendar entry failed — the database rejected the delete.");
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
      const moved = entries.find((item) => item.id === id);
      if (!moved) throw new Error();
      const res = await fetch("/api/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...toCalendarPayload({ ...moved, date: targetDate }) }),
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
        description="Plan user-created content independently from prediction history. Import flexible spreadsheets, review mappings, and export presentation-ready schedules."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={handleFileSelected}
            />
            <button
              type="button"
              onClick={() => setEditing(blankCalendarEntry(
                ymd(cursor.y, cursor.m, Math.min(today.getDate(), new Date(cursor.y, cursor.m + 1, 0).getDate())),
                brandsList[0],
              ))}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/95"
            >
              <Plus className="h-3.5 w-3.5" />
              Add post
            </button>
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
              Import CSV/XLSX
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={monthEntries.length === 0}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:bg-surface-2 disabled:opacity-60"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <button type="button" onClick={handleExportXlsx} disabled={monthEntries.length === 0} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:bg-surface-2 disabled:opacity-60">
              <Download className="h-3.5 w-3.5" /> XLSX
            </button>
            <button type="button" onClick={handleExportPdf} disabled={monthEntries.length === 0} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:bg-surface-2 disabled:opacity-60">
              <Download className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
        }
      />

      {loadError && (
        <div role="alert" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4 flex items-center gap-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="font-semibold text-destructive">{loadError}</span>
          <button
            type="button"
            onClick={() => { setLoadError(null); loadCalendar(); }}
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
            {importReport.running ? "Importing reviewed rows…" : "Import finished"}
            <span className="font-mono font-semibold text-muted-foreground">
              {importReport.imported} imported · {importReport.skipped} skipped · {importReport.failed} failed
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

      {/* Spreadsheet review: nothing imports until the user confirms here */}
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
                <h3 className="font-display text-base font-bold text-foreground">Review spreadsheet import</h3>
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
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Column mapping <span className="font-normal normal-case">(auto-detected — adjust if wrong)</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {CSV_FIELDS.map(({ field, label, required }) => (
                    <label key={field} className="block">
                      <span className="text-xs font-semibold text-foreground">
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
                {csvValidation.importable.length} of {csvValidation.results.length} rows will be imported.{" "}
                {csvValidation.results.length - csvValidation.importable.length > 0 &&
                  `${csvValidation.results.length - csvValidation.importable.length} will be skipped (errors below).`}{" "}
                {csvValidation.results.some((r) => r.warnings.length > 0) &&
                  "Rows with warnings still import."}
              </div>

              {/* Preview table (first 8 rows) */}
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/40 text-xs uppercase tracking-wider text-muted-foreground font-bold">
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
                        <td className="px-3 py-2.5 font-mono text-xs">{r.dateValue || "—"}</td>
                        <td className="px-3 py-2.5">
                          {r.errors.length > 0 ? (
                            <span className="text-xs font-bold text-destructive" title={r.errors.join("; ")}>
                              Skipped: {r.errors[0]}
                            </span>
                          ) : r.warnings.length > 0 ? (
                            <span className="text-xs font-bold text-warning" title={r.warnings.join("; ")}>
                              Warning: {r.warnings[0]}
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-emerald-600">Ready</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {csvValidation.results.length > 8 && (
                  <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
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
              aria-pressed={view === v.id}
              className={cn(
                "flex-1 md:flex-none items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition active:scale-95",
                v.id === "month" ? "hidden md:inline-flex" : "inline-flex",
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
                  className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"
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
                        <button
                          type="button"
                          onClick={() => setEditing(blankCalendarEntry(dateStr, brandsList[0]))}
                          className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground opacity-100 hover:bg-surface-3 transition-colors md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                          aria-label="Add calendar entry"
                          title="Add calendar entry"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {dayEntries.slice(0, 3).map((e) => (
                        <button
                          type="button"
                          key={e.id}
                          draggable
                          onDragStart={(evt) => handleDragStart(evt, e.id)}
                          onClick={() => setEditing(e)}
                          className="relative flex w-full flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 text-left cursor-grab active:cursor-grabbing hover:border-border-strong hover:shadow-xs transition-colors text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Edit ${e.brand} ${e.format} planned for ${e.date}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center font-bold text-[8px] text-primary shrink-0">
                              {e.format[0]}
                            </div>
                            <div className="min-w-0 flex-1 leading-tight">
                              <span className="font-mono font-bold text-foreground truncate block">
                                {e.account}
                              </span>
                              {e.time && (
                                <span className="text-xs text-muted-foreground font-semibold">{e.time}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-1.5 border-t border-border/40 pt-1.5">
                            <span className="rounded border border-border bg-surface-2 px-1 py-0.5 text-xs font-bold text-muted-foreground font-mono">
                              {e.format}
                            </span>
                            {e.status && (
                              <span className="truncate rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">{e.status}</span>
                            )}
                          </div>
                        </button>
                      ))}
                      {dayEntries.length > 3 && (
                        <div className="px-1 text-xs font-bold text-primary">
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
            <div className="space-y-3 p-3 md:hidden">
              {monthEntries
                .slice()
                .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))
                .map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    onClick={() => setEditing(entry)}
                    className="w-full rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-foreground">{entry.brand}</div>
                        <div className="mt-1 text-xs font-semibold text-muted-foreground">
                          {formatDayLabel(entry.date)}{entry.time ? ` at ${entry.time}` : ""}
                        </div>
                      </div>
                      <span className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs font-semibold text-muted-foreground">
                        {entry.format}
                      </span>
                    </div>
                    {(entry.title || entry.caption) && (
                      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                        {entry.title || entry.caption}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <span>{entry.status || "No workflow status"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{entry.source === "import" ? "Spreadsheet import" : "Created manually"}</span>
                    </div>
                  </button>
                ))}
              {monthEntries.length === 0 && (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No planned content this month. Add an entry or import a CSV/XLSX calendar.
                </div>
              )}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-border bg-surface-2/60 text-xs uppercase tracking-wider text-muted-foreground font-bold">
                    <th className="px-6 py-4 font-semibold">Date</th>
                    <th className="px-6 py-4 font-semibold">Time</th>
                    <th className="px-6 py-4 font-semibold">Brand</th>
                    <th className="px-6 py-4 font-semibold">Format</th>
                    <th className="px-6 py-4 font-semibold">Caption Preview</th>
                    <th className="px-6 py-4 font-semibold">PIC</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 font-semibold">Origin</th>
                    <th className="px-6 py-4 font-semibold"><span className="sr-only">Actions</span></th>
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
                          className="hover:bg-surface-2/40 transition-colors group/row"
                        >
                          <td className="px-6 py-4 align-middle">
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col items-center justify-center shrink-0 w-11 h-11 rounded-lg bg-surface-2 border border-border transition-colors group-hover/row:border-primary/30">
                                <span className="text-xs uppercase font-extrabold text-muted-foreground/80 tracking-wider leading-none">
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
                          <td className="px-6 py-4 align-middle text-xs font-semibold text-muted-foreground">
                            {r.source === "import" ? "Spreadsheet import" : "Created manually"}
                          </td>
                          <td className="px-6 py-4 align-middle text-right">
                            <button type="button" onClick={() => setEditing(r)} className="h-9 rounded-lg border border-border bg-surface px-3 text-xs font-bold text-foreground hover:bg-surface-2">
                              Edit
                            </button>
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
                          <td className="px-6 py-4 align-middle text-xs font-semibold">
                            {r.pic || "—"}
                          </td>
                          <td className="px-6 py-4 align-middle">
                            {r.status ? (
                              <span className="rounded-full border border-border bg-surface-2 px-2 py-1 text-xs font-bold">{r.status}</span>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  {monthEntries.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-10 text-center text-xs text-muted-foreground">
                        No planned content this month. Add an entry or import a CSV/XLSX calendar.
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
          brands={brandsList}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={() => handleDelete(editing.id)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry Modal — edits persist through /api/calendar
// ---------------------------------------------------------------------------
function EntryModal({
  initial,
  brands,
  onClose,
  onSave,
  onDelete,
}: {
  initial: CalendarEntry;
  brands: Brand[];
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
        className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-surface shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border p-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-primary">
              {draft.id.startsWith("new:") ? "New Calendar Entry" : "Edit Calendar Entry"}
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

        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <ModalField label="Posting Date">
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
            />
          </ModalField>

          <ModalField label="Posting Time">
            <input type="time" value={draft.time || ""} onChange={(e) => setDraft({ ...draft, time: e.target.value || null })} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary" />
          </ModalField>

          <ModalField label="Brand">
            <select
              value={draft.brand_id || ""}
              onChange={(e) => {
                const brand = brands.find((item) => item.id === e.target.value);
                setDraft({ ...draft, brand_id: brand?.id || null, brand: brand?.name || "Unassigned", account: brand?.name || "Unassigned" });
              }}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
            >
              <option value="">Unassigned</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
          </ModalField>

          <ModalField label="Content Type">
            <select value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value as CalendarEntry["format"] })} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary">
              <option value="Unspecified">Unspecified</option><option value="Reels">Reels</option><option value="Carousel">Carousel</option><option value="Single Image">Single Image</option>
            </select>
          </ModalField>

          <ModalField label="Content Details">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary"
              placeholder="Optional label for this post"
            />
          </ModalField>

          <ModalField label="Visual Reference">
            <input type="text" value={draft.visualReference} onChange={(e) => setDraft({ ...draft, visualReference: e.target.value })} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary" placeholder="URL or production reference" />
          </ModalField>

          <div className="sm:col-span-2"><ModalField label="Caption Text">
            <textarea
              value={draft.caption}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              rows={4}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-primary"
            />
          </ModalField></div>

          <ModalField label="Voice Over">
            <select value={draft.voiceOver || ""} onChange={(e) => setDraft({ ...draft, voiceOver: (e.target.value || null) as CalendarEntry["voiceOver"] })} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary">
              <option value="">Not specified</option><option value="Need">Need</option><option value="No Need">No Need</option><option value="Done">Done</option>
            </select>
          </ModalField>

          <ModalField label="PIC">
            <input type="text" value={draft.pic} onChange={(e) => setDraft({ ...draft, pic: e.target.value })} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary" />
          </ModalField>

          <div className="sm:col-span-2"><ModalField label="Status">
            <select value={draft.status || ""} onChange={(e) => setDraft({ ...draft, status: (e.target.value || null) as CalendarEntry["status"] })} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs outline-none focus:border-primary">
              <option value="">Not specified</option>
              {CALENDAR_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </ModalField></div>

        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2/40 p-4">
          {draft.id.startsWith("new:") ? <span /> : (
            <button type="button" onClick={onDelete} className="text-xs font-semibold text-destructive hover:underline">Delete entry</button>
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
      <div className="mb-1 text-xs font-bold text-muted-foreground">
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
  const sample = text.split(/\r?\n/, 5).join("\n");
  const delimiters = [",", ";", "\t"];
  const delimiter = delimiters.reduce((best, candidate) => {
    const count = sample.split(candidate).length - 1;
    const bestCount = sample.split(best).length - 1;
    return count > bestCount ? candidate : best;
  }, ",");
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
    } else if (ch === delimiter) {
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
  // Prevent CSV formula injection when an exported user-authored field is
  // opened by Excel or another spreadsheet application.
  const safe = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function normalizeFormat(value: unknown): CalendarEntry["format"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("reel") || normalized === "video") return "Reels";
  if (normalized.includes("carousel") || normalized.includes("slide")) return "Carousel";
  if (normalized.includes("single") || normalized.includes("image") || normalized.includes("photo")) return "Single Image";
  return "Unspecified";
}

function normalizeDate(value: unknown): string {
  const input = String(value || "").trim();
  if (!input) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return input;
    }
    return "";
  }

  const numeric = input.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (numeric) {
    const year = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const month = Number(numeric[2]);
    const day = Number(numeric[1]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return ymd(year, month - 1, day);
    }
  }

  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    return ymd(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  return "";
}

function normalizeTime(value: unknown): string | null {
  const input = String(value || "").trim();
  if (!input) return null;
  const match = input.match(/^(\d{1,2})(?:[:.](\d{1,2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeVoiceOver(value: unknown): CalendarEntry["voiceOver"] {
  const input = String(value || "").trim().toLowerCase();
  return VOICE_OVER_VALUES.find((item) => item.toLowerCase() === input) || null;
}

function normalizeStatus(value: unknown): CalendarEntry["status"] {
  const input = String(value || "").trim().toLowerCase();
  return CALENDAR_STATUSES.find((item) => item.toLowerCase() === input) || null;
}

function excelCellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return ymd(value.getFullYear(), value.getMonth(), value.getDate());
  if (typeof value === "object") {
    const cell = value as any;
    if (typeof cell.text === "string") return cell.text;
    if (cell.result !== undefined) return excelCellToString(cell.result);
    if (Array.isArray(cell.richText)) return cell.richText.map((part: any) => part.text || "").join("");
  }
  return String(value);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toCalendarPayload(entry: CalendarEntry) {
  return {
    brand_id: entry.brand_id,
    posting_date: entry.date,
    posting_time: entry.time,
    content_type: entry.format,
    content_details: entry.title,
    visual_reference: entry.visualReference,
    caption: entry.caption,
    voice_over: entry.voiceOver,
    pic: entry.pic,
    status: entry.status,
  };
}

function blankCalendarEntry(date: string, brand?: Brand): CalendarEntry {
  return {
    id: `new:${date}:${Date.now()}`,
    date,
    time: "19:00",
    account: brand?.name || "Unassigned",
    brand: brand?.name || "Unassigned",
    brand_id: brand?.id || null,
    format: "Single Image",
    caption: "",
    title: "",
    visualReference: "",
    voiceOver: null,
    pic: "",
    status: null,
    source: "manual",
    createdAt: null,
  };
}
