import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function getRequestUser(supabase: SupabaseClient): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export async function getOwnedBrands(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("brands")
    .select("id, name, niche")
    .eq("owner_id", userId);
  if (error) {
    throw new Error(`Workspace ownership check failed: ${error.message}`);
  }
  return data || [];
}

