// Project-specific bearer attacher (replaces the generated attachSupabaseAuth).
//
// The generated version instantiates the Supabase browser client eagerly, which
// throws "Missing Supabase environment variable(s): SUPABASE_URL,
// SUPABASE_PUBLISHABLE_KEY" when a local .env lacks the VITE_* lines — that
// error then surfaced on EVERY server function call (e.g. Google Ads 探活),
// masking the real cause. This app has no signed-in user for its server
// functions, so a missing session must degrade gracefully.
import { createMiddleware } from "@tanstack/react-start";

export const attachSupabaseAuthSafe = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    let token: string | undefined;
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
    } catch (error) {
      // Missing/incomplete Supabase env locally — continue unauthenticated.
      console.warn("[auth-attacher] skipped bearer token:", error);
    }
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
