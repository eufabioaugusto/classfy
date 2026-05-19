import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requestAiStructuredJson } from "../_shared/ai-provider.ts";

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

Retorne JSON no formato solicitado.`;

    const schemaHint = `{
  "questions": [
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correctAnswer": 0,
      "explanation": "string",
      "difficulty": "easy | medium | hard"
    }
  ]
}`;

    const { response, parsed: quizData } = await requestAiStructuredJson<{ questions: Array<{
      question: string;
      options: string[];
      correctAnswer: number;
      explanation: string;
      difficulty: "easy" | "medium" | "hard";
    }> }>({
      model: "google/gemini-2.5-flash",
      systemPrompt,
      userPrompt: "Gere o quiz agora.",
      schemaHint,
      temperature: 0.4,
      maxTokens: 1800,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`Erro ao comunicar com IA: ${response.status} - ${errorText}`);
    }

    console.log("AI response received");
    
    if (!quizData?.questions?.length) {
      console.error("No quiz questions in AI response");
      throw new Error("IA não retornou dados do quiz. Tente novamente.");
    }
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
