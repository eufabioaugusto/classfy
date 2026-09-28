import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return new Response(null, { status: 405, headers });
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    const client = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    // Ignore user IDs/codes in the body. Only the immutable signup claim is eligible.
    const { data, error } = await client.rpc("finalize_referral_signup_v1", { p_user_id: user.id });
    if (error) throw error;
    return new Response(JSON.stringify({ success: true, ...data }), { headers });
  } catch {
    console.error("Referral conversion registration failed");
    return new Response(JSON.stringify({ error: "Unable to register conversion" }), { status: 503, headers });
  }
});
