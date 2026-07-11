// Controlled primary industry cohorts — the single source of truth for the UI
// and AI-assisted suggestion. One brand belongs to one benchmark cohort so
// small thesis datasets are not fragmented by multi-label or embedding-based
// taxonomies. Values must match the `brands.niche` / `models.niche`
// strings stored in Supabase: the ML service looks niche models up by this
// exact string when selecting a shared cohort model.
export const NICHES = [
  "Bakery",
  "Fitness",
  "Fashion",
  "Beauty",
  "Food & Beverage",
  "Tech",
  "Travel",
  "Media",
] as const;

