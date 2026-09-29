import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { getVideoProvider } from "../_shared/video/provider.ts";
import { resolveTutorReferences } from "../classy-chat/classy-context.ts";
import { transcribeAudioWithAi } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let leaseId: string | null = null;
  let cleanupClient: SupabaseClient | null = null;
  let transcriptTable = "transcriptions";
  try {
    const { contentId, lessonId } = await req.json();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if ((!!contentId === !!lessonId) || !uuid.test(contentId || lessonId)) {
      return new Response(JSON.stringify({ error: "Informe um contentId ou lessonId válido." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    transcriptTable = lessonId ? "lesson_transcriptions" : "transcriptions";
    const identityColumn = lessonId ? "lesson_id" : "content_id";
    const sourceId = lessonId || contentId;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    cleanupClient = supabase;
    const authorization = req.headers.get("authorization") || "";
    const serviceCaller = authorization.replace(/^Bearer /i, "") === supabaseServiceKey;
    if (!serviceCaller) {
      const { data: { user } } = await supabase.auth.getUser(authorization.replace(/^Bearer /i, ""));
      if (!user) return new Response(JSON.stringify({ error: "Entre na sua conta para usar a transcrição." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: profile } = await supabase.from("profiles").select("plan, plan_expires_at").eq("id", user.id).single();
      const plan = profile?.plan_expires_at && Date.parse(profile.plan_expires_at) < Date.now() ? "free" : profile?.plan || "free";
      try { await resolveTutorReferences(supabase, [{ type: lessonId ? "lesson" : "content", id: sourceId }], user.id, plan); }
      catch { return new Response(JSON.stringify({ error: "Desbloqueie esta aula para usar a transcrição." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    }
    let content: any;
    if (lessonId) {
      const { data: lesson } = await supabase.from("course_lessons").select("id,title,video_url,media_asset_id,content_id").eq("id", lessonId).single();
      if (lesson?.content_id) {
        const { data } = await supabase.from("contents").select("id,title,file_url,media_asset_id,content_type").eq("id", lesson.content_id).single();
        content = data;
      } else if (lesson) content = { ...lesson, file_url: lesson.video_url, content_type: "video" };
    } else {
      const { data } = await supabase.from("contents").select("id,title,file_url,media_asset_id,content_type").eq("id", contentId).single();
      content = data;
    }
    if (!content) return new Response(JSON.stringify({ error: "Conteúdo não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: existingTranscription } = await supabase.from(transcriptTable).select("*").eq(identityColumn, sourceId).maybeSingle();
    if (existingTranscription?.text) return new Response(JSON.stringify({ success: true, transcription: existingTranscription }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // The unique source identity reserves one generation; other viewers reuse or wait.
    const { data: reservation, error: reservationError } = await supabase.from(transcriptTable)
      .insert({ [identityColumn]: sourceId, text: '', language: 'pt-BR' }).select('id').single();
    if (reservationError) {
      if (reservationError.code !== '23505') throw reservationError;
      const { data: current } = await supabase.from(transcriptTable).select('*').eq(identityColumn, sourceId).single();
      if (current?.text) return new Response(JSON.stringify({ success: true, transcription: current }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      // Recover a crashed worker after ten minutes, with an atomic lease comparison.
      if (current?.updated_at && Date.now() - Date.parse(current.updated_at) > 600000) {
        const { data: renewed } = await supabase.from(transcriptTable).update({ updated_at: new Date().toISOString() })
          .eq('id', current.id).eq('text', '').eq('updated_at', current.updated_at).select('id').maybeSingle();
        leaseId = renewed?.id || null;
      }
      if (!leaseId) return new Response(JSON.stringify({ processing: true, message: 'A transcrição já está sendo preparada. Consulte novamente em instantes.' }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else { leaseId = reservation.id; }

    console.log("Processing content:", content.title);

    // Download video/audio file
    let sourceUrl = content.file_url;
    let sourceMime: string | undefined;
    if (sourceUrl?.startsWith('media://') || content.media_asset_id) {
      const mediaId = content.media_asset_id || sourceUrl.slice('media://'.length);
      const { data: asset } = await supabase.from('media_assets').select('*').eq('id', mediaId).single();
      const { data: binding } = asset?.active_provider_binding_id
        ? await supabase.from('media_provider_assets').select('*').eq('id', asset.active_provider_binding_id).single()
        : { data: null };
      if (!asset || !binding) throw new Error("Mídia ainda não está pronta para transcrição.");
      const provider = getVideoProvider(binding.provider);
      if (!provider.getTranscriptionSource) throw new Error("Transcrição ainda não disponível para este provedor de mídia.");
      const source = await provider.getTranscriptionSource(binding, asset);
      sourceUrl = source.url;
      sourceMime = source.mimeType;
    }
    if (!sourceUrl || !/^https?:\/\//.test(sourceUrl)) throw new Error("Fonte de mídia indisponível para transcrição.");
    const fileResponse = await fetch(sourceUrl);
    if (!fileResponse.ok) {
      throw new Error("Falha ao baixar arquivo de mídia");
    }

    if (Number(fileResponse.headers.get("content-length") || 0) > 18 * 1024 * 1024) throw new Error("Áudio muito longo para transcrição imediata. Solicite o processamento ao creator.");
    const fileBlob = await fileResponse.blob();
    if (fileBlob.size > 18 * 1024 * 1024) throw new Error("Áudio muito longo para transcrição imediata.");
    const arrayBuffer = await fileBlob.arrayBuffer();
    const audioData = new Uint8Array(arrayBuffer);
    const mimeType = sourceMime || fileBlob.type || fileResponse.headers.get("content-type") || "audio/webm";

    // Convert to base64 for API
    let binary = "";
    for (let offset = 0; offset < audioData.length; offset += 8192) binary += String.fromCharCode(...audioData.subarray(offset, offset + 8192));
    const base64Audio = btoa(binary);

    console.log("File downloaded, size:", audioData.length, "bytes");

    const aiResponse = await transcribeAudioWithAi({
      model: "google/gemini-2.5-flash",
      prompt: `Você é um transcritor profissional. Transcreva com precisão este ${content.content_type === "podcast" ? "podcast" : "vídeo"} educacional em português. Título: "${content.title}". Entregue apenas a transcrição, com pontuação adequada e parágrafos naturais.`,
      audioBase64: base64Audio,
      mimeType,
      openRouterModel: "openai/whisper-large-v3",
    });

    if (!aiResponse.response.ok) {
      const errorText = JSON.stringify(aiResponse.data);
      console.error("AI transcription error:", aiResponse.response.status, errorText);
      
      if (aiResponse.response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns instantes." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (aiResponse.response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos insuficientes no provider de IA." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Erro na API de transcrição: ${errorText}`);
    }

    const transcriptionText = aiResponse.text;

    if (!transcriptionText) {
      throw new Error("Nenhuma transcrição foi gerada");
    }

    console.log("Transcription generated, length:", transcriptionText.length);

    // Save transcription to database
    const { data: savedTranscription, error: saveError } = await supabase
      .from(transcriptTable)
      .update({ text: transcriptionText, language: "pt-BR", updated_at: new Date().toISOString() })
      .eq("id", leaseId!)
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
  } finally {
    // Only discard an empty reservation; never delete a completed transcript.
    if (leaseId && cleanupClient) await cleanupClient.from(transcriptTable).delete().eq("id", leaseId).eq("text", "");
  }
});
