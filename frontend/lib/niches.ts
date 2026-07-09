// Canonical niche taxonomy — the single source of truth for the UI and the
// AI brand classifier. Values must match the `brands.niche` / `models.niche`
// strings stored in Supabase: the ML service looks niche models up by this
// exact string (the Instagram sync pipeline registers "Bakery" and "Fitness").
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
