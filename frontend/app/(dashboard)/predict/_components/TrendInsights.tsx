"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import type { BrandPatternsPayload } from "@/lib/brand-patterns";
import {
  isTrendNoteStale,
  normalizeTrendNotes,
  type TrendNote,
} from "@/lib/trend-notes";
import { cn } from "@/lib/utils";

type Draft = { note: string; source: string; observed_at: string; tag: string };
const emptyDraft = (): Draft => ({
  note: "",
  source: "",
  observed_at: new Date().toISOString().slice(0, 10),
  tag: "",
});

export function TrendInsights({
  brandId,
  brandName,
  editable = false,
}: {
  brandId: string | null;
  brandName?: string;
  editable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<TrendNote[]>([]);
  const [momentum, setMomentum] = useState<BrandPatternsPayload["brand_history_momentum"]>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!brandId) {
      setNotes([]);
      setMomentum(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [notesResult, patternsResult] = await Promise.allSettled([
        fetch(`/api/trend-notes?brand_id=${encodeURIComponent(brandId)}`, { cache: "no-store" }),
        fetch(`/api/brand-patterns?brand_id=${encodeURIComponent(brandId)}`, { cache: "no-store" }),
      ]);
      if (notesResult.status !== "fulfilled" || !notesResult.value.ok) {
        throw new Error("Trend notes could not be loaded.");
      }
      const notesPayload = await notesResult.value.json().catch(() => null);
      if (requestId.current !== currentRequest) return;
      setNotes(normalizeTrendNotes(notesPayload));
      if (patternsResult.status === "fulfilled" && patternsResult.value.ok) {
        const patternsPayload = await patternsResult.value.json().catch(() => null) as BrandPatternsPayload | null;
        if (requestId.current !== currentRequest) return;
        setMomentum(patternsPayload?.brand_history_momentum ?? null);
      } else {
        if (requestId.current === currentRequest) setMomentum(null);
      }
    } catch (caught: unknown) {
      if (requestId.current !== currentRequest) return;
      setError(caught instanceof Error ? caught.message : "Trend context could not be loaded.");
      setNotes([]);
      setMomentum(null);
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  const currentNotes = useMemo(() => notes.filter((note) => !isTrendNoteStale(note)).slice(0, 3), [notes]);
  const olderNotes = useMemo(() => notes.filter((note) => !currentNotes.some((current) => current.id === note.id)), [currentNotes, notes]);

  const createNote = async () => {
    if (!brandId || saving) return;
    if (!draft.note.trim() || !draft.source.trim() || !draft.observed_at) {
      setError("Add a note, source, and observed date.");
      return;
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/trend-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_id: brandId,
          note: draft.note.trim(),
          source: draft.source.trim(),
          observed_at: draft.observed_at,
          tag: draft.tag.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.note) throw new Error(payload?.message || "Trend note could not be saved.");
      setNotes((current) => normalizeTrendNotes({ notes: [payload.note, ...current] }));
      setDraft(emptyDraft());
      setFormOpen(false);
      setStatus("Trend note saved.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Trend note could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (note: TrendNote) => {
    if (deletingId) return;
    setDeletingId(note.id);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/trend-notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: note.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "Trend note could not be deleted.");
      setNotes((current) => current.filter((item) => item.id !== note.id));
      setStatus("Trend note deleted.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Trend note could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section aria-labelledby="trend-insights-title" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-soft)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="trend-insights-content"
        className="flex min-h-16 w-full items-center justify-between gap-4 px-5 py-4 text-left outline-none hover:bg-surface-2/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:px-6"
      >
        <span>
          <span id="trend-insights-title" className="block text-base font-semibold text-foreground">Trend Insights</span>
          <span className="mt-1 block text-sm text-muted-foreground">Sourced notes and descriptive movement for {brandName || "the selected brand"}.</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {currentNotes.length > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{currentNotes.length} current</span>}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div id="trend-insights-content" className="space-y-5 border-t border-border p-5 sm:p-6">
          {!brandId ? (
            <p className="text-sm text-muted-foreground">Select a brand to view or add trend context.</p>
          ) : loading ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading trend context…</div>
          ) : (
            <>
              {momentum?.preferred_mix_statements.length ? (
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Brand-history momentum</h3>
                  <ul className="mt-2 space-y-2">
                    {momentum.preferred_mix_statements.slice(0, 2).map((statement) => (
                      <li key={statement} className="rounded-xl border border-border bg-surface-2/45 p-3 text-sm leading-relaxed text-muted-foreground">{statement}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Publishing-mix movement is descriptive. It does not claim audience preference or engagement uplift.</p>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">Two complete 90-day windows are needed before publishing-mix movement appears.</p>
              )}

              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Current sourced notes</h3>
                  {editable && (
                    <button type="button" onClick={() => setFormOpen((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40" aria-expanded={formOpen} aria-controls="trend-note-form">
                      <Plus className="h-4 w-4" aria-hidden="true" />Add note
                    </button>
                  )}
                </div>

                {formOpen && editable && (
                  <div id="trend-note-form" className="mt-3 grid gap-3 rounded-xl border border-border bg-surface-2/35 p-4 sm:grid-cols-2">
                    <label className="sm:col-span-2"><FieldLabel>Trend note</FieldLabel><textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} maxLength={300} rows={3} className={fieldClass} placeholder="What is changing?" /></label>
                    <label><FieldLabel>Source</FieldLabel><input value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })} maxLength={200} className={inputClass} placeholder="Report, URL, or source name" /></label>
                    <label><FieldLabel>Observed on</FieldLabel><input type="date" max={new Date().toISOString().slice(0, 10)} value={draft.observed_at} onChange={(event) => setDraft({ ...draft, observed_at: event.target.value })} className={inputClass} /></label>
                    <label className="sm:col-span-2"><FieldLabel>Tag (optional)</FieldLabel><input value={draft.tag} onChange={(event) => setDraft({ ...draft, tag: event.target.value })} maxLength={60} className={inputClass} placeholder="Example: Reels format" /></label>
                    <div className="flex justify-end gap-2 sm:col-span-2">
                      <button type="button" onClick={() => setFormOpen(false)} disabled={saving} className="min-h-10 rounded-lg border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">Cancel</button>
                      <button type="button" onClick={createNote} disabled={saving || !draft.note.trim() || !draft.source.trim() || !draft.observed_at} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-45">{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{saving ? "Saving…" : "Save note"}</button>
                    </div>
                  </div>
                )}

                {currentNotes.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">No current sourced trend notes.</p>
                ) : (
                  <ul className="mt-3 space-y-2" aria-label="Current trend notes">
                    {currentNotes.map((note) => <TrendNoteRow key={note.id} note={note} editable={editable} deleting={deletingId === note.id} onDelete={() => void deleteNote(note)} />)}
                  </ul>
                )}
              </div>

              {olderNotes.length > 0 && editable && (
                <details className="rounded-xl border border-border">
                  <summary className="cursor-pointer list-none px-3 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">Manage {olderNotes.length} older or stale note{olderNotes.length === 1 ? "" : "s"}</summary>
                  <ul className="space-y-2 border-t border-border p-3">
                    {olderNotes.map((note) => <TrendNoteRow key={note.id} note={note} editable deleting={deletingId === note.id} onDelete={() => void deleteNote(note)} />)}
                  </ul>
                </details>
              )}
            </>
          )}

          {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/[0.04] p-3 text-sm text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />{error}</p>}
          {status && <p role="status" aria-live="polite" className="text-sm font-medium text-foreground">{status}</p>}
          <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">Trend context is user-provided and does not affect the ML tier.</p>
        </div>
      )}
    </section>
  );
}

function TrendNoteRow({ note, editable, deleting, onDelete }: { note: TrendNote; editable: boolean; deleting: boolean; onDelete: () => void }) {
  const stale = isTrendNoteStale(note);
  return (
    <li className="rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {note.tag && <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-semibold text-muted-foreground">{note.tag}</span>}
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", stale ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary")}>{stale ? "Stale · over 14 days" : "Current"}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{note.note}</p>
          <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">Source: {note.source} · observed <time dateTime={note.observed_at}>{formatDate(note.observed_at)}</time></p>
        </div>
        {editable && (
          <button type="button" onClick={onDelete} disabled={deleting} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-50" aria-label={`Delete trend note: ${note.note.slice(0, 80)}`}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </div>
    </li>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-xs font-semibold text-foreground">{children}</span>;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
const fieldClass = "w-full rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
