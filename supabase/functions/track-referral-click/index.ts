import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return new Response(null, { status: 405, headers });
  try {
    const { referral_code } = await req.json();
    if (typeof referral_code !== "string" || !/^[A-Za-z0-9_-]{3,50}$/.test(referral_code)) return new Response(JSON.stringify({ error: "Invalid referral code" }), { status: 400, headers });
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    // The gateway's address is only a best-effort abuse signal, never identity.
    // Salt the hash; do not persist or log the visitor's raw IP.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${referral_code}:${ip}`));
    const hash = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
    const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", key, { auth: { persistSession: false } });
    const { error } = await client.rpc("track_referral_click_v1", { p_code: referral_code, p_visitor_hash: hash });
    if (error) throw error;
    // Same response for an unknown link, so this endpoint cannot enumerate codes.
    return new Response(JSON.stringify({ success: true }), { headers });
  } catch {
    console.error("Referral click registration failed");
    return new Response(JSON.stringify({ error: "Unable to register click" }), { status: 503, headers });
  }
});
