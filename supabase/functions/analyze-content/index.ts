import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

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

    // Check for existing transcription
    let transcriptionText: string | null = null;
    const { data: existingTranscription } = await supabase
      .from("transcriptions")
      .select("text")
      .eq("content_id", contentId)
      .maybeSingle();

    if (existingTranscription?.text) {
      transcriptionText = existingTranscription.text;
      console.log("Using existing transcription");
    } else {
      // Generate transcription first
      console.log("Generating transcription for content:", content.title);
      
      if (content.file_url) {
        try {
          // Download and transcribe the video
          const fileResponse = await fetch(content.file_url);
          if (fileResponse.ok) {
            const fileBlob = await fileResponse.blob();
            const arrayBuffer = await fileBlob.arrayBuffer();
            const audioData = new Uint8Array(arrayBuffer);
            
            // Only process if file is not too large (< 20MB for transcription)
            if (audioData.length < 20 * 1024 * 1024) {
              const base64Audio = btoa(String.fromCharCode(...audioData));
              
              const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
              if (LOVABLE_API_KEY) {
                const transcribeResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
                        content: "Você é um transcritor profissional. Transcreva o áudio com precisão, incluindo pontuação adequada.",
                      },
                      {
                        role: "user",
                        content: [
                          { type: "text", text: `Transcreva este conteúdo: "${content.title}"` },
                          { type: "image_url", image_url: { url: `data:audio/webm;base64,${base64Audio}` } },
                        ],
                      },
                    ],
                  }),
                });

                if (transcribeResponse.ok) {
                  const transcribeData = await transcribeResponse.json();
                  transcriptionText = transcribeData.choices?.[0]?.message?.content;
                  
                  // Save transcription
                  if (transcriptionText) {
                    await supabase.from("transcriptions").insert({
                      content_id: contentId,
                      text: transcriptionText,
                      language: "pt-BR",
                    });
                    console.log("Transcription saved");
                  }
                }
              }
            } else {
              console.log("File too large for transcription, analyzing metadata only");
            }
          }
        } catch (e) {
          console.error("Error generating transcription:", e);
        }
      }
    }

    // Prepare content for analysis
    const contentToAnalyze = transcriptionText 
      ? `Título: ${content.title}\n\nDescrição: ${content.description || "Sem descrição"}\n\nTranscrição do conteúdo:\n${transcriptionText}`
      : `Título: ${content.title}\n\nDescrição: ${content.description || "Sem descrição"}\n\nTags existentes: ${(content.tags || []).join(", ") || "Nenhuma"}`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY não configurado");
    }

    // Call AI for comprehensive analysis
    const analysisResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Você é um moderador e curador de conteúdo especializado em plataformas educacionais. 
Sua função é analisar conteúdos submetidos e fornecer uma avaliação completa para auxiliar na curadoria.

Analise o conteúdo considerando:
1. Adequação para uma plataforma educacional
2. Presença de conteúdo impróprio (palavrões, ofensas, violência, conteúdo explícito)
3. Qualidade educacional e valor agregado
4. Possíveis informações enganosas ou falsas
5. Público-alvo apropriado
6. Sugestões de categorização e tags

Seja rigoroso mas justo. Conteúdos educacionais podem discutir temas sensíveis de forma adequada.`,
          },
          {
            role: "user",
            content: contentToAnalyze,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "analyze_content",
              description: "Retorna a análise completa do conteúdo para curadoria",
              parameters: {
                type: "object",
                properties: {
                  approvalScore: {
                    type: "number",
                    description: "Score de 0 a 100 indicando a recomendação de aprovação. 0-40 = rejeitar, 41-70 = revisar manualmente, 71-100 = aprovar",
                  },
                  summary: {
                    type: "string",
                    description: "Resumo breve do conteúdo em 2-3 frases",
                  },
                  mainTopic: {
                    type: "string",
                    description: "Tema principal do conteúdo",
                  },
                  category: {
                    type: "string",
                    description: "Categoria sugerida (ex: Desenvolvimento Pessoal, Tecnologia, Negócios, Saúde, Educação, etc)",
                  },
                  targetAudience: {
                    type: "string",
                    description: "Público-alvo recomendado (ex: Todos os públicos, Adultos, Profissionais, Estudantes)",
                  },
                  suggestedTags: {
                    type: "array",
                    items: { type: "string" },
                    description: "Lista de 5-8 tags relevantes para o conteúdo",
                  },
                  hasExplicitContent: {
                    type: "boolean",
                    description: "Se contém conteúdo sexual ou explícito",
                  },
                  hasProfanity: {
                    type: "boolean",
                    description: "Se contém palavrões ou linguagem vulgar",
                  },
                  hasOffensiveLanguage: {
                    type: "boolean",
                    description: "Se contém linguagem ofensiva, discriminatória ou de ódio",
                  },
                  hasViolence: {
                    type: "boolean",
                    description: "Se contém descrições ou incitação à violência",
                  },
                  hasMisleadingInfo: {
                    type: "boolean",
                    description: "Se contém informações potencialmente falsas ou enganosas",
                  },
                  warningDetails: {
                    type: "array",
                    items: { type: "string" },
                    description: "Detalhes específicos sobre quaisquer avisos de conteúdo encontrados",
                  },
                  educationalValue: {
                    type: "string",
                    enum: ["low", "medium", "high"],
                    description: "Valor educacional do conteúdo",
                  },
                  contentClarity: {
                    type: "string",
                    enum: ["low", "medium", "high"],
                    description: "Clareza e qualidade da comunicação",
                  },
                  engagement: {
                    type: "string",
                    enum: ["low", "medium", "high"],
                    description: "Potencial de engajamento do conteúdo",
                  },
                  recommendation: {
                    type: "string",
                    enum: ["approve", "review", "reject"],
                    description: "Recomendação final: aprovar, revisar ou rejeitar",
                  },
                  recommendationReason: {
                    type: "string",
                    description: "Justificativa detalhada para a recomendação",
                  },
                },
                required: [
                  "approvalScore",
                  "summary",
                  "mainTopic",
                  "category",
                  "targetAudience",
                  "suggestedTags",
                  "hasExplicitContent",
                  "hasProfanity",
                  "hasOffensiveLanguage",
                  "hasViolence",
                  "hasMisleadingInfo",
                  "warningDetails",
                  "educationalValue",
                  "contentClarity",
                  "engagement",
                  "recommendation",
                  "recommendationReason",
                ],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "analyze_content" } },
      }),
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

    const analysisData = await analysisResponse.json();
    const toolCall = analysisData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      throw new Error("Falha ao obter análise estruturada");
    }

    const analysisArgs = JSON.parse(toolCall.function.arguments);

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
