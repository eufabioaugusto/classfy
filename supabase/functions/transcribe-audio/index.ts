import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const { audioBase64, mimeType } = await req.json();

    if (!audioBase64) {
      return new Response(
        JSON.stringify({ error: "audioBase64 é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const actualMimeType = mimeType || "audio/m4a";

    console.log("Transcribing audio, size:", Math.round(audioBase64.length / 1.33), "bytes");

    // Call shared transcription helper using either Gemini or OpenRouter Whisper
    const aiResponse = await transcribeAudioWithAi({
      model: "google/gemini-2.5-flash",
      prompt: "Transcreva este áudio falado em português. Retorne apenas a transcrição direta, preservando pontuação, sem comentários adicionais.",
      audioBase64,
      mimeType: actualMimeType,
      openRouterModel: "openai/whisper-large-v3",
    });

    if (!aiResponse.response.ok) {
      const errorText = JSON.stringify(aiResponse.data);
      console.error("AI transcription error:", aiResponse.response.status, errorText);
      throw new Error(`Erro na API de transcrição: ${errorText}`);
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
      JSON.stringify({ error: error.message || "Erro ao gerar transcrição" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
