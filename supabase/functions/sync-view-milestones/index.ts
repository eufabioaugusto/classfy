const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({
    success: true,
    recognitionOnly: true,
    pointsAwarded: 0,
    message: "Sincronização econômica de milestones desativada na Economia V1.",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
