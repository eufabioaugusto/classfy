import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { requestAiStructuredJson } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnalysisResult {
  approvalScore: number; // 0-100
  summary: string;
  mainTopic: string;
  category: string;
  targetAudience: string;
  suggestedTags: string[];
  contentWarnings: {
    hasExplicitContent: boolean;
    hasProfanity: boolean;
    hasOffensiveLanguage: boolean;
    hasViolence: boolean;
    hasMisleadingInfo: boolean;
    details: string[];
  };
  qualityAssessment: {
    educationalValue: "low" | "medium" | "high";
    contentClarity: "low" | "medium" | "high";
    engagement: "low" | "medium" | "high";
  };
  recommendation: "approve" | "review" | "reject";
  recommendationReason: string;
}

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get content details
    const { data: content, error: contentError } = await supabase
      .from("contents")
      .select("id, title, description, content_type, tags, file_url")
      .eq("id", contentId)
      .single();

    if (contentError || !content) {
      return new Response(
        JSON.stringify({ error: "Conteúdo não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for existing transcription (do NOT generate here - use transcribe-content function separately)
    let transcriptionText: string | null = null;
    const { data: existingTranscription } = await supabase
      .from("transcriptions")
      .select("text")
      .eq("content_id", contentId)
      .maybeSingle();

    if (existingTranscription?.text) {
      transcriptionText = existingTranscription.text;
      console.log("Using existing transcription for analysis");
    } else {
      console.log("No transcription available, analyzing based on metadata only");
    }

    // Prepare content for analysis
    const contentToAnalyze = transcriptionText 
      ? `Título: ${content.title}\n\nDescrição: ${content.description || "Sem descrição"}\n\nTranscrição do conteúdo:\n${transcriptionText}`
      : `Título: ${content.title}\n\nDescrição: ${content.description || "Sem descrição"}\n\nTags existentes: ${(content.tags || []).join(", ") || "Nenhuma"}`;

    // Call AI for comprehensive analysis
    const systemPrompt = `Você é um moderador e curador de conteúdo especializado em plataformas educacionais. 
Sua função é analisar conteúdos submetidos e fornecer uma avaliação completa para auxiliar na curadoria.

Analise o conteúdo considerando:
1. Adequação para uma plataforma educacional
2. Presença de conteúdo impróprio (palavrões, ofensas, violência, conteúdo explícito)
3. Qualidade educacional e valor agregado
4. Possíveis informações enganosas ou falsas
5. Público-alvo apropriado
6. Sugestões de categorização e tags

Seja rigoroso mas justo. Conteúdos educacionais podem discutir temas sensíveis de forma adequada.`;
    const schemaHint = `{
  "approvalScore": 0,
  "summary": "string",
  "mainTopic": "string",
  "category": "string",
  "targetAudience": "string",
  "suggestedTags": ["string"],
  "hasExplicitContent": false,
  "hasProfanity": false,
  "hasOffensiveLanguage": false,
  "hasViolence": false,
  "hasMisleadingInfo": false,
  "warningDetails": ["string"],
  "educationalValue": "low | medium | high",
  "contentClarity": "low | medium | high",
  "engagement": "low | medium | high",
  "recommendation": "approve | review | reject",
  "recommendationReason": "string"
}`;

    const { response: analysisResponse, parsed: analysisArgs } = await requestAiStructuredJson<{
      approvalScore: number;
      summary: string;
      mainTopic: string;
      category: string;
      targetAudience: string;
      suggestedTags: string[];
      hasExplicitContent: boolean;
      hasProfanity: boolean;
      hasOffensiveLanguage: boolean;
      hasViolence: boolean;
      hasMisleadingInfo: boolean;
      warningDetails: string[];
      educationalValue: "low" | "medium" | "high";
      contentClarity: "low" | "medium" | "high";
      engagement: "low" | "medium" | "high";
      recommendation: "approve" | "review" | "reject";
      recommendationReason: string;
    }>({
      model: "google/gemini-3-flash-preview",
      systemPrompt,
      userPrompt: contentToAnalyze,
      schemaHint,
      temperature: 0.2,
      maxTokens: 1800,
    });

    if (!analysisResponse.ok) {
      const errorText = await analysisResponse.text();
      console.error("AI analysis error:", analysisResponse.status, errorText);

      if (analysisResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns instantes." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (analysisResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos insuficientes. Por favor, adicione créditos ao seu workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Erro na análise: ${errorText}`);
    }

    if (!analysisArgs) {
      throw new Error("Falha ao obter análise estruturada");
    }

    // Format the result
    const result: AnalysisResult = {
      approvalScore: analysisArgs.approvalScore,
      summary: analysisArgs.summary,
      mainTopic: analysisArgs.mainTopic,
      category: analysisArgs.category,
      targetAudience: analysisArgs.targetAudience,
      suggestedTags: analysisArgs.suggestedTags,
      contentWarnings: {
        hasExplicitContent: analysisArgs.hasExplicitContent,
        hasProfanity: analysisArgs.hasProfanity,
        hasOffensiveLanguage: analysisArgs.hasOffensiveLanguage,
        hasViolence: analysisArgs.hasViolence,
        hasMisleadingInfo: analysisArgs.hasMisleadingInfo,
        details: analysisArgs.warningDetails || [],
      },
      qualityAssessment: {
        educationalValue: analysisArgs.educationalValue,
        contentClarity: analysisArgs.contentClarity,
        engagement: analysisArgs.engagement,
      },
      recommendation: analysisArgs.recommendation,
      recommendationReason: analysisArgs.recommendationReason,
    };

    console.log("Analysis complete:", result.recommendation, "Score:", result.approvalScore);

    return new Response(
      JSON.stringify({
        success: true,
        analysis: result,
        hasTranscription: !!transcriptionText,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in analyze-content:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Erro ao analisar conteúdo" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
