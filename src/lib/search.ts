import { supabase } from '@/lib/supabaseClient'

export interface SearchResults {
  properties: Array<{ id: string; name: string; city: string }>;
  tenants: Array<{ id: string; first_name: string; last_name: string }>;
}

export async function globalSearch(query: string): Promise<SearchResults> {
  if (!query || query.trim().length < 2) return { properties: [], tenants: [] };

  // Escape LIKE wildcards to prevent injection
  const escaped = query.replace(/[%_\\]/g, '\\$&')

  try {
    const [propRes, tenantRes] = await Promise.all([
      // Query properties table - verified from schema
      supabase.from('properties')
        .select('id, name, city')
        .ilike('name', `%${escaped}%`)
        .limit(5),

      // Query tenants table - verified from schema
      supabase.from('tenants')
        .select('id, first_name, last_name')
        .or(`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%`)
        .limit(5)
    ]);

    return { 
      properties: propRes.data || [], 
      tenants: tenantRes.data || [] 
    };
  } catch (err) {
    console.error("Critical Search Failure:", err);
    return { properties: [], tenants: [] };
  }
}