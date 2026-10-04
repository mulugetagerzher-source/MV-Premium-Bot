import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://mqsrqoxhofojoziokgce.supabase.co';

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xc3Jxb3hob2Zvam96aW9rZ2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwODAxOTUsImV4cCI6MjEwNjY1NjE5NX0.q1Wj5hk36RVdBoA9WF-S0BmEn-YFT51KH2fsQI9FIYw';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function createSupabaseAdmin() {
  const serviceKey =
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    supabaseAnonKey;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
