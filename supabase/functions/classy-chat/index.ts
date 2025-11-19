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
    const { studyId, message, activeContentId, currentVideoTime, playlistSummary } = await req.json();

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

    // Fetch active content and transcription if available
    let activeContentData: any = null;
    let transcriptionText: string = "";
    
    if (activeContentId) {
      const { data: contentData } = await supabaseServiceClient
        .from("contents")
        .select("id, title, description, content_type, creator_id, profiles!contents_creator_id_fkey(display_name)")
        .eq("id", activeContentId)
        .single();
      
      if (contentData) {
        activeContentData = contentData;
        
        // Fetch transcription
        const { data: transcriptionData } = await supabaseServiceClient
          .from("transcriptions")
          .select("text")
          .eq("content_id", activeContentId)
          .single();
        
        if (transcriptionData) {
          transcriptionText = transcriptionData.text;
        }
      }
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

    // Search for related content ONLY if user is not asking about current content AND not a playlist summary
    const isAskingAboutCurrentContent = activeContentData && (
      message.toLowerCase().includes("vídeo") ||
      message.toLowerCase().includes("conteúdo") ||
      message.toLowerCase().includes("aula") ||
      message.toLowerCase().includes("que ela") ||
      message.toLowerCase().includes("que ele") ||
      message.toLowerCase().includes("o que") ||
      message.toLowerCase().includes("explica") ||
      message.toLowerCase().includes("sobre o que") ||
      message.toLowerCase().includes("do que se trata")
    );

    let relatedContents: any[] = [];
    
    // Only search for new content if NOT asking about current content AND NOT a playlist summary
    if ((!isAskingAboutCurrentContent || isFirstMessage) && !playlistSummary) {
      const searchQuery = isFirstMessage ? study.title.toLowerCase() : message.toLowerCase();
      
      const { data: contents } = await supabaseServiceClient
        .from("contents")
        .select("id, title, description, content_type, thumbnail_url, visibility, required_plan, is_free, duration_minutes, tags")
        .eq("status", "approved")
        .in("content_type", ["aula", "short", "podcast"])
        .limit(50);

      if (contents && contents.length > 0) {
        // Filter out the currently active content
        const availableContents = contents.filter((c: any) => 
          !activeContentId || c.id !== activeContentId
        );

        // Calculate match score for each content with improved algorithm
        relatedContents = availableContents
          .map((content: any) => {
            const titleLower = content.title.toLowerCase();
            const descLower = (content.description || "").toLowerCase();
            const contentTags = (content.tags || []).map((tag: string) => tag.toLowerCase());
            
            // Normalize search query - remove accents and special chars
            const normalizeText = (text: string) => {
              return text
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase();
            };
            
            const searchNormalized = normalizeText(searchQuery);
            const titleNormalized = normalizeText(titleLower);
            const descNormalized = normalizeText(descLower);
            const tagsNormalized = contentTags.map((tag: string) => normalizeText(tag));
            
            let score = 0;
            const searchWords = searchNormalized.split(" ").filter((w: string) => w.length >= 2);
            
            // Score each search word
            searchWords.forEach((word: string) => {
              // Title matches (highest priority)
              if (titleNormalized.includes(word)) score += 10;
              
              // Tags matches (very high priority - CRITICAL)
              tagsNormalized.forEach((tag: string) => {
                if (tag.includes(word) || word.includes(tag)) {
                  score += 15; // Tags are most important
                }
              });
              
              // Description matches
              if (descNormalized.includes(word)) score += 3;
            });

            // Exact phrase match bonuses
            if (titleNormalized.includes(searchNormalized)) score += 20;
            if (descNormalized.includes(searchNormalized)) score += 10;
            tagsNormalized.forEach((tag: string) => {
              if (tag === searchNormalized || tag.includes(searchNormalized)) {
                score += 30; // Exact tag match is critical
              }
            });
            
            // Common variations and synonyms for IA
            const iaVariations = ["ia", "inteligencia artificial", "artificial intelligence", "ai", "machine learning", "ml"];
            if (iaVariations.some(v => searchNormalized.includes(v))) {
              if (iaVariations.some(v => titleNormalized.includes(v))) score += 15;
              if (iaVariations.some(v => tagsNormalized.some((tag: string) => tag.includes(v)))) score += 25;
              if (iaVariations.some(v => descNormalized.includes(v))) score += 8;
            }
            
            return { ...content, matchScore: score };
          })
          .filter((c: any) => c.matchScore > 0)
          .sort((a: any, b: any) => b.matchScore - a.matchScore)
          .slice(0, 15);

        // Fallback: if nothing matches, still show alguns conteúdos relevantes (minimum 3 when available)
        if (relatedContents.length === 0 && !isAskingAboutCurrentContent) {
          const minimumResults = Math.min(availableContents.length, 3);
          relatedContents = availableContents
            .slice(0, Math.max(minimumResults, 10))
            .map((content: any) => ({ ...content, matchScore: 1 }));
        } else if (relatedContents.length > 0 && relatedContents.length < 3 && !isAskingAboutCurrentContent) {
          // If we have some matches but less than 3, add more to reach minimum of 3
          const needed = 3 - relatedContents.length;
          const additional = availableContents
            .filter((c: any) => !relatedContents.find((r: any) => r.id === c.id))
            .slice(0, needed)
            .map((content: any) => ({ ...content, matchScore: 1 }));
          relatedContents = [...relatedContents, ...additional];
        }
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Build intelligent system prompt based on context
    let systemPrompt = `📌 CLASSY — Tutora de IA Educacional da Classfy

IDENTIDADE E PERSONA:
Você é Classy, uma tutora de IA altamente inteligente e contextual da plataforma Classfy.
Seu objetivo: ENSINAR, não apenas recomendar. Você GUIA o aprendizado do usuário.

CONTEXTO DO ESTUDO:
- Tema do estudo: ${study?.title || "Sem título"}
- ${study?.description ? `Descrição: ${study.description}` : ""}
- Nome do usuário: ${userName}
${activeContentData ? `
CONTEÚDO ATIVO ATUAL:
- Título: ${activeContentData.title}
- Tipo: ${activeContentData.content_type}
- Criador: ${activeContentData.profiles?.display_name || "Desconhecido"}
- Descrição: ${activeContentData.description || "Sem descrição"}
${currentVideoTime ? `- Posição atual: ${Math.floor(currentVideoTime / 60)}min ${Math.floor(currentVideoTime % 60)}s` : ""}
` : ""}
${transcriptionText ? `
TRANSCRIÇÃO DO VÍDEO ATUAL:
${transcriptionText}

INSTRUÇÕES CRÍTICAS SOBRE TRANSCRIÇÃO:
- Use a transcrição para responder perguntas sobre o conteúdo
- Cite pontos específicos do vídeo quando relevante
- Explique conceitos mencionados no vídeo
- NÃO mostre a transcrição completa ao usuário
- **NUNCA NUNCA NUNCA recomende o mesmo vídeo que está sendo assistido**
` : ""}

COMPORTAMENTO OBRIGATÓRIO:

1. INTELIGÊNCIA CONTEXTUAL:
   ✓ Sempre considere o histórico da conversa
   ✓ Lembre-se de tudo que foi discutido
   ✓ Entenda o progresso do usuário no conteúdo
   ✓ Use o nome do usuário: ${userName}

2. QUANDO O USUÁRIO PERGUNTAR SOBRE O CONTEÚDO ATUAL:
   ✓ Analise a transcrição e responda baseado no conteúdo real
   ✓ Explique conceitos de forma didática
   ✓ Use exemplos práticos
   ✓ Cite pontos específicos do vídeo
   ✓ Verifique se o usuário entendeu
   ✗ NUNCA responda de forma genérica
   ✗ NUNCA recomende o mesmo vídeo como "resposta" à explicação sobre ele

3. PERGUNTAS PROATIVAS E PEDAGÓGICAS:
   - Após explicar algo: "Está claro até aqui, ${userName}?"
   - Ofereça resumos: "Quer que eu resuma os pontos principais?"
   - Sugira aplicação: "Como você aplicaria isso na prática?"
   - Verifique dúvidas: "Ficou alguma dúvida sobre [conceito]?"

4. QUANDO APRESENTAR MÚLTIPLOS CONTEÚDOS:
   - Faça um breve resumo destacando os ${relatedContents.length > 0 ? relatedContents.length : ''} conteúdos encontrados
   - Agrupe por relevância ou tema quando possível
   - Sugira uma ordem de estudo se fizer sentido
   - SEMPRE mencione a opção de "Salvar Playlist" quando houver 2 ou mais conteúdos
   - Exemplos:
     * "Encontrei ${relatedContents.length} conteúdos sobre [tema]! Use o botão 'Salvar Playlist' abaixo para organizar sua sequência de estudos."
     * "Separei ${relatedContents.length} aulas para você. Você pode salvar como playlist ou assistir na ordem que preferir!"

5. QUANDO NÃO HOUVER CONTEÚDO ATIVO:
   - Ajude o usuário a encontrar conteúdos relevantes
   - Pergunte sobre interesses específicos
   - Seja guia na jornada de aprendizado

6. RESPOSTAS INTELIGENTES:
   ✓ Seja didática e explicativa quando necessário
   ✓ Use o contexto do vídeo para explicações
   ✓ Adapte o nível de complexidade ao usuário
   ✓ Demonstre que você "assistiu" e entendeu o conteúdo
   ✗ Não seja evasiva ou genérica
   ✗ Não finja que sabe algo que não está na transcrição

7. TOM E ESTILO:
   - Acolhedora mas profissional
   - Didática sem ser condescendente
   - Motivadora sem ser excessiva
   - Use emojis com moderação (1-2 por mensagem)

REGRAS PROIBIDAS:
❌ NUNCA recomende o mesmo vídeo que está sendo assistido
❌ NUNCA ignore perguntas diretas sobre o conteúdo
❌ NUNCA responda de forma genérica quando há transcrição disponível
❌ NUNCA mencione plataformas concorrentes (YouTube, Udemy, etc)
❌ NUNCA sugira links externos

FOCO: Transformar consumo de conteúdo em APRENDIZADO REAL`;

    // Special handling for playlist summary
    if (playlistSummary) {
      systemPrompt += `\n\n🎯 TAREFA ESPECIAL: RESUMO DE PLAYLIST

O usuário acabou de SALVAR UMA PLAYLIST com múltiplos conteúdos.
Sua tarefa: Analisar os conteúdos fornecidos e gerar um resumo contextualizado.

INSTRUÇÕES:
✓ Analise os títulos, descrições e transcrições fornecidas
✓ Identifique os temas principais que serão abordados
✓ Explique o que o usuário pode aprender com essa sequência
✓ Seja específico e mencione os principais tópicos que serão cobertos
✓ Use um tom encorajador e motivador
✓ Mantenha o resumo entre 3-5 linhas
✗ NUNCA liste os títulos individualmente
✗ NUNCA recomende novos conteúdos

FORMATO DA RESPOSTA:
"[Nome], playlist está salva e pronta pra você assistir em forma de trilha. Com esse material você pode aprender [principais tópicos e habilidades]. Se precisar de algo é só avisar."`;
    }

    // Add instructions based on context
    if (isAskingAboutCurrentContent && activeContentData) {
      systemPrompt += `\n\n🎯 SITUAÇÃO ATUAL:
O usuário está perguntando sobre o conteúdo que ESTÁ ASSISTINDO agora.

INSTRUÇÕES OBRIGATÓRIAS:
✓ Use a transcrição para responder com precisão
✓ Explique de forma didática o que está sendo falado no vídeo
✓ Cite pontos específicos do conteúdo
✓ Demonstre que você entendeu o material
✓ Verifique se o usuário entendeu
✗ NUNCA recomende o mesmo vídeo que ele está assistindo
✗ NUNCA responda de forma genérica ou evasiva
✗ NUNCA ignore a pergunta dele`;
    } else if (relatedContents.length > 0) {
      systemPrompt += `\n\n═══════════════════════════════════════════════════════════
CONTEÚDOS ENCONTRADOS:
Você encontrou ${relatedContents.length} conteúdo(s) relevante(s) DIFERENTES do atual.
Eles serão exibidos AUTOMATICAMENTE como CARDS DE VÍDEO.
═══════════════════════════════════════════════════════════

INSTRUÇÕES:
${isFirstMessage ? 
`- Apresente-se: "Olá ${userName}! Sou a Classy, sua tutora de IA aqui na Classfy 😊"
- Diga: "Veja o que separei para você começar:"` 
: 
`- Responda a pergunta do usuário PRIMEIRO (se houver)
- Depois mencione: "Também separei outros conteúdos que podem te interessar:"`
}
- **NUNCA liste os títulos dos conteúdos**
- Os cards aparecem AUTOMATICAMENTE`;
    } else if (isFirstMessage) {
      systemPrompt += `\n\n🎯 PRIMEIRA INTERAÇÃO:
- Apresente-se: "Olá ${userName}! Sou a Classy, sua tutora de IA aqui na Classfy 😊"
- Pergunte: "O que você gostaria de aprender sobre ${study.title}?"
- Seja acolhedora e motivadora`;
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

    // Return both message and related contents (including matchScore for debugging)
    const responseData: any = { message: aiMessage };
    if (relatedContents.length > 0) {
      responseData.relatedContents = relatedContents.map((c: any) => ({
        ...c,
        matchScore: c.matchScore // Keep score for debugging/logging
      }));
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
