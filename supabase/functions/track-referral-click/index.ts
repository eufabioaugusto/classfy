import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple in-memory rate limiting (resets on function cold start)
const clickTracking = new Map<string, { count: number; firstClick: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_CLICKS_PER_IP_PER_CODE = 5;

function getClientIP(req: Request): string {
  // Try various headers that might contain the real IP
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIP = req.headers.get("x-real-ip");
  if (realIP) {
    return realIP;
  }
  // Fallback - won't be real IP but at least something
  return "unknown";
}

function hashKey(ip: string, referralCode: string): string {
  // Simple hash to create a unique key for IP+code combination
  return `${ip}:${referralCode}`;
}

function isRateLimited(ip: string, referralCode: string): boolean {
  const key = hashKey(ip, referralCode);
  const now = Date.now();
  const tracking = clickTracking.get(key);

  if (!tracking) {
    clickTracking.set(key, { count: 1, firstClick: now });
    return false;
  }

  // Reset window if expired
  if (now - tracking.firstClick > RATE_LIMIT_WINDOW_MS) {
    clickTracking.set(key, { count: 1, firstClick: now });
    return false;
  }

  // Check if over limit
  if (tracking.count >= MAX_CLICKS_PER_IP_PER_CODE) {
    return true;
  }

  // Increment count
  tracking.count++;
  clickTracking.set(key, tracking);
  return false;
}

// Clean up old entries periodically
function cleanupOldEntries() {
  const now = Date.now();
  for (const [key, value] of clickTracking.entries()) {
    if (now - value.firstClick > RATE_LIMIT_WINDOW_MS) {
      clickTracking.delete(key);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { referral_code } = await req.json();

    if (!referral_code) {
      throw new Error("Referral code is required");
    }

    // Validate referral code format (alphanumeric only, reasonable length)
    if (typeof referral_code !== 'string' || 
        referral_code.length < 3 || 
        referral_code.length > 50 ||
        !/^[a-zA-Z0-9_-]+$/.test(referral_code)) {
      throw new Error("Invalid referral code format");
    }

    // Get client IP for rate limiting
    const clientIP = getClientIP(req);

    // Check rate limit
    if (isRateLimited(clientIP, referral_code)) {
      console.log(`Rate limited: IP ${clientIP} for code ${referral_code}`);
      return new Response(
        JSON.stringify({ success: true, message: "Click tracked" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Periodic cleanup
    cleanupOldEntries();

    // Verify the referral code exists before updating
    const { data: link, error: fetchError } = await supabaseClient
      .from("referral_links")
      .select("total_clicks")
      .eq("referral_code", referral_code)
      .single();

    if (fetchError || !link) {
      console.log(`Referral code not found: ${referral_code}`);
      // Return success to not leak info about valid codes
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabaseClient
      .from("referral_links")
      .update({ total_clicks: (link.total_clicks || 0) + 1 })
      .eq("referral_code", referral_code);

    console.log(`Referral click tracked: ${referral_code} from IP ${clientIP}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error tracking referral click:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
