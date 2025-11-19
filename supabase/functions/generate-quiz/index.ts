import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Generate quiz function called");
    const { studyId, contentId } = await req.json();
    console.log("Request params:", { studyId, contentId });

    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      console.error("No authorization header");
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      console.error("User authentication error:", userError);
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("User authenticated:", user.id);

    const supabaseServiceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify study ownership
    const { data: study, error: studyError } = await supabaseServiceClient
      .from("studies")
      .select("*")
      .eq("id", studyId)
      .single();

    if (studyError || !study || study.user_id !== user.id) {
      console.error("Study verification error:", studyError);
      return new Response(
        JSON.stringify({ error: 'Estudo não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("Study verified");

    // Check if quiz already exists for this content
    const { data: existingQuiz } = await supabaseServiceClient
      .from("study_quizzes")
      .select("*")
      .eq("study_id", studyId)
      .eq("content_id", contentId)
      .single();

    if (existingQuiz) {
      console.log("Returning existing quiz");
      return new Response(
        JSON.stringify(existingQuiz),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch content and transcription
    const { data: content } = await supabaseServiceClient
      .from("contents")
      .select("id, title, description")
      .eq("id", contentId)
      .single();

    if (!content) {
      console.error("Content not found");
      return new Response(
        JSON.stringify({ error: 'Conteúdo não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("Content found:", content.title);

    const { data: transcriptionData } = await supabaseServiceClient
      .from("transcriptions")
      .select("text")
      .eq("content_id", contentId)
      .single();

    const transcriptionText = transcriptionData?.text || "";
    console.log("Transcription length:", transcriptionText.length);

    if (!transcriptionText) {
      console.error("No transcription available");
      return new Response(
        JSON.stringify({ error: 'Transcrição não disponível para este conteúdo. Por favor, aguarde o processamento automático.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Generate quiz using AI
    const systemPrompt = `Você é um especialista em criar questões educacionais de alta qualidade.

CONTEÚDO: ${content.title}
DESCRIÇÃO: ${content.description || "Sem descrição"}

TRANSCRIÇÃO:
${transcriptionText.substring(0, 8000)}

INSTRUÇÕES:
- Crie 5 questões de múltipla escolha baseadas NO CONTEÚDO REAL da transcrição
- Cada questão deve ter 4 alternativas (A, B, C, D)
- Apenas UMA alternativa correta por questão
- As questões devem ser progressivas em dificuldade (fácil → difícil)
- Questões devem testar COMPREENSÃO, não memorização literal
- Inclua explicações detalhadas para cada resposta correta

Use tool calling para retornar as questões no formato estruturado.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Gere o quiz" }
        ],
        tools: [{
          type: "function",
          function: {
            name: "create_quiz",
            description: "Cria um quiz com questões de múltipla escolha",
            parameters: {
              type: "object",
              properties: {
                questions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      question: { type: "string", description: "A pergunta" },
                      options: {
                        type: "array",
                        items: { type: "string" },
                        description: "4 opções de resposta"
                      },
                      correctAnswer: { 
                        type: "number", 
                        description: "Índice da resposta correta (0-3)" 
                      },
                      explanation: { 
                        type: "string", 
                        description: "Explicação detalhada da resposta correta" 
                      },
                      difficulty: {
                        type: "string",
                        enum: ["easy", "medium", "hard"],
                        description: "Nível de dificuldade"
                      }
                    },
                    required: ["question", "options", "correctAnswer", "explanation", "difficulty"]
                  }
                }
              },
              required: ["questions"]
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "create_quiz" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`Erro ao comunicar com IA: ${response.status} - ${errorText}`);
    }

    const aiData = await response.json();
    console.log("AI response received");
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      console.error("No tool call in AI response");
      throw new Error("IA não retornou dados do quiz. Tente novamente.");
    }

    const quizData = JSON.parse(toolCall.function.arguments);
    console.log("Quiz data parsed, questions count:", quizData.questions?.length);
    
    // Save quiz to database
    const { data: savedQuiz, error: saveError } = await supabaseServiceClient
      .from("study_quizzes")
      .insert({
        study_id: studyId,
        content_id: contentId,
        questions: quizData.questions,
        metadata: {
          content_title: content.title,
          generated_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (saveError) {
      console.error("Error saving quiz:", saveError);
      throw new Error("Erro ao salvar quiz no banco de dados");
    }

    console.log("Quiz saved successfully");
    return new Response(
      JSON.stringify(savedQuiz),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error("Error in generate-quiz:", error);
    const errorMessage = (error as Error).message || "Erro ao gerar quiz";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});