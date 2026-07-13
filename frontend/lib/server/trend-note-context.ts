import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isTrendNoteStale, type TrendNote, utcDateOffset } from "@/lib/trend-notes";
import { type OwnedBrandContext } from "@/lib/server/brand-pattern-context";

export async function loadActiveTrendNotes(brand: OwnedBrandContext): Promise<TrendNote[]> {
  const supabase = await createClient();
  const cutoff = utcDateOffset(-14);
  const today = utcDateOffset(0);
  const { data, error } = await supabase
    .from("brand_trend_notes")
    .select("id, brand_id, note, source, observed_at, tag, created_at")
    .eq("brand_id", brand.id)
    .eq("created_by", brand.ownerId)
    .gte("observed_at", cutoff)
    .lte("observed_at", today)
    .order("observed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) {
    console.warn("[TrendNotes] Active context lookup failed:", error.code);
    return [];
  }
  return (data || []).map((row) => ({
    id: row.id,
    brand_id: row.brand_id,
    note: String(row.note).slice(0, 300),
    source: String(row.source).slice(0, 200),
    observed_at: row.observed_at,
    tag: typeof row.tag === "string" ? row.tag.slice(0, 80) : null,
    created_at: row.created_at,
    is_stale: isTrendNoteStale(row.observed_at),
  }));
}
