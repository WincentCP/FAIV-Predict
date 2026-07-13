"use client";

import { fetchWithRetry } from "@/lib/fetch-retry";
import Link from "next/link";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { OutcomeComparison } from "@/components/OutcomeComparison";
import { creativeBriefSummary, isStructuredCreativeBrief } from "@/lib/creative-brief";
import type { RealizedClassBasis } from "@/lib/realized-outcomes";
import { type ContentFormat, type Brand, type Tier, normalizeBrandReference } from "@/lib/types";
import {
  UploadCloud,
  Download,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  List,
  X,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  MoreHorizontal,
  RefreshCw,
  Clock3,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  prediction_id: string | null;
  prediction: {
    id: string;
    tier: Tier;
    status: "current" | "provisional" | "stale" | "superseded";
    time_known: boolean;
    model_version: string | null;
    actual_er: number | null;
    realized_tier: Tier | null;
    realized_class_basis: RealizedClassBasis | null;
    tier_error: 0 | 1 | 2 | null;
    verification_badge: "match" | "one_off" | "miss" | null;
  } | null;
  publication: {
    id: string;
    post_id: string;
    media_id: string;
    observed_er: number | null;
    post_age_days: number | null;
    synced_at: string | null;
    outcome_status: "observed" | "pending_maturity" | "awaiting_observation";
  } | null;
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

type PlanFilter = "all" | "needs_prediction" | "stale" | "current" | "learning" | "observed";

const CALENDAR_STATUSES = [
  "Need Shooting",
  "Need Design",
  "Need Editing",
  "Screening",
  "Ready to Post",
  "Posted",
] as const;

const PRODUCTION_STATUS_LABELS: Record<NonNullable<CalendarEntry["status"]>, string> = {
  "Need Shooting": "Needs filming",
  "Need Design": "Needs design",
  "Need Editing": "Needs editing",
  Screening: "In review",
  "Ready to Post": "Ready to publish",
  Posted: "Published",
};

function productionStatusLabel(status: CalendarEntry["status"]): string {
  return status ? PRODUCTION_STATUS_LABELS[status] : "Not specified";
}

const VOICE_OVER_VALUES = ["Need", "No Need", "Done"] as const;

const CSV_FIELDS: { field: CsvField; label: string; required: boolean }[] = [
  { field: "number", label: "No.", required: false },
  { field: "date", label: "Posting Date", required: true },
  { field: "time", label: "Time", required: false },
  { field: "brand", label: "Brand", required: false },
  { field: "format", label: "Format", required: false },
  { field: "contentDetails", label: "Creative Brief", required: false },
  { field: "visualReference", label: "Visual Reference", required: false },
  { field: "caption", label: "Caption", required: false },
  { field: "voiceOver", label: "Voice Over", required: false },
  { field: "pic", label: "Owner", required: false },
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
  contentDetails: ["creative brief", "content details", "content detail", "details", "detail konten", "judul", "topic"],
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
  const [view, setView] = useState<"month" | "list">("list");
  const [editing, setEditing] = useState<CalendarEntry | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [brandsList, setBrandsList] = useState<Brand[]>([]);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");

  const fileRef = useRef<HTMLInputElement>(null);
  const importDialogRef = useRef<HTMLDivElement>(null);
  const importCloseRef = useRef<HTMLButtonElement>(null);

  const loadCalendar = useCallback(async () => {
    try {
      const res = await fetchWithRetry("/api/calendar");
      if (!res.ok) {
        throw new Error("Could not load Content Plan entries");
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
        prediction_id: entry.prediction_id || null,
        prediction: entry.prediction ? {
          ...entry.prediction,
          tier: normalizeTier(entry.prediction.tier),
        } : null,
        publication: entry.publication || null,
      }));
      setEntries(mapped);
      setLoadError(null);
    } catch {
      setLoadError("The Content Plan is temporarily unavailable. Your existing planning records have not been changed.");
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

  const planCounts = useMemo(() => ({
    all: monthEntries.length,
    needs_prediction: monthEntries.filter((entry) => !entry.prediction).length,
    stale: monthEntries.filter((entry) => entry.prediction?.status === "stale" || entry.prediction?.status === "superseded").length,
    current: monthEntries.filter((entry) => entry.prediction?.status === "current" || entry.prediction?.status === "provisional").length,
    learning: monthEntries.filter((entry) => entry.publication && entry.publication.observed_er === null).length,
    observed: monthEntries.filter((entry) => entry.publication?.observed_er !== null && entry.publication?.observed_er !== undefined).length,
  }), [monthEntries]);

  const matchesPlanFilter = useCallback((entry: CalendarEntry) => {
    if (planFilter === "needs_prediction") return !entry.prediction;
    if (planFilter === "stale") return entry.prediction?.status === "stale" || entry.prediction?.status === "superseded";
    if (planFilter === "current") return entry.prediction?.status === "current" || entry.prediction?.status === "provisional";
    if (planFilter === "learning") return Boolean(entry.publication && entry.publication.observed_er === null);
    if (planFilter === "observed") return entry.publication?.observed_er !== null && entry.publication?.observed_er !== undefined;
    return true;
  }, [planFilter]);

  const visibleMonthEntries = useMemo(
    () => monthEntries.filter(matchesPlanFilter),
    [monthEntries, matchesPlanFilter],
  );

  const visibleEntries = useMemo(
    () => entries.filter(matchesPlanFilter),
    [entries, matchesPlanFilter],
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

  const [csvStage, setCsvStage] = useState<CsvStage | null>(null);
  const importDialogOpen = csvStage !== null;

  useEffect(() => {
    if (!importDialogOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    importCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCsvStage(null);
        return;
      }
      if (event.key !== "Tab" || !importDialogRef.current) return;
      const focusable = Array.from(importDialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [importDialogOpen]);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setImportReport({
        total: 0, imported: 0, skipped: 0, failed: 0, running: false,
        errors: ["Choose a CSV or XLSX Content Plan file."],
      });
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setImportReport({
        total: 0, imported: 0, skipped: 0, failed: 0, running: false,
        errors: ["The spreadsheet is larger than 10 MB. Split it into smaller Content Plan files before importing."],
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
        errors: [`This file contains more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it into smaller Content Plan files before review.`],
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
        warnings.push("a matching Content Plan entry already exists");
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
        if (!res.ok) throw new Error(data?.message || "Content Plan import failed");
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

  const handleExportCsv = () => {
    const header = ["posting_date", "time", "brand", "format", "creative_brief", "visual_reference", "caption", "voice_over", "owner", "status"];
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
    downloadBlob(blob, `faiv-content-plan-${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}.csv`);
  };

  const handleExportXlsx = async () => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FAIV Predict";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Content Plan", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "Posting Date", width: 14 }, { header: "Time", width: 10 },
      { header: "Brand", width: 22 }, { header: "Format", width: 16 },
      { header: "Creative Brief", width: 30 }, { header: "Visual Reference", width: 30 },
      { header: "Caption", width: 48 }, { header: "Voice Over", width: 14 },
      { header: "Owner", width: 20 }, { header: "Status", width: 20 },
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
      `faiv-content-plan-${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}.xlsx`,
    );
  };

  const handleExportPdf = async () => {
    const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const autoTable = autoTableModule.default;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`Content Plan — ${MONTH_NAMES[cursor.m]} ${cursor.y}`, 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text("Exported from FAIV Predict. Only user-created and imported planning records are included.", 14, 22);
    autoTable(doc, {
      startY: 28,
      head: [["Date", "Time", "Brand", "Format", "Creative Brief", "Caption", "Voice-over", "Owner", "Status"]],
      body: monthEntries.map((entry) => [
        entry.date, entry.time || "—", entry.brand, entry.format, creativeBriefSummary(entry.title) || "—",
        entry.caption || "—", entry.voiceOver || "—", entry.pic || "—", entry.status || "—",
      ]),
      styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: [91, 65, 184], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 247, 251] },
      columnStyles: { 4: { cellWidth: 38 }, 5: { cellWidth: 55 } },
      margin: { left: 10, right: 10 },
    });
    doc.save(`faiv-content-plan-${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}.pdf`);
  };

  const handleSave = async (next: CalendarEntry): Promise<string | null> => {
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
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(result?.message || "The Content Plan change could not be saved.");
      }
      await loadCalendar();
      setLoadError(null);
      return null;
    } catch (error: unknown) {
      return error instanceof Error
        ? error.message
        : "The Content Plan change could not be saved.";
    }
  };

  const handleDelete = async (id: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/calendar", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(result?.message || "The Content Plan entry could not be deleted.");
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setLoadError(null);
      return null;
    } catch (error: unknown) {
      return error instanceof Error
        ? error.message
        : "The Content Plan entry could not be deleted.";
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
        title="Planner"
        description="Organize ideas, production, and predictions."
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
              className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90"
            >
              Plan content
            </button>
            <details className="group relative">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-border-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                <MoreHorizontal className="h-4 w-4" />
                Data tools
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-elevated)]">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={importReport?.running}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold hover:bg-surface-2 disabled:opacity-60"
                >
                  {importReport?.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                  Import CSV/XLSX
                </button>
                <div className="my-1 border-t border-border" />
                <button type="button" onClick={handleExportCsv} disabled={monthEntries.length === 0} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold hover:bg-surface-2 disabled:opacity-50">
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </button>
                <button type="button" onClick={handleExportXlsx} disabled={monthEntries.length === 0} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold hover:bg-surface-2 disabled:opacity-50">
                  <Download className="h-3.5 w-3.5" /> Export XLSX
                </button>
                <button type="button" onClick={handleExportPdf} disabled={monthEntries.length === 0} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold hover:bg-surface-2 disabled:opacity-50">
                  <Download className="h-3.5 w-3.5" /> Export PDF
                </button>
              </div>
            </details>
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

      <section aria-labelledby="plan-state-title" className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-soft)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 id="plan-state-title" className="text-sm font-bold text-foreground">Status</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Filter by what needs to happen next.</p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0" aria-label="Filter Content Plan by decision state">
            {([
              ["all", "All"],
              ["needs_prediction", "Ready to predict"],
              ["stale", "Needs update"],
              ["current", "Predicted"],
              ["learning", "Waiting for results"],
              ["observed", "Results ready"],
            ] as Array<[PlanFilter, string]>).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPlanFilter(id)}
                aria-pressed={planFilter === id}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-bold",
                  planFilter === id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {label}
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] tabular-nums", planFilter === id ? "bg-background/15" : "bg-surface-2")}>{planCounts[id]}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {importReport && (
        <div
          role="status"
          aria-live="polite"
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

      {csvStage && csvValidation && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-4 backdrop-blur-sm"
          onClick={() => setCsvStage(null)}
          role="presentation"
        >
          <div
            ref={importDialogRef}
            className="relative w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden rounded-3xl border border-border bg-surface/95 backdrop-blur-2xl shadow-[var(--shadow-elevated)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-review-title"
          >
            <div className="flex items-start justify-between border-b border-border p-5 shrink-0">
              <div>
                <h3 id="import-review-title" className="font-display text-base font-bold text-foreground">Review spreadsheet import</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {csvStage.fileName} · {csvStage.rows.length} data row{csvStage.rows.length === 1 ? "" : "s"} —
                  nothing is imported until you confirm.
                </p>
              </div>
              <button
                ref={importCloseRef}
                type="button"
                onClick={() => setCsvStage(null)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                aria-label="Cancel import"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto flex-1">
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
                type="button"
                onClick={() => setCsvStage(null)}
                className="min-h-11 rounded-lg border border-border bg-surface px-4 text-xs font-semibold hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runImport}
                disabled={csvValidation.importable.length === 0}
                className="min-h-11 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Import {csvValidation.importable.length} post
                {csvValidation.importable.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-col md:flex-row items-center justify-between gap-4 border border-border bg-surface p-3 rounded-xl shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={goPrev}
            className="grid h-11 w-11 place-items-center rounded-lg border border-border bg-surface hover:bg-surface-2 active:scale-95"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="grid h-11 w-11 place-items-center rounded-lg border border-border bg-surface hover:bg-surface-2 active:scale-95"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:bg-surface-2 active:scale-95"
          >
            Today
          </button>
          <div className="ml-2 font-display text-lg font-semibold">
            {MONTH_NAMES[cursor.m]} {cursor.y}
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-1 text-xs w-full md:w-auto justify-center">
          {(
            [
              { id: "list", label: "List", icon: List },
              { id: "month", label: "Month", icon: CalendarIcon },
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
                const dayEntries = visibleEntries.filter((e) => e.date === dateStr);
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
                          aria-label="Add Content Plan entry"
                          title="Add Content Plan entry"
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
                              <span className="truncate rounded-full bg-surface-2 px-1.5 py-0.5 text-xs font-bold text-muted-foreground">{productionStatusLabel(e.status)}</span>
                            )}
                          </div>
                          {(e.prediction || e.publication) && (
                            <div className="flex flex-wrap gap-1 border-t border-border/40 pt-1.5 text-xs font-bold">
                              {e.prediction && (
                                <span className={getDecisionState(e).tone === "warning" ? "text-warning-foreground" : "text-primary"}>
                                  {getDecisionState(e).label}
                                </span>
                              )}
                              {e.publication && e.publication.observed_er !== null && (
                                <span className="text-emerald-700 dark:text-emerald-300">Engagement {e.publication.observed_er.toFixed(2)}%</span>
                              )}
                            </div>
                          )}
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

        {view === "list" && (
          <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
            <div className="space-y-3 p-3 lg:hidden">
              {visibleMonthEntries
                .slice()
                .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))
                .map((entry) => {
                  const decision = getDecisionState(entry);
                  return (
                    <article key={entry.id} className="overflow-hidden rounded-xl border border-border bg-surface">
                      <button
                        type="button"
                        onClick={() => setEditing(entry)}
                        className="w-full p-4 text-left hover:bg-surface-2/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-foreground">{creativeBriefSummary(entry.title) || entry.caption || "Untitled content idea"}</div>
                            <div className="mt-1 text-xs font-semibold text-muted-foreground">
                              {entry.brand} · {entry.format}
                            </div>
                          </div>
                          <PlanStateBadge label={decision.label} tone={decision.tone} />
                        </div>
                        <p className="mt-3 text-xs font-semibold text-muted-foreground">
                          {formatDayLabel(entry.date)}{entry.time ? ` at ${entry.time}` : " · posting time optional"}
                        </p>
                        {entry.caption && entry.title && (
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{entry.caption}</p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {entry.prediction && (
                            <span className="rounded-full border border-border bg-surface-2 px-2 py-1 text-[11px] font-bold">Predicted {entry.prediction.tier}</span>
                          )}
                          {entry.publication?.observed_er != null && (
                            <span className="text-[11px] font-bold text-success-foreground">Engagement {entry.publication.observed_er.toFixed(2)}%</span>
                          )}
                          {entry.status && <span className="text-[11px] font-semibold text-muted-foreground">Production: {productionStatusLabel(entry.status)}</span>}
                        </div>
                      </button>
                      <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2/35 px-4 py-2.5">
                        <button type="button" onClick={() => setEditing(entry)} className="min-h-9 rounded-lg px-2 text-xs font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground">Edit plan</button>
                        <Link href={decision.href(entry.id)} className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90">
                          {decision.action}
                        </Link>
                      </div>
                    </article>
                  );
                })}
              {visibleMonthEntries.length === 0 && (
                <PlanEmptyState filtered={monthEntries.length > 0} onAdd={() => setEditing(blankCalendarEntry(
                  ymd(cursor.y, cursor.m, Math.min(today.getDate(), new Date(cursor.y, cursor.m + 1, 0).getDate())),
                  brandsList[0],
                ))} />
              )}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[980px] text-left text-sm">
                <caption className="sr-only">Content decisions planned for {MONTH_NAMES[cursor.m]} {cursor.y}</caption>
                <thead>
                  <tr className="border-b border-border bg-surface-2/55 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    <th className="px-5 py-3.5 font-semibold">Creative Brief</th>
                    <th className="px-5 py-3.5 font-semibold">Schedule</th>
                    <th className="px-5 py-3.5 font-semibold">Decision</th>
                    <th className="px-5 py-3.5 font-semibold">Result</th>
                    <th className="px-5 py-3.5 font-semibold">Production</th>
                    <th className="px-6 py-4 font-semibold"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {visibleMonthEntries
                    .slice()
                    .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))
                    .map((r) => {
                      const decision = getDecisionState(r);
                      const [y, m, d] = r.date.split("-").map(Number);
                      const dateObj = new Date(y, m - 1, d);
                      const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short" });

                      return (
                        <tr
                          key={r.id}
                          className="hover:bg-surface-2/40 transition-colors group/row"
                        >
                          <td className="max-w-[350px] px-5 py-4 align-middle">
                            <div className="min-w-0">
                              <button type="button" onClick={() => setEditing(r)} className="max-w-full truncate text-left text-sm font-bold text-foreground hover:text-primary hover:underline">
                                {creativeBriefSummary(r.title) || r.caption || "Untitled content idea"}
                              </button>
                              <p className="mt-1 truncate text-xs text-muted-foreground">{r.caption && r.title ? r.caption : "Add a caption or creative brief before evaluation."}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                                <span>{r.account}</span><span aria-hidden="true">·</span><span>{r.format}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle">
                            <div className="flex items-center gap-3">
                              <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-surface-2 transition-colors group-hover/row:border-primary/30">
                                <span className="text-[10px] font-extrabold uppercase leading-none tracking-wide text-muted-foreground">{weekday}</span>
                                <span className="mt-1 text-sm font-extrabold leading-none text-foreground">{dateObj.getDate()}</span>
                              </div>
                              <div className="text-xs">
                                <p className="font-bold text-foreground">{dateObj.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</p>
                                <p className="mt-1 font-semibold text-muted-foreground">{r.time || "Time optional"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle">
                            <div className="space-y-2">
                              <PlanStateBadge label={decision.label} tone={decision.tone} />
                              {r.prediction && <p className="text-[11px] font-semibold text-muted-foreground">Tier: <span className="font-bold text-foreground">{r.prediction.tier}</span></p>}
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle text-xs">
                            {r.publication ? (
                              r.publication.observed_er !== null ? (
                                <div><p className="font-bold text-success-foreground">Engagement {r.publication.observed_er.toFixed(2)}%</p><p className="mt-1 text-[11px] text-muted-foreground">7-day result</p></div>
                              ) : (
                                <div><p className="inline-flex items-center gap-1.5 font-bold text-foreground"><Link2 className="h-3.5 w-3.5" /> Instagram post linked</p><p className="mt-1 text-[11px] text-muted-foreground">{r.publication.outcome_status === "pending_maturity" ? "Waiting for the 7-day result" : "Waiting for Instagram data"}</p></div>
                              )
                            ) : <span className="text-muted-foreground">Not linked yet</span>}
                          </td>
                          <td className="px-5 py-4 align-middle text-xs">
                            <p className="font-semibold text-foreground">{productionStatusLabel(r.status)}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">{r.pic ? `Owner: ${r.pic}` : "No owner assigned"}</p>
                          </td>
                          <td className="px-5 py-4 align-middle text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button type="button" onClick={() => setEditing(r)} className="min-h-10 rounded-lg border border-border bg-surface px-3 text-xs font-bold text-foreground hover:bg-surface-2">Edit</button>
                              <Link href={decision.href(r.id)} className="inline-flex min-h-10 items-center rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90">
                                {decision.action}
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  {visibleMonthEntries.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-xs text-muted-foreground">
                        {monthEntries.length > 0 ? "No content matches this status filter." : "No content is planned this month yet."}
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

type DecisionTone = "primary" | "warning" | "success" | "neutral";

function getDecisionState(entry: CalendarEntry) {
  if (!entry.prediction) {
    return {
      label: "Ready to predict",
      tone: "primary" as DecisionTone,
      action: "Predict",
      href: (id: string) => `/predict?plan_id=${encodeURIComponent(id)}`,
    };
  }
  if (entry.prediction.status === "stale" || entry.prediction.status === "superseded") {
    return {
      label: entry.prediction.status === "stale" ? "Outdated — re-analyze" : "Earlier version",
      tone: "warning" as DecisionTone,
      action: "Update",
      href: (id: string) => `/predict?plan_id=${encodeURIComponent(id)}`,
    };
  }
  if (entry.publication?.observed_er != null) {
    return {
      label: "Result ready",
      tone: "success" as DecisionTone,
      action: "View result",
      href: () => "/results?tab=predictions",
    };
  }
  if (entry.publication) {
    return {
      label: entry.publication.outcome_status === "pending_maturity" ? "Collecting results" : "Waiting for result",
      tone: "neutral" as DecisionTone,
      action: "View result",
      href: () => "/results?tab=predictions",
    };
  }
  if (entry.prediction.status === "provisional") {
    return {
      label: "No time set yet",
      tone: "neutral" as DecisionTone,
      action: "Update",
      href: (id: string) => `/predict?plan_id=${encodeURIComponent(id)}`,
    };
  }
  return {
    label: "Predicted",
    tone: "success" as DecisionTone,
    action: "Review",
    href: () => "/results?tab=predictions",
  };
}

function PlanStateBadge({ label, tone }: { label: string; tone: DecisionTone }) {
  const tones: Record<DecisionTone, string> = {
    primary: "border-primary/30 bg-primary/[0.07] text-primary",
    warning: "border-warning/40 bg-warning/[0.09] text-warning-foreground",
    success: "border-success/35 bg-success/[0.09] text-success-foreground",
    neutral: "border-border bg-surface-2 text-muted-foreground",
  };
  return <span className={cn("inline-flex rounded-full border px-2 py-1 text-[11px] font-bold", tones[tone])}>{label}</span>;
}

function PlanEmptyState({ filtered, onAdd }: { filtered: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
        {filtered && <RefreshCw className="h-4 w-4" />}
      </span>
      <h3 className="mt-3 text-sm font-bold text-foreground">{filtered ? "No matching decisions" : "Plan the first content idea"}</h3>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
        {filtered ? "Choose another status to see this month’s content." : "Add the Creative Brief, then predict before publishing."}
      </p>
      {filtered ? null : (
        <button type="button" onClick={onAdd} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90">
          Plan content
        </button>
      )}
    </div>
  );
}

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
  onSave: (next: CalendarEntry) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<CalendarEntry>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mutation, setMutation] = useState<"idle" | "saving" | "deleting">("idle");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const mutationRef = useRef(mutation);

  useEffect(() => {
    mutationRef.current = mutation;
  }, [mutation]);

  useEffect(() => {
    if (confirmDelete) cancelDeleteRef.current?.focus();
  }, [confirmDelete]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mutationRef.current === "idle") {
        onClose();
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary',
        ));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const saveDraft = async () => {
    if (mutation !== "idle") return;
    setMutation("saving");
    setMutationError(null);
    const error = await onSave(draft);
    if (error) {
      setMutationError(error);
      setMutation("idle");
      return;
    }
    onClose();
  };

  const deleteDraft = async () => {
    if (mutation !== "idle") return;
    setMutation("deleting");
    setMutationError(null);
    const error = await onDelete();
    if (error) {
      setMutationError(error);
      setMutation("idle");
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-sm"
      onClick={() => { if (mutation === "idle") onClose(); }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-entry-title"
        aria-describedby="plan-entry-description"
        className="relative h-[100dvh] w-full max-w-xl overflow-y-auto border-l border-border bg-surface shadow-[var(--shadow-elevated)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-surface p-5 sm:p-6">
          <div>
            <div className="text-xs font-bold text-primary">
              {draft.id.startsWith("new:") ? "New content" : getDecisionState(draft).label}
            </div>
            <h2 id="plan-entry-title" className="mt-1 font-display text-xl font-semibold tracking-tight">
              {draft.id.startsWith("new:") ? "Plan content" : "Edit planned content"}
            </h2>
            <p id="plan-entry-description" className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Add the idea, schedule, and production details.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={mutation !== "idle"}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            aria-label="Close content plan editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
          <div className="sm:col-span-2">
            <h3 className="text-sm font-bold text-foreground">Publish schedule</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Publish time is optional. Add it for a time-specific prediction.</p>
          </div>
          <ModalField label="Posting date">
            <input
              type="date"
              required
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </ModalField>

          <ModalField label="Posting time (optional)">
            <input type="time" value={draft.time || ""} onChange={(e) => setDraft({ ...draft, time: e.target.value || null })} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
          </ModalField>

          {!draft.time && (
            <p className="sm:col-span-2 inline-flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" /> The prediction will not consider publish time until one is chosen.
            </p>
          )}

          <div className="sm:col-span-2 mt-2 border-t border-border pt-5">
            <h3 className="text-sm font-bold text-foreground">Creative Brief</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Describe the idea so recommendations fit the content.</p>
          </div>

          <ModalField label="Brand">
            <select
              value={draft.brand_id || ""}
              onChange={(e) => {
                const brand = brands.find((item) => item.id === e.target.value);
                setDraft({
                  ...draft,
                  brand_id: brand?.id || null,
                  brand: brand?.name || "Unassigned",
                  account: brand?.name || "Unassigned",
                  prediction_id: brand?.id === draft.brand_id ? draft.prediction_id : null,
                  prediction: brand?.id === draft.brand_id ? draft.prediction : null,
                  publication: brand?.id === draft.brand_id ? draft.publication : null,
                });
              }}
              className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="">Unassigned</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
          </ModalField>

          <ModalField label="Format">
            <select value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value as CalendarEntry["format"] })} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15">
              <option value="Unspecified">Unspecified</option><option value="Reels">Reels</option><option value="Carousel">Carousel</option><option value="Single Image">Single Image</option>
            </select>
          </ModalField>

          <div className="sm:col-span-2">
            {isStructuredCreativeBrief(draft.title) ? (
              <div className="rounded-xl border border-border bg-surface-2/40 p-4">
                <p className="text-xs font-bold text-muted-foreground">Creative Brief</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{creativeBriefSummary(draft.title) || "Structured brief added"}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Edit the full goal, hook, story, visuals, and current context in Predict.</p>
                {!draft.id.startsWith("new:") && (
                  <Link href={`/predict?plan_id=${encodeURIComponent(draft.id)}`} className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-border bg-surface px-3 text-xs font-bold text-primary hover:bg-surface-2">Edit Creative Brief</Link>
                )}
              </div>
            ) : (
              <ModalField label="Creative idea">
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  placeholder="e.g. Customer transformation story with a direct hook"
                />
              </ModalField>
            )}
          </div>

          <div className="sm:col-span-2"><ModalField label="Visual reference">
            <input type="text" value={draft.visualReference} onChange={(e) => setDraft({ ...draft, visualReference: e.target.value })} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="Optional URL or production reference" />
          </ModalField></div>

          <div className="sm:col-span-2"><ModalField label="Caption draft">
            <textarea
              value={draft.caption}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              rows={5}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm leading-6 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              placeholder="Write or paste the caption you want to predict."
            />
          </ModalField></div>

          <div className="sm:col-span-2 mt-2 border-t border-border pt-5">
            <h3 className="text-sm font-bold text-foreground">Production details <span className="font-normal text-muted-foreground">(optional)</span></h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Use these fields to coordinate content production.</p>
          </div>

          <ModalField label="Voice over">
            <select value={draft.voiceOver || ""} onChange={(e) => setDraft({ ...draft, voiceOver: (e.target.value || null) as CalendarEntry["voiceOver"] })} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary">
              <option value="">Not specified</option><option value="Need">Need</option><option value="No Need">No Need</option><option value="Done">Done</option>
            </select>
          </ModalField>

          <ModalField label="Owner">
            <input type="text" value={draft.pic} onChange={(e) => setDraft({ ...draft, pic: e.target.value })} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary" />
          </ModalField>

          <div className="sm:col-span-2"><ModalField label="Status">
            <select value={draft.status || ""} onChange={(e) => setDraft({ ...draft, status: (e.target.value || null) as CalendarEntry["status"] })} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary">
              <option value="">Not specified</option>
              {CALENDAR_STATUSES.map((status) => <option key={status} value={status}>{productionStatusLabel(status)}</option>)}
            </select>
          </ModalField></div>

          {!draft.id.startsWith("new:") && (
            <div className="sm:col-span-2 rounded-xl border border-border bg-surface-2/40 p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-foreground">Prediction and published result</div>
                <PlanStateBadge label={getDecisionState(draft).label} tone={getDecisionState(draft).tone} />
              </div>
              <p className="mt-2 leading-5 text-muted-foreground">
                {draft.prediction
                  ? `Prediction: ${draft.prediction.tier} · ${getDecisionState(draft).label}.`
                  : "No prediction is linked yet."}
                {draft.publication
                  ? ` Instagram post linked${draft.publication.observed_er !== null ? ` · engagement ${draft.publication.observed_er.toFixed(2)}%` : " · result pending"}.`
                  : " No Instagram post is linked yet."}
              </p>
              {draft.prediction?.realized_tier && (
                <div className="mt-3 border-t border-border pt-3">
                  <OutcomeComparison
                    predictedTier={draft.prediction.tier}
                    realizedTier={draft.prediction.realized_tier}
                    basis={draft.prediction.realized_class_basis}
                    compact
                  />
                </div>
              )}
              <Link
                href={`/predict?plan_id=${encodeURIComponent(draft.id)}`}
                className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-primary px-3 font-bold text-primary-foreground hover:bg-primary/90"
              >
                {draft.prediction ? "Update prediction" : "Create prediction"}
              </Link>
            </div>
          )}

        </div>

        <div className="sticky bottom-0 border-t border-border bg-surface p-4 sm:px-6">
          {mutationError && (
            <p role="alert" className="mb-3 rounded-xl border border-destructive/25 bg-destructive/[0.04] p-3 text-sm text-destructive">
              {mutationError}
            </p>
          )}
          {confirmDelete ? (
            <div role="alert" className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="flex-1 text-sm leading-6 text-muted-foreground">
                <strong className="text-foreground">Delete this planned content?</strong> Previous predictions will remain in History.
              </p>
              <div className="flex items-center gap-2">
                <button ref={cancelDeleteRef} type="button" onClick={() => setConfirmDelete(false)} disabled={mutation !== "idle"} className="min-h-11 rounded-lg border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">Keep plan</button>
                <button type="button" onClick={deleteDraft} disabled={mutation !== "idle"} aria-busy={mutation === "deleting"} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">
                  {mutation === "deleting" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {mutation === "deleting" ? "Deleting…" : "Delete plan"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              {draft.id.startsWith("new:") ? <span /> : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-destructive hover:bg-destructive/[0.06]">Delete plan</button>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={mutation !== "idle"}
                  className="min-h-11 rounded-lg border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={mutation !== "idle"}
                  aria-busy={mutation === "saving"}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {mutation === "saving" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {mutation === "saving" ? "Saving…" : draft.id.startsWith("new:") ? "Save plan" : "Save changes"}
                </button>
              </div>
            </div>
          )}
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
  // Generic "video" does not establish Meta's product type. Only an explicit
  // Reel label may select the Reels feature; unknown video imports follow the
  // existing Unspecified + review-warning path.
  if (normalized.includes("reel")) return "Reels";
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
    prediction_id: entry.prediction_id,
  };
}

function blankCalendarEntry(date: string, brand?: Brand): CalendarEntry {
  return {
    id: `new:${date}:${Date.now()}`,
    date,
    time: null,
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
    prediction_id: null,
    prediction: null,
    publication: null,
  };
}

function normalizeTier(value: unknown): Tier {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "low") return "Low";
  return "Average";
}
