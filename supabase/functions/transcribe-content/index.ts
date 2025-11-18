import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contentId } = await req.json();

    if (!contentId) {
      return new Response(
        JSON.stringify({ error: "contentId é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if transcription already exists
    const { data: existingTranscription } = await supabase
      .from("transcriptions")
      .select("*")
      .eq("content_id", contentId)
      .maybeSingle();

    if (existingTranscription) {
      return new Response(
        JSON.stringify({
          success: true,
          transcription: existingTranscription,
          message: "Transcrição já existe",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get content details
    const { data: content, error: contentError } = await supabase
      .from("contents")
      .select("id, title, file_url, content_type")
      .eq("id", contentId)
      .single();

    if (contentError || !content) {
      return new Response(
        JSON.stringify({ error: "Conteúdo não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing content:", content.title);

    // Download video/audio file
    const fileResponse = await fetch(content.file_url);
    if (!fileResponse.ok) {
      throw new Error("Falha ao baixar arquivo de mídia");
    }

    const fileBlob = await fileResponse.blob();
    const arrayBuffer = await fileBlob.arrayBuffer();
    const audioData = new Uint8Array(arrayBuffer);

    // Convert to base64 for API
    const base64Audio = btoa(String.fromCharCode(...audioData));

    console.log("File downloaded, size:", audioData.length, "bytes");

    // Use Lovable AI to transcribe
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY não configurado");
    }

    // Call Lovable AI for transcription
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "Você é um transcritor profissional. Transcreva o áudio fornecido com precisão, incluindo pontuação adequada e formatação em parágrafos. Mantenha a linguagem natural e o contexto do conteúdo educacional.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Transcreva este ${content.content_type === "podcast" ? "podcast" : "vídeo"} educacional em português. Título: "${content.title}"`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:audio/webm;base64,${base64Audio}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Lovable AI error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns instantes." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos insuficientes. Por favor, adicione créditos ao seu workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Erro na API Lovable AI: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const transcriptionText = aiData.choices?.[0]?.message?.content;

    if (!transcriptionText) {
      throw new Error("Nenhuma transcrição foi gerada");
    }

    console.log("Transcription generated, length:", transcriptionText.length);

    // Save transcription to database
    const { data: savedTranscription, error: saveError } = await supabase
      .from("transcriptions")
      .insert({
        content_id: contentId,
        text: transcriptionText,
        language: "pt-BR",
      })
      .select()
      .single();

    if (saveError) {
      console.error("Error saving transcription:", saveError);
      throw new Error("Erro ao salvar transcrição");
    }

    return new Response(
      JSON.stringify({
        success: true,
        transcription: savedTranscription,
        message: "Transcrição gerada com sucesso",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in transcribe-content:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Erro ao gerar transcrição" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
