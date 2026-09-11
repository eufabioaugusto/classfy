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
    message: "Milestones de views não fazem parte do motor econômico V1.",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
