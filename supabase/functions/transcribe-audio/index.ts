import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { transcribeAudioWithAi } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user } } = await client.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Entre na sua conta para ditar uma mensagem." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (Number(req.headers.get("content-length")) > 3 * 1024 * 1024) return new Response(JSON.stringify({ error: "Áudio muito grande. Grave até um minuto." }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const rawBody = await req.text();
    if (rawBody.length > 3 * 1024 * 1024) return new Response(JSON.stringify({ error: "Áudio muito grande. Grave até um minuto." }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { audioBase64, mimeType } = JSON.parse(rawBody);

    if (typeof audioBase64 !== "string" || !audioBase64 || audioBase64.length > 2_800_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)) {
      return new Response(
        JSON.stringify({ error: "audioBase64 é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const actualMimeType = typeof mimeType === "string" ? mimeType.split(";")[0].toLowerCase() : "audio/m4a";
    if (!["audio/webm", "audio/mp4", "audio/m4a", "audio/ogg", "audio/mpeg", "audio/wav"].includes(actualMimeType)) return new Response(JSON.stringify({ error: "Formato de áudio não suportado." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    console.log("Transcribing audio, size:", Math.round(audioBase64.length / 1.33), "bytes");

    // Call shared transcription helper using either Gemini or OpenRouter Whisper
    const aiResponse = await transcribeAudioWithAi({
      model: "google/gemini-2.5-flash",
      prompt: "Transcreva este áudio falado em português. Retorne apenas a transcrição direta, preservando pontuação, sem comentários adicionais. Se não houver fala reconhecível, retorne texto vazio.",
      audioBase64,
      mimeType: actualMimeType,
      openRouterModel: "openai/whisper-large-v3",
    });

    if (!aiResponse.response.ok) {
      const errorText = JSON.stringify(aiResponse.data);
      console.error("AI transcription error:", aiResponse.response.status, errorText);
      throw new Error(aiResponse.response.status === 429 ? "Transcrição ocupada. Tente novamente em instantes." : "Não foi possível transcrever agora. Tente novamente.");
    }

    const transcriptionText = aiResponse.text;

    if (!transcriptionText) {
      throw new Error("Nenhuma transcrição foi gerada");
    }

    return new Response(
      JSON.stringify({
        success: true,
        text: transcriptionText,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in transcribe-audio:", error);
    return new Response(
      JSON.stringify({ error: error.message === "AI_PROVIDER_NOT_CONFIGURED" ? "A transcrição de voz ainda não está configurada." : "Não foi possível transcrever o áudio. Tente novamente." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
