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

    // Verify study ownership
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

    // Search for related content if this is the first message
    let relatedContents = [];
    if (isFirstMessage) {
      const searchQuery = study.title.toLowerCase();
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

            // Exact title match bonus
            if (titleLower.includes(searchQuery)) score += 5;
            
            return { ...content, matchScore: score };
          })
          .filter((c: any) => c.matchScore > 0)
          .sort((a: any, b: any) => b.matchScore - a.matchScore)
          .slice(0, 5);
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    let systemPrompt = `Você é Classy, a inteligência artificial oficial da plataforma Classfy.

CONTEXTO DO ESTUDO ATUAL:
Tema: ${study?.title || "Sem título"}
${study?.description ? `Descrição: ${study.description}` : ""}

OBJETIVO CENTRAL:
Guiar e facilitar a jornada de aprendizado do usuário, ajudando-o a encontrar e consumir conteúdos dentro da plataforma Classfy. Seu papel é atuar como tutor inteligente e interface principal de descoberta de conteúdos.

REGRAS DE IDENTIDADE:
- Sempre se apresente como "Classy"
- Mantenha tom acolhedor, inteligente e motivador — sem ser infantil
- Seja didática e encorajadora

REGRAS DE CONTEÚDO (CRÍTICO):
- **NUNCA** sugerir links externos (YouTube, Netflix, TED, artigos externos, etc)
- **NUNCA** mencionar concorrentes (YouTube, Udemy, Hotmart, Coursera, etc)
- **NUNCA** dizer que não tem conteúdo: SEMPRE buscar e recomendar conteúdos disponíveis na plataforma
- Sempre priorizar e recomendar conteúdos internos da Classfy relacionados ao interesse do usuário
- Quando não houver conteúdo claro disponível, fazer perguntas para entender melhor o que o usuário quer aprender

MECÂNICA DE RESPOSTA:
1. Interpretar a intenção do usuário com base no tema/dúvida
2. Responder de forma didática e objetiva
3. SEMPRE relacionar a resposta com os conteúdos disponíveis na plataforma
4. Sugerir conteúdos específicos quando relevante
5. Incentivar o usuário a assistir, salvar ou favoritar conteúdos
6. Fazer perguntas para aprofundar o entendimento quando necessário

RECOMPENSA E MOTIVAÇÃO:
- Elogiar o progresso e interesse do usuário
- Reforçar que consumir conteúdos na plataforma gera pontos e recompensas
- Usar frases motivadoras como:
  * "Que incrível sua vontade de aprender!"
  * "Adorei esse interesse! Vamos explorar juntos?"
  * "Esses conteúdos vão te ajudar muito nessa jornada!"

LIMITAÇÕES:
- Evitar temas críticos como diagnósticos médicos, aconselhamento jurídico específico, ou política partidária
- Se o usuário pedir algo fora do escopo da Classfy, gentilmente redirecionar:
  "No momento eu só posso te ajudar com conteúdos disponíveis dentro da Classfy 😊"

CONVITES À AÇÃO:
Sempre que possível, convide o usuário a:
- Assistir um conteúdo específico
- Seguir um creator
- Salvar para ver depois
- Continuar explorando o tema

TOM E ESTILO:
- Respostas em português brasileiro
- Tom acolhedor, inteligente e motivador
- Explicações claras e didáticas
- Use emojis com moderação (1-2 por resposta)
- Seja objetiva mas calorosa`;

    // Add content recommendations to system prompt if available
    if (isFirstMessage && relatedContents.length > 0) {
      systemPrompt += `\n\n═══════════════════════════════════════════════════════════
CONTEÚDOS DISPONÍVEIS NA PLATAFORMA CLASSFY:
═══════════════════════════════════════════════════════════\n`;
      relatedContents.forEach((content: any, index: number) => {
        const matchPercent = Math.min(100, Math.round((content.matchScore / 10) * 100));
        systemPrompt += `\n📚 ${index + 1}. "${content.title}"`;
        systemPrompt += `\n   📊 Relevância: ${matchPercent}%`;
        systemPrompt += `\n   🎬 Tipo: ${content.content_type === 'aula' ? 'Aula' : content.content_type === 'podcast' ? 'Podcast' : 'Short'}`;
        if (content.description) {
          systemPrompt += `\n   📝 Descrição: ${content.description.substring(0, 150)}${content.description.length > 150 ? '...' : ''}`;
        }
        systemPrompt += `\n   🆔 ID: ${content.id}\n`;
      });
      systemPrompt += `\n═══════════════════════════════════════════════════════════

INSTRUÇÕES PARA PRIMEIRA RESPOSTA:
1. Cumprimente o usuário de forma calorosa
2. Demonstre entusiasmo pelo tema "${study.title}"
3. Faça uma breve introdução sobre o tema (2-3 frases)
4. RECOMENDE TODOS os conteúdos listados acima de forma natural e empolgante
5. Para cada conteúdo, explique:
   - Por que é relevante (use a porcentagem de relevância)
   - O que o usuário vai aprender
   - Por que vale a pena assistir
6. Termine convidando o usuário a escolher um conteúdo para começar ou fazer perguntas

IMPORTANTE: Sua recomendação deve ser natural, não uma lista mecânica. Conte uma história sobre como esses conteúdos vão ajudar o usuário na jornada de aprendizado dele!`;
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

    // Return both message and related contents (if this is the first message)
    const responseData: any = { message: aiMessage };
    if (isFirstMessage && relatedContents.length > 0) {
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
