// Read-only Supabase client for dashboard snapshots.
//
// Production (Lovable Cloud) injects SUPABASE_SERVICE_ROLE_KEY, so we keep using
// the admin client there. Local development (e.g. Cursor) only has the
// publishable key, which cannot bypass RLS — for those environments we fall back
// to a publishable-key client that calls the two SECURITY DEFINER read-only RPCs
// (`get_agent_snapshot`, `get_budget_pool_today`) granted to `anon`.
//
// Writes always keep using the admin client and will fail loudly without the
// service role key.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function isOpaqueKey(value: string) {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function publishableFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    if (isOpaqueKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

let _publicClient: SupabaseClient<Database> | undefined;

function publicClient() {
  if (_publicClient) return _publicClient;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "Missing Supabase environment variable(s): SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  _publicClient = createClient<Database>(url, key, {
    global: { fetch: publishableFetch(key) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  return _publicClient;
}

/** Admin client when the service role key exists, publishable client otherwise. */
export async function getReadClient() {
  if (process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin as unknown as SupabaseClient<Database>;
  }
  return publicClient();
}

/** True when privileged writes are available in this environment. */
export function hasServiceRole() {
  return Boolean(process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}
