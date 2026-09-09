import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Creates a Supabase client with the service role key.
 * This bypasses RLS and should ONLY be used in:
 * - Webhook handlers
 * - Cron jobs
 * - Server-side operations that need full access
 *
 * NEVER expose this client to the browser or use in client components.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
