export const TREND_NOTE_MAX_LENGTH = 300;
export const TREND_SOURCE_MAX_LENGTH = 200;
export const TREND_TAG_MAX_LENGTH = 80;
export const TREND_STALE_AFTER_DAYS = 14;

export interface TrendNote {
  id: string;
  brand_id: string;
  note: string;
  source: string;
  observed_at: string;
  tag: string | null;
  created_at: string;
  is_stale: boolean;
}

export function utcDateOffset(days: number, now = new Date()): string {
  const value = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function isTrendNoteStale(
  value: string | Pick<TrendNote, "observed_at" | "is_stale">,
  now = new Date(),
): boolean {
  if (typeof value !== "string" && typeof value.is_stale === "boolean") return value.is_stale;
  const observedAt = typeof value === "string" ? value : value.observed_at;
  return observedAt < utcDateOffset(-TREND_STALE_AFTER_DAYS, now);
}

export function isRealPastOrTodayDate(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    && value <= utcDateOffset(0, now);
}

export function normalizeTrendNotes(value: unknown): TrendNote[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { notes?: unknown }).notes)
      ? (value as { notes: unknown[] }).notes
      : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const item = row as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.brand_id !== "string" ||
      typeof item.note !== "string" || !item.note.trim() || item.note.length > TREND_NOTE_MAX_LENGTH ||
      typeof item.source !== "string" || !item.source.trim() || item.source.length > TREND_SOURCE_MAX_LENGTH ||
      typeof item.observed_at !== "string" || !isRealPastOrTodayDate(item.observed_at)
    ) return [];
    const note: TrendNote = {
      id: item.id,
      brand_id: item.brand_id,
      note: item.note.trim(),
      source: item.source.trim(),
      observed_at: item.observed_at,
      tag: typeof item.tag === "string" && item.tag.trim() ? item.tag.trim().slice(0, TREND_TAG_MAX_LENGTH) : null,
      created_at: typeof item.created_at === "string" ? item.created_at : item.observed_at,
      is_stale: typeof item.is_stale === "boolean" ? item.is_stale : isTrendNoteStale(item.observed_at),
    };
    return [note];
  }).sort((a, b) => b.observed_at.localeCompare(a.observed_at) || b.created_at.localeCompare(a.created_at));
}
