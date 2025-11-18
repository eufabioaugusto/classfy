import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { studyId, message } = await req.json();

    // Get authenticated user from JWT
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Use service role key for all DB operations (bypasses RLS; we validate manual ownership)
    const supabaseServiceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify study ownership and fetch user profile
    const { data: study, error: studyError } = await supabaseServiceClient
      .from("studies")
      .select("*")
      .eq("id", studyId)
      .single();

    if (studyError || !study || study.user_id !== user.id) {
      console.error('Study not found or access denied:', {
        studyId,
        userId: user.id,
        studyError,
      });
      return new Response(
        JSON.stringify({ error: 'Estudo não encontrado ou acesso negado' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Fetch user profile for personalization
    const { data: profile } = await supabaseServiceClient
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single();

    const userName = profile?.display_name?.split(' ')[0] || 'você';


    // Fetch conversation history
    const { data: messages } = await supabaseServiceClient
      .from("study_messages")
      .select("*")
      .eq("study_id", studyId)
      .order("created_at", { ascending: true })
      .limit(20);

    const conversationHistory = messages?.map((m: any) => ({
      role: m.role,
      content: m.content,
    })) || [];

    const isFirstMessage = !messages || messages.length === 0;

    // Search for related content based on user's message or study title
    const searchQuery = isFirstMessage ? study.title.toLowerCase() : message.toLowerCase();
    let relatedContents = [];
    
    const { data: contents } = await supabaseServiceClient
      .from("contents")
      .select("id, title, description, content_type, thumbnail_url, visibility, required_plan")
      .eq("status", "approved")
      .limit(10);

    if (contents && contents.length > 0) {
      // Calculate match score for each content
      relatedContents = contents
        .map((content: any) => {
          const titleLower = content.title.toLowerCase();
          const descLower = (content.description || "").toLowerCase();
          
          // Simple matching algorithm
          let score = 0;
          const searchWords = searchQuery.split(" ");
          
          searchWords.forEach((word: string) => {
            if (word.length < 3) return; // Skip very short words
            if (titleLower.includes(word)) score += 3;
            if (descLower.includes(word)) score += 1;
          });

          // Exact match bonus
          if (titleLower.includes(searchQuery)) score += 5;
          if (descLower.includes(searchQuery)) score += 2;
          
          return { ...content, matchScore: score };
        })
        .filter((c: any) => c.matchScore > 0)
        .sort((a: any, b: any) => b.matchScore - a.matchScore)
        .slice(0, 5);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    let systemPrompt = `Você é Classy, a inteligência artificial oficial da plataforma Classfy.

CONTEXTO DO ESTUDO ATUAL:
Tema: ${study?.title || "Sem título"}
${study?.description ? `Descrição: ${study.description}` : ""}
Nome do usuário: ${userName}

OBJETIVO CENTRAL:
Seu papel é GUIAR O USUÁRIO A CONSUMIR CONTEÚDOS da plataforma. Você NÃO é um chatbot de diálogo livre. Sua missão é RECOMENDAR CONTEÚDOS RELEVANTES em forma de cards clicáveis.

REGRAS DE IDENTIDADE:
- Sempre se apresente como "Classy"
- Chame o usuário pelo primeiro nome: ${userName}
- Tom acolhedor, direto e motivador
- SEJA BREVE: máximo 2-3 frases por resposta

REGRAS DE CONTEÚDO (CRÍTICO):
- **NUNCA** sugerir links externos (YouTube, Netflix, TED, etc)
- **NUNCA** mencionar concorrentes (YouTube, Udemy, Hotmart, etc)
- **SEMPRE** recomendar conteúdos da plataforma Classfy
- Foco total em fazer o usuário CONSUMIR conteúdo, não dialogar

MECÂNICA DE RESPOSTA:
1. PRIMEIRA MENSAGEM: Apresentação curta + sugerir conteúdos
   Exemplo: "Olá ${userName}, sou a Classy, e estou aqui para guiar você nessa jornada de aprendizado dentro da Classfy. Veja o que encontrei para você:"

2. DEMAIS MENSAGENS: Interpretação rápida + sugerir conteúdos imediatamente
   - NÃO faça longas explicações
   - NÃO dialogue extensivamente
   - VÁ DIRETO aos conteúdos recomendados
   - Máximo 2-3 frases antes de recomendar

FORMATO DE RECOMENDAÇÃO:
- Seja entusiasta mas breve
- Explique em 1 frase por que cada conteúdo é relevante
- Os cards aparecerão automaticamente abaixo da sua mensagem

LIMITAÇÕES:
- Se o usuário pedir algo fora do escopo: "Posso te ajudar com conteúdos da Classfy 😊 O que você quer aprender?"

TOM E ESTILO:
- RESPOSTAS CURTAS (2-3 frases máximo)
- Direto ao ponto
- Sempre termine sugerindo conteúdos
- Use emojis com moderação (1 por resposta)`;

    // Add content recommendations to system prompt if available
    if (relatedContents.length > 0) {
      systemPrompt += `\n\n═══════════════════════════════════════════════════════════
CONTEÚDOS ENCONTRADOS (serão exibidos em cards abaixo da sua mensagem):
═══════════════════════════════════════════════════════════\n`;
      relatedContents.forEach((content: any, index: number) => {
        const matchPercent = Math.min(100, Math.round((content.matchScore / 10) * 100));
        systemPrompt += `\n${index + 1}. "${content.title}"`;
        systemPrompt += `\n   Relevância: ${matchPercent}%`;
        systemPrompt += `\n   Tipo: ${content.content_type === 'aula' ? 'Aula' : content.content_type === 'podcast' ? 'Podcast' : 'Short'}`;
        if (content.description) {
          systemPrompt += `\n   Sobre: ${content.description.substring(0, 100)}...`;
        }
        systemPrompt += `\n`;
      });
      
      if (isFirstMessage) {
        systemPrompt += `\n═══════════════════════════════════════════════════════════
INSTRUÇÕES PARA PRIMEIRA RESPOSTA:
- Apresente-se: "Olá ${userName}, sou a Classy, e estou aqui para guiar você nessa jornada de aprendizado dentro da Classfy."
- Diga em 1 frase o que você encontrou sobre "${study.title}"
- Mencione que os conteúdos aparecem em cards abaixo
- SEJA BREVE: máximo 3 frases no total`;
      } else {
        systemPrompt += `\n═══════════════════════════════════════════════════════════
INSTRUÇÕES PARA ESTA RESPOSTA:
- Reconheça o interesse do usuário em 1 frase
- Mencione brevemente que encontrou conteúdos relevantes
- Os cards aparecerão automaticamente abaixo
- SEJA BREVE: máximo 2-3 frases no total`;
      }
    } else if (isFirstMessage) {
      systemPrompt += `\n\nINSTRUÇÕES PARA PRIMEIRA RESPOSTA SEM CONTEÚDOS:
- Apresente-se: "Olá ${userName}, sou a Classy, e estou aqui para guiar você nessa jornada de aprendizado dentro da Classfy."
- Pergunte o que especificamente ele quer aprender sobre "${study.title}"
- SEJA BREVE: máximo 3 frases`;
    }

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            ...conversationHistory,
            { role: "user", content: message },
          ],
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({
            error:
              "Limite de requisições atingido. Tente novamente em alguns instantes.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({
            error:
              "Créditos de IA esgotados. Entre em contato com o suporte.",
          }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const aiMessage = data.choices?.[0]?.message?.content || "Desculpe, não consegui processar sua mensagem.";

    // Return both message and related contents
    const responseData: any = { message: aiMessage };
    if (relatedContents.length > 0) {
      responseData.relatedContents = relatedContents;
    }

    return new Response(
      JSON.stringify(responseData),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in classy-chat:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "Erro ao processar mensagem" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
