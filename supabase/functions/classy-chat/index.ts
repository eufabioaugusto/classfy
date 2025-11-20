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

        // PHASE 1: Keyword matching with semantic expansion
        const candidateContents = availableContents
          .map((content: any) => {
            const titleLower = content.title.toLowerCase();
            const descLower = (content.description || "").toLowerCase();
            const contentTags = (content.tags || []).map((tag: string) => tag.toLowerCase());
            
            // Normalize helper - remove accents and special chars
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
            
            // Remove apenas palavras muito genéricas (stopwords reduzidas)
            const stopwords = [
              "o","a","os","as","um","uma","de","da","do","das","dos",
              "em","no","na","nos","nas","por","para","com","e","ou","que"
            ];
            
            const searchWords = searchNormalized
              .split(/\s+/)
              .map((w: string) => w.trim().replace(/[!?,;.]/g, ""))
              .filter((w: string) => w.length >= 3 && !stopwords.includes(w));
            
            console.log(`[SEARCH] Query: "${searchQuery}" -> Words: [${searchWords.join(", ")}]`);
            console.log(`[CONTENT] "${content.title}" - Tags: [${contentTags.join(", ")}]`);
            
            // Semantic expansions - termos relacionados
            const semanticMap: Record<string, string[]> = {
              "deus": ["divino", "divina", "espiritual", "fe", "sagrado", "sagrada", "religiao", "crenca"],
              "divino": ["deus", "espiritual", "sagrado", "celeste"],
              "espiritual": ["deus", "divino", "alma", "espirito", "fe"],
              "ia": ["inteligencia artificial", "machine learning", "aprendizado maquina", "ai", "artificial"],
              "inteligencia": ["ia", "artificial", "machine learning", "ai"],
              "programacao": ["codigo", "programar", "desenvolvimento", "dev", "software"],
              "codigo": ["programacao", "programar", "desenvolvimento", "software"],
            };
            
            // Expand search words with related terms
            const expandedWords = new Set(searchWords);
            searchWords.forEach((word: string) => {
              const related = semanticMap[word];
              if (related) {
                related.forEach((r: string) => expandedWords.add(r));
              }
            });
            
            // Score each search word and related terms
            expandedWords.forEach((word: string) => {
              const isOriginal = searchWords.includes(word);
              const weightMultiplier = isOriginal ? 1 : 0.5; // Related terms get 50% weight
              
              // Title matches (highest priority)
              if (titleNormalized.includes(word)) {
                score += Math.floor(15 * weightMultiplier);
                console.log(`  ✓ Title match: "${word}" +${Math.floor(15 * weightMultiplier)}`);
              }
              
              // Tags matches (very high priority)
              tagsNormalized.forEach((tag: string) => {
                if (tag.includes(word) || word.includes(tag)) {
                  score += Math.floor(20 * weightMultiplier);
                  console.log(`  ✓ Tag match: "${word}" in "${tag}" +${Math.floor(20 * weightMultiplier)}`);
                }
              });
              
              // Description matches (medium priority)
              if (descNormalized.includes(word)) {
                score += Math.floor(8 * weightMultiplier);
                console.log(`  ✓ Description match: "${word}" +${Math.floor(8 * weightMultiplier)}`);
              }
            });

            // Exact phrase match bonuses
            if (titleNormalized.includes(searchNormalized)) {
              score += 30;
              console.log(`  ✓ Exact title phrase match +30`);
            }
            if (descNormalized.includes(searchNormalized)) {
              score += 15;
              console.log(`  ✓ Exact description phrase match +15`);
            }
            tagsNormalized.forEach((tag: string) => {
              if (tag === searchNormalized || tag.includes(searchNormalized)) {
                score += 40;
                console.log(`  ✓ Exact tag match "${tag}" +40`);
              }
            });
            
            console.log(`  → Total keywordScore: ${score}`);
            return { ...content, keywordScore: score };
          })
          .filter((c: any) => c.keywordScore > 0)
          .sort((a: any, b: any) => b.keywordScore - a.keywordScore)
          .slice(0, 25); // Top 25 candidates for semantic analysis

        // PHASE 2: Semantic relevance with AI (only if we have candidates)
        if (candidateContents.length > 0) {
          const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
          
          // Build batch semantic analysis prompt
          const contentsForAnalysis = candidateContents.map((c: any, idx: number) => ({
            index: idx,
            id: c.id,
            title: c.title,
            description: c.description || "",
            tags: (c.tags || []).join(", ")
          }));

          const semanticPrompt = `Você é um especialista em análise de relevância de conteúdo educacional.

QUERY DO USUÁRIO: "${message}"

Analise a relevância de cada conteúdo abaixo para essa query. Para cada um, retorne um score de 0 a 100 baseado em:
- Alinhamento temático (o conteúdo realmente é sobre o que o usuário procura?)
- Relevância semântica (os conceitos são relacionados?)
- Adequação ao nível de conhecimento implícito na query

CONTEÚDOS:
${contentsForAnalysis.map(c => `[${c.index}] "${c.title}" - ${c.description} (Tags: ${c.tags})`).join('\n')}

Responda APENAS com um JSON array de objetos no formato: [{"index": 0, "score": 85}, {"index": 1, "score": 42}, ...]`;

          try {
            const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  { role: "system", content: "You are a semantic relevance analyzer. Respond only with valid JSON." },
                  { role: "user", content: semanticPrompt }
                ],
              }),
            });

            if (aiResponse.ok) {
              const aiData = await aiResponse.json();
              const aiContent = aiData.choices?.[0]?.message?.content || "[]";
              
              // Try to parse AI response
              try {
                // Extract JSON from response (handle markdown code blocks)
                let jsonText = aiContent.trim();
                if (jsonText.startsWith('```json')) {
                  jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                } else if (jsonText.startsWith('```')) {
                  jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
                }
                
                const semanticScores = JSON.parse(jsonText);
                
                // Merge semantic scores with candidates
                candidateContents.forEach((content: any) => {
                  const scoreData = semanticScores.find((s: any) => 
                    s.index === contentsForAnalysis.findIndex(c => c.id === content.id)
                  );
                  content.semanticScore = scoreData?.score || 0;
                  // Final score: 60% semantic, 40% keyword
                  content.matchScore = Math.floor((content.semanticScore * 0.6) + (content.keywordScore * 0.4));
                });

                console.log('Semantic analysis completed:', candidateContents.map(c => ({
                  title: c.title,
                  keywordScore: c.keywordScore,
                  semanticScore: c.semanticScore,
                  finalScore: c.matchScore
                })));
              } catch (parseError) {
                console.error('Failed to parse AI semantic scores:', parseError, 'Response:', aiContent);
                // Fallback to keyword scores only
                candidateContents.forEach((c: any) => {
                  c.semanticScore = 0;
                  c.matchScore = c.keywordScore;
                });
              }
            } else {
              console.error('AI semantic analysis failed:', aiResponse.status);
              // Fallback to keyword scores only
              candidateContents.forEach((c: any) => {
                c.semanticScore = 0;
                c.matchScore = c.keywordScore;
              });
            }
          } catch (aiError) {
            console.error('Error calling AI for semantic analysis:', aiError);
            // Fallback to keyword scores only
            candidateContents.forEach((c: any) => {
              c.semanticScore = 0;
              c.matchScore = c.keywordScore;
            });
          }

          // Final ranking with lower threshold
          relatedContents = candidateContents
            .filter((c: any) => c.matchScore >= 5) // Lowered from 10 to capture more relevant content
            .sort((a: any, b: any) => b.matchScore - a.matchScore)
            .slice(0, 15);
        } else {
          relatedContents = [];
        }

        // Only show content if it's actually relevant - no random fallbacks
        console.log(`Found ${relatedContents.length} contents for query: "${searchQuery}"`);
        if (relatedContents.length > 0) {
          console.log('Top matches:', relatedContents.slice(0, 3).map((c: any) => ({ 
            title: c.title, 
            keywordScore: c.keywordScore || 0,
            semanticScore: c.semanticScore || 0,
            finalScore: c.matchScore 
          })));
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
    } else {
      systemPrompt += `\n\n🚫 NENHUM CONTEÚDO RELEVANTE ENCONTRADO:
Você NÃO encontrou conteúdos na plataforma relacionados à pergunta do usuário.

INSTRUÇÕES OBRIGATÓRIAS:
✓ Responda a pergunta do usuário da melhor forma possível com seu conhecimento
✓ Seja HONESTA: "No momento, não temos conteúdos específicos sobre ${message} na plataforma."
✓ Sugira temas relacionados disponíveis: "Posso te ajudar com [temas disponíveis relacionados]?"
✓ Mantenha o tom educacional e útil
✗ NUNCA invente que existem conteúdos quando não existem
✗ NUNCA mostre cards de vídeos vazios ou aleatórios`;
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

    // Generate intelligent title after first interaction
    if (isFirstMessage && aiMessage) {
      try {
        // Generate a smart title based on the conversation context
        const titlePrompt = `Baseado nesta primeira interação de um estudo educacional:

Usuário perguntou: "${message}"
Assistente respondeu: "${aiMessage.substring(0, 500)}"

Gere um título curto, claro e descritivo (máximo 50 caracteres) que capture a essência do que o usuário quer aprender. 
O título deve ser objetivo e profissional, sem usar aspas ou pontos finais.

Exemplos de bons títulos:
- "Fundamentos de Espiritualidade"
- "Introdução à Inteligência Artificial"
- "Marketing Digital para Iniciantes"
- "Filosofia Oriental e Meditação"

Responda APENAS com o título, sem explicações adicionais.`;

        const titleResponse = await fetch(
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
                { role: "user", content: titlePrompt }
              ],
              temperature: 0.7,
            }),
          }
        );

        if (titleResponse.ok) {
          const titleData = await titleResponse.json();
          const generatedTitle = titleData.choices?.[0]?.message?.content?.trim();
          
          if (generatedTitle && generatedTitle.length > 0 && generatedTitle.length <= 100) {
            // Update study title in background (don't wait for it)
            supabaseServiceClient
              .from("studies")
              .update({ title: generatedTitle })
              .eq("id", studyId)
              .then(({ error: updateError }) => {
                if (updateError) {
                  console.error("Error updating study title:", updateError);
                } else {
                  console.log("Study title updated successfully:", generatedTitle);
                }
              });
          }
        }
      } catch (titleError) {
        // Log error but don't fail the main request
        console.error("Error generating study title:", titleError);
      }
    }

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
