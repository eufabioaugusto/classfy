import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Plan limits for messages (user messages only) and topic deviations
const PLAN_LIMITS = {
  free: { maxMessages: 5, maxDeviations: 3 },
  pro: { maxMessages: 30, maxDeviations: 20 },
  premium: { maxMessages: 999999, maxDeviations: 999999 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { studyId, message, activeContentId, currentVideoTime, playlistSummary } = await req.json();

    // Get authenticated user from JWT
    const authHeader = req.headers.get('authorization');
    
    console.log('[CLASSY-CHAT] Auth header present:', !!authHeader);
    
    if (!authHeader) {
      console.error('[CLASSY-CHAT] No authorization header');
      return new Response(
        JSON.stringify({ error: 'Não autorizado - sem header de autorização' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('[CLASSY-CHAT] Token extracted, length:', token.length);
    
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    console.log('[CLASSY-CHAT] Validating user token...');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError) {
      console.error('[CLASSY-CHAT] Auth error:', userError.message, userError.status);
      return new Response(
        JSON.stringify({ 
          error: 'Não autorizado - token inválido',
          details: userError.message 
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    if (!user) {
      console.error('[CLASSY-CHAT] No user found from token');
      return new Response(
        JSON.stringify({ error: 'Não autorizado - usuário não encontrado' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('[CLASSY-CHAT] User authenticated:', user.id);

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

    // Fetch user profile for personalization and plan
    const { data: profile } = await supabaseServiceClient
      .from("profiles")
      .select("display_name, plan")
      .eq("id", user.id)
      .single();

    const userName = profile?.display_name?.split(' ')[0] || 'você';
    const userPlan = (profile?.plan || 'free') as keyof typeof PLAN_LIMITS;
    const limits = PLAN_LIMITS[userPlan];

    // ===== CHECK MESSAGE LIMIT =====
    const currentMessageCount = study.message_count || 0;
    const currentDeviations = study.topic_deviations_count || 0;
    
    console.log(`[CLASSY-CHAT] Message count: ${currentMessageCount}/${limits.maxMessages}, Deviations: ${currentDeviations}/${limits.maxDeviations}`);

    // Check if message limit reached
    if (currentMessageCount >= limits.maxMessages) {
      console.log('[CLASSY-CHAT] Message limit reached!');
      return new Response(
        JSON.stringify({ 
          error: 'MESSAGE_LIMIT_REACHED',
          message: `${userName}, você atingiu o limite de ${limits.maxMessages} mensagens neste estudo! 📚\n\nPara continuar aprendendo, você pode:\n• Arquivar este estudo e criar um novo\n• Fazer upgrade do seu plano para mais mensagens`,
          limitReached: true,
          limitType: 'messages',
          current: currentMessageCount,
          max: limits.maxMessages,
          plan: userPlan
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

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

    // ===== CHECK TOPIC DEVIATION (only after first few messages) =====
    let isOffTopic = false;
    let deviationWarning = "";
    
    if (!isFirstMessage && currentMessageCount >= 3 && !playlistSummary && study.main_topic) {
      // Use AI to check if message is on-topic
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      
      const topicCheckPrompt = `Você é um classificador de relevância de mensagens educacionais.

TEMA PRINCIPAL DO ESTUDO: "${study.main_topic || study.title}"

MENSAGEM DO USUÁRIO: "${message}"

TAREFA: Determine se a mensagem do usuário está RELACIONADA ao tema principal do estudo.

CRITÉRIOS:
- ON_TOPIC: A mensagem pergunta ou discute algo relacionado ao tema (mesmo que tangencialmente)
- OFF_TOPIC: A mensagem é sobre um tema COMPLETAMENTE diferente (ex: tema é "marketing", pergunta sobre "meditação")

Considere ON_TOPIC:
- Perguntas sobre o conteúdo atual
- Pedidos de explicação ou exemplos
- Temas relacionados ou complementares
- Dúvidas gerais sobre aprendizado no tema

Considere OFF_TOPIC APENAS se:
- For um tema totalmente desconectado
- Não tem nenhuma relação com o assunto principal

RESPONDA APENAS: "ON_TOPIC" ou "OFF_TOPIC"`;

      try {
        const topicResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [{ role: "user", content: topicCheckPrompt }],
            temperature: 0.1,
          }),
        });

        if (topicResponse.ok) {
          const topicData = await topicResponse.json();
          const result = topicData.choices?.[0]?.message?.content?.trim().toUpperCase() || "";
          
          isOffTopic = result.includes("OFF_TOPIC");
          console.log(`[CLASSY-CHAT] Topic check result: ${result}, isOffTopic: ${isOffTopic}`);

          if (isOffTopic) {
            // Increment deviation count
            const newDeviationCount = currentDeviations + 1;
            
            await supabaseServiceClient
              .from("studies")
              .update({ topic_deviations_count: newDeviationCount })
              .eq("id", studyId);

            console.log(`[CLASSY-CHAT] Deviation count incremented to: ${newDeviationCount}`);

            // Check if deviation limit reached
            if (newDeviationCount >= limits.maxDeviations) {
              return new Response(
                JSON.stringify({ 
                  error: 'DEVIATION_LIMIT_REACHED',
                  message: `${userName}, parece que você está explorando um tema diferente de "${study.main_topic || study.title}"! 🎯\n\nEste estudo atingiu o limite de temas. Para organizar melhor seu aprendizado:\n• Crie um novo estudo para este tema\n• Ou faça upgrade para mais flexibilidade`,
                  limitReached: true,
                  limitType: 'deviations',
                  current: newDeviationCount,
                  max: limits.maxDeviations,
                  plan: userPlan,
                  suggestedTopic: message.substring(0, 50)
                }),
                {
                  status: 200,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
              );
            }

            // Prepare warning for the AI response
            const remainingDeviations = limits.maxDeviations - newDeviationCount;
            deviationWarning = `\n\n🎯 **Sugestão:** Esse tema parece diferente de "${study.main_topic || study.title}". Que tal criar um estudo separado? Você ainda tem ${remainingDeviations} desvio(s) disponível(is) neste estudo.`;
          }
        }
      } catch (topicError) {
        console.error('[CLASSY-CHAT] Topic check error:', topicError);
        // Continue without blocking
      }
    }

    // ===== SET MAIN TOPIC ON FIRST MESSAGE =====
    if (isFirstMessage && !study.main_topic) {
      // Extract main topic from the first message/title
      const mainTopic = study.title || message.substring(0, 100);
      await supabaseServiceClient
        .from("studies")
        .update({ main_topic: mainTopic })
        .eq("id", studyId);
      
      console.log(`[CLASSY-CHAT] Set main_topic to: ${mainTopic}`);
    }

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
      
      console.log(`\n========== CLASSY SEARCH: "${searchQuery}" ==========`);

      // Fetch all approved contents with transcriptions
      const { data: contents } = await supabaseServiceClient
        .from("contents")
        .select(`
          id, title, description, content_type, thumbnail_url, 
          visibility, required_plan, is_free, duration_minutes, tags,
          transcriptions (text)
        `)
        .eq("status", "approved")
        .in("content_type", ["aula", "short", "podcast"])
        .limit(100);

      // Fetch approved courses
      const { data: courses } = await supabaseServiceClient
        .from("courses")
        .select(`
          id, title, description, thumbnail_url, 
          visibility, tags, total_lessons, total_duration_seconds
        `)
        .eq("status", "approved")
        .limit(50);

      // Combine contents and courses for searching
      const allItems = [
        ...(contents || []).map((c: any) => ({ ...c, itemType: 'content' })),
        ...(courses || []).map((c: any) => ({ ...c, itemType: 'course', content_type: 'curso' }))
      ];

      if (allItems.length > 0) {
        const availableItems = allItems.filter((item: any) => 
          !activeContentId || item.id !== activeContentId
        );

        console.log(`Total de itens disponíveis: ${availableItems.length} (${contents?.length || 0} conteúdos + ${courses?.length || 0} cursos)`);

        // ===== PHASE 1: DIRECT KEYWORD MATCHING (No AI, No Cost) =====
        console.log('\n🔍 PHASE 1: Análise de relevância aprimorada...');

        const normalizeText = (text: string) => text
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        const queryNorm = normalizeText(searchQuery);
        const stopwords = ['o', 'a', 'de', 'da', 'do', 'em', 'no', 'na', 'por', 'para', 'com', 'quero', 'quer', 'aprender', 'sobre', 'como', 'que', 'um', 'uma', 'os', 'as', 'e', 'ou', 'mas', 'se', 'qual', 'quais', 'isso', 'esse', 'essa', 'este', 'esta', 'aqui', 'ali', 'la', 'muito', 'bem', 'mais', 'menos', 'agora', 'hoje', 'me', 'meu', 'minha', 'seu', 'sua', 'voce', 'eu', 'nos'];
        
        // Extract meaningful keywords (min 3 chars, not stopwords)
        const keywords = queryNorm
          .split(/\s+/)
          .map((w: string) => w.replace(/[!?,;.]/g, ""))
          .filter((w: string) => w.length >= 3 && !stopwords.includes(w));

        console.log(`Keywords extraídas: [${keywords.join(', ')}]`);

        // Calculate relevance score (0-100%)
        const calculateRelevance = (item: any): { score: number; matches: string[] } => {
          const titleNorm = normalizeText(item.title);
          const descNorm = normalizeText(item.description || "");
          const tagsNorm = (item.tags || []).map((t: string) => normalizeText(t));
          const transcriptionNorm = item.transcriptions?.[0]?.text 
            ? normalizeText(item.transcriptions[0].text.substring(0, 2000)) 
            : "";

          let baseScore = 0;
          const matches: string[] = [];
          
          // 1. EXACT PHRASE MATCH (highest priority) - up to 50 points
          if (titleNorm.includes(queryNorm) && queryNorm.length > 5) {
            baseScore += 50;
            matches.push('exact_phrase_title');
          } else if (descNorm.includes(queryNorm) && queryNorm.length > 5) {
            baseScore += 35;
            matches.push('exact_phrase_desc');
          }

          // 2. KEYWORD MATCHING - remaining 50 points distributed across keywords
          if (keywords.length > 0) {
            const pointsPerKeyword = 50 / keywords.length;
            
            keywords.forEach((keyword: string) => {
              let keywordMatched = false;
              
              // Title match (full points for keyword)
              if (titleNorm.includes(keyword)) {
                baseScore += pointsPerKeyword;
                matches.push(`title:${keyword}`);
                keywordMatched = true;
              }
              // Description match (70% of points)
              else if (descNorm.includes(keyword)) {
                baseScore += pointsPerKeyword * 0.7;
                matches.push(`desc:${keyword}`);
                keywordMatched = true;
              }
              // Tag match (full points)
              else if (tagsNorm.some((tag: string) => tag.includes(keyword) || keyword.includes(tag))) {
                baseScore += pointsPerKeyword;
                matches.push(`tag:${keyword}`);
                keywordMatched = true;
              }
              // Transcription match (40% of points - less reliable)
              else if (transcriptionNorm && transcriptionNorm.includes(keyword)) {
                baseScore += pointsPerKeyword * 0.4;
                matches.push(`transcription:${keyword}`);
                keywordMatched = true;
              }
            });
          }

          // Ensure score is between 0 and 100
          const finalScore = Math.min(100, Math.round(baseScore));
          
          return { score: finalScore, matches };
        };

        // Calculate relevance for all items
        const scoredItems = availableItems.map((item: any) => {
          const { score, matches } = calculateRelevance(item);
          return { ...item, relevanceScore: score, matches };
        });

        // Log top matches for debugging
        const topMatches = scoredItems
          .filter((c: any) => c.relevanceScore > 0)
          .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore)
          .slice(0, 10);
        
        console.log(`\n📊 Top 10 matches antes do filtro:`);
        topMatches.forEach((c: any) => {
          console.log(`  ${c.relevanceScore}% - "${c.title}" | ${c.matches.join(', ')}`);
        });

        // Filter only items with >= 50% relevance
        const MIN_RELEVANCE = 50;
        const directMatches = scoredItems
          .filter((c: any) => c.relevanceScore >= MIN_RELEVANCE)
          .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore);

        console.log(`\n✅ PHASE 1: ${directMatches.length} matches com relevância >= ${MIN_RELEVANCE}%`);

        // If we have enough direct matches, use them
        if (directMatches.length >= 2) {
          relatedContents = directMatches.slice(0, 10);
          console.log(`✓ Usando ${relatedContents.length} matches diretos`);
        } else {
          // ===== PHASE 2: AI SEMANTIC ANALYSIS (Only if needed) =====
          console.log(`\n🤖 PHASE 2: Poucos matches (${directMatches.length}). Ativando análise semântica com IA...`);

          const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
          
          // Get top 15 candidates (even with low scores) for AI analysis
          const topCandidates = scoredItems
            .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore)
            .slice(0, 15);

          console.log(`Analisando ${topCandidates.length} candidatos com IA...`);

          const semanticPrompt = `Você é um analisador de relevância para conteúdos educacionais.

TEMA BUSCADO: "${searchQuery}"

CONTEÚDOS A ANALISAR:
${topCandidates.map((c: any, i: number) => `
${i + 1}. "${c.title}" [${c.itemType === 'course' ? 'CURSO' : c.content_type?.toUpperCase() || 'CONTEÚDO'}]
   Descrição: ${(c.description || 'Sem descrição').substring(0, 150)}
   Tags: ${(c.tags || []).join(', ') || 'Sem tags'}
`).join('')}

TAREFA: Para cada conteúdo, avalie sua RELEVÂNCIA REAL para o tema buscado.

CRITÉRIOS:
- 100% = Totalmente sobre o tema (ex: busca "marketing digital" → "Curso de Marketing Digital")
- 75% = Muito relacionado (ex: busca "marketing digital" → "SEO para E-commerce")  
- 50% = Relacionado mas não central (ex: busca "marketing digital" → "Criação de Conteúdo")
- 0% = Não relacionado (ex: busca "marketing digital" → "Meditação", "Mindfulness")

RESPONDA APENAS no formato JSON:
{"results": [{"index": 1, "relevance": 85}, {"index": 3, "relevance": 70}]}

Inclua APENAS os itens com relevância >= 50%.`;

          try {
            const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [{ role: "user", content: semanticPrompt }],
                temperature: 0.1,
              }),
            });

            if (!aiResponse.ok) {
              console.error('❌ IA falhou:', await aiResponse.text());
              relatedContents = directMatches.slice(0, 10);
            } else {
              const aiData = await aiResponse.json();
              const aiResult = aiData.choices[0]?.message?.content?.trim() || "";
              console.log(`IA respondeu: ${aiResult}`);

              try {
                // Parse JSON response
                const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const parsed = JSON.parse(jsonMatch[0]);
                  const results = parsed.results || [];
                  
                  const semanticMatches = results
                    .filter((r: any) => r.relevance >= 50)
                    .map((r: any) => {
                      const idx = r.index - 1;
                      if (idx >= 0 && idx < topCandidates.length) {
                        return {
                          ...topCandidates[idx],
                          relevanceScore: r.relevance,
                          semanticMatch: true,
                        };
                      }
                      return null;
                    })
                    .filter((x: any) => x !== null);

                  console.log(`✅ IA encontrou ${semanticMatches.length} matches semânticos`);

                  // Combine direct + semantic, remove duplicates, sort by score
                  const combined = [...directMatches, ...semanticMatches];
                  const unique = Array.from(new Map(combined.map((c: any) => [c.id, c])).values());
                  
                  relatedContents = unique
                    .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore)
                    .slice(0, 10);
                } else {
                  console.log('Resposta IA não é JSON válido, usando matches diretos');
                  relatedContents = directMatches.slice(0, 10);
                }
              } catch (parseError) {
                console.error('Erro ao parsear resposta IA:', parseError);
                relatedContents = directMatches.slice(0, 10);
              }
            }
          } catch (aiError) {
            console.error('❌ Erro na IA:', aiError);
            relatedContents = directMatches.slice(0, 10);
          }
        }

        console.log(`\n🎯 RESULTADO FINAL: ${relatedContents.length} conteúdos com relevância >= 50%`);
        if (relatedContents.length > 0) {
          console.log('Selecionados:', relatedContents.map((c: any) => ({
            title: c.title,
            relevance: `${c.relevanceScore}%`,
            semantic: c.semanticMatch || false
          })));
        }
        console.log('========================================\n');
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Build intelligent system prompt based on context
    let systemPrompt = `# CLASSY — Sistema de Tutoria IA Avançada 🎓

## IDENTIDADE PRINCIPAL
Você é **Classy**, uma tutora de IA de última geração criada especificamente para a Classfy. Você possui:
- Inteligência contextual profunda e memória conversacional
- Capacidade de raciocínio multi-step e análise pedagógica avançada
- Expertise educacional adaptativa baseada no perfil do estudante
- Empatia computacional para engajamento emocional autêntico

**MISSÃO CORE**: Transformar consumo passivo de conteúdo em aprendizado ativo, profundo e mensurável.

## CONTEXTO DA SESSÃO ATUAL

### Perfil do Estudante
- **Nome**: ${userName}
- **Plano**: ${userPlan} ${userPlan === 'free' ? '(básico)' : userPlan === 'pro' ? '(avançado)' : '(premium completo)'}
- **Progresso da sessão**: ${currentMessageCount + 1}/${limits.maxMessages} mensagens
${profile?.interests ? `- **Interesses conhecidos**: ${profile.interests}` : ''}

### Tema de Estudo
- **Título**: ${study?.title || "Novo estudo iniciado"}
- **Tema principal**: ${study?.main_topic || study?.title || "Ainda definindo foco"}
- **Descrição**: ${study?.description || "Aguardando direcionamento do estudante"}

${activeContentData ? `### Conteúdo em Foco
- **📹 Título**: ${activeContentData.title}
- **🎬 Tipo**: ${activeContentData.content_type.toUpperCase()}
- **👤 Criador**: ${activeContentData.profiles?.display_name || "Desconhecido"}
- **📝 Descrição**: ${activeContentData.description || "Sem descrição disponível"}
${currentVideoTime ? `- **⏱️ Timestamp atual**: ${Math.floor(currentVideoTime / 60)}:${String(Math.floor(currentVideoTime % 60)).padStart(2, '0')}` : ''}
` : ''}

${transcriptionText ? `### Base de Conhecimento do Vídeo
\`\`\`transcript
${transcriptionText.substring(0, 8000)}${transcriptionText.length > 8000 ? '...[transcrição truncada]' : ''}
\`\`\`

**PROTOCOLO DE USO DA TRANSCRIÇÃO**:
1. Extraia conceitos-chave e estruture mentalmente a taxonomia do conhecimento
2. Identifique momentos-chave (timestamps implícitos) para referências precisas
3. Detecte lacunas de conhecimento que precisam ser explicadas
4. Encontre oportunidades para perguntas socráticas
5. **CRÍTICO**: NUNCA recomende o mesmo vídeo que está sendo estudado
6. **CRÍTICO**: Cite evidências diretas da transcrição ao responder dúvidas
` : ''}

## PROTOCOLOS DE OPERAÇÃO

### 1. RACIOCÍNIO MULTI-STEP (Chain-of-Thought)
Antes de responder perguntas complexas, estruture seu raciocínio:
<thinking>
1. Análise da pergunta: O que o estudante realmente quer saber?
2. Contexto relevante: Que informações da transcrição/histórico são pertinentes?
3. Nível de conhecimento inferido: Iniciante/Intermediário/Avançado?
4. Estratégia pedagógica: Explicação direta, analogia, exemplo prático?
5. Validação: Como verificar se o estudante compreendeu?
</thinking>

### 2. PERSONALIZAÇÃO ADAPTATIVA
- **Para plano free**: Seja encorajadora sobre upgrade quando relevante, mas sempre útil
- **Para iniciantes**: Use analogias, exemplos do dia-a-dia, linguagem simples
- **Para avançados**: Aprofunde conceitos, faça conexões interdisciplinares, desafie com perguntas
- **Tom**: Amigável mas respeitosa, motivadora mas realista, didática mas não condescendente

### 3. ENGAJAMENTO PEDAGÓGICO ATIVO
Após cada explicação complexa, escolha UMA técnica:
- ✅ **Verificação socrática**: "Como você explicaria [conceito] com suas próprias palavras?"
- ✅ **Aplicação prática**: "Em que situação real você usaria esse conhecimento?"
- ✅ **Conexão de conceitos**: "Como isso se relaciona com [tema anterior]?"
- ✅ **Clarificação**: "Ficou claro ou quer que eu explique de outra forma?"

### 4. QUANDO HOUVER CONTEÚDOS RELACIONADOS
${relatedContents.length > 0 ? `
**STATUS**: ✅ ${relatedContents.length} conteúdo(s) relevante(s) identificado(s)

**APRESENTAÇÃO OBRIGATÓRIA**:
1. Responda PRIMEIRO a qualquer dúvida direta do usuário
2. Apresente os conteúdos contextualizando com a jornada de aprendizado:
   - Agrupe por tema/dificuldade se aplicável
   - Sugira ordem estratégica de estudo quando relevante
   - Explique BREVEMENTE por que cada grupo é relevante
3. Mencione claramente: "Você pode salvar esses ${relatedContents.length} conteúdos como playlist para estudar em sequência!"
4. **NUNCA liste os títulos manualmente** - os cards aparecem automaticamente

**EXEMPLO DE BOA APRESENTAÇÃO**:
"${userName}, encontrei ${relatedContents.length} conteúdos que vão te ajudar com [objetivo]. Separei por [critério]: primeiro os fundamentos, depois aplicações práticas. Você pode salvar como playlist para uma jornada estruturada!"
` : `
**STATUS**: ⚠️ Nenhum conteúdo relevante na plataforma para essa busca

**PROTOCOLO DE RESPOSTA**:
1. Responda a pergunta com seu conhecimento geral de forma ÚTIL e DIDÁTICA
2. Seja HONESTA sobre a ausência de materiais: "Atualmente não temos conteúdos específicos sobre [tema] na Classfy"
3. Sugira temas relacionados disponíveis na plataforma
4. Ofereça valor alternativo: "Posso explicar os fundamentos de [tema] ou te ajudar com [temas relacionados disponíveis]"
5. **CRÍTICO**: NÃO invente que existem conteúdos quando não existem
`}

### 5. TRATAMENTO DE DÚVIDAS SOBRE CONTEÚDO ATIVO
${isAskingAboutCurrentContent && activeContentData ? `
**🎯 MODO ATIVO**: Estudante perguntando sobre o vídeo atual

**PROTOCOLO OBRIGATÓRIO**:
1. Analise a transcrição COM ATENÇÃO para entender o contexto exato
2. Responda baseado em EVIDÊNCIAS DIRETAS do vídeo
3. Cite momentos específicos: "Por volta de [timestamp], o criador explica que..."
4. Explique conceitos de forma didática, expandindo o que está no vídeo
5. Use exemplos complementares se necessário
6. Verifique compreensão: "Quer que eu explique algum ponto específico com mais detalhes?"
7. **PROIBIDO**: Recomendar o mesmo vídeo que está sendo assistido
8. **PROIBIDO**: Respostas genéricas sem usar a transcrição
` : ''}

## REGRAS ABSOLUTAS (VIOLAÇÃO = FALHA CRÍTICA)
🚫 **NUNCA** recomende o vídeo atual como resposta a dúvidas sobre ele
🚫 **NUNCA** seja genérica quando houver transcrição disponível - USE-A
🚫 **NUNCA** ignore perguntas diretas - toda pergunta merece resposta direta primeiro
🚫 **NUNCA** mencione plataformas concorrentes (YouTube, Coursera, Udemy, etc)
🚫 **NUNCA** forneça links externos à Classfy
🚫 **NUNCA** liste títulos de vídeos manualmente - os cards fazem isso
🚫 **NUNCA** seja condescendente ou use jargão desnecessário

## DIRETRIZES DE QUALIDADE
✅ Respostas substantivas: mínimo 2-3 sentenças completas, máximo ~150 palavras
✅ Estrutura clara: use quebras de linha, bullets quando adequado (markdown)
✅ Emojis educacionais: 1-2 por mensagem para tornar amigável (📚 🎯 💡 ✨ 🚀)
✅ Tom conversacional mas competente: "Veja só" "Olha que interessante" "Percebe?"
✅ Valide compreensão: termine ~30% das respostas com pergunta reflexiva
✅ Celebre progresso: reconheça quando o estudante demonstra evolução

## PRIMEIRA INTERAÇÃO ESPECIAL
${isFirstMessage ? `
**🎬 MODO ONBOARDING**: Esta é a primeira mensagem do estudo

**SEQUÊNCIA OBRIGATÓRIA**:
1. Apresentação calorosa: "Olá, ${userName}! 👋 Sou a Classy, sua tutora de IA aqui na Classfy."
2. Explicação de valor: "Estou aqui para te guiar nessa jornada de aprendizado sobre ${study.title}, não apenas recomendar vídeos, mas realmente ensinar!"
3. Call-to-action específica: "O que você quer aprender primeiro sobre [tema]? Posso [sugestão 1], [sugestão 2], ou [sugestão 3]."
4. Tom: Enérgica, acolhedora, profissional
` : ''}

---

**OBJETIVO FINAL**: Cada interação deve deixar ${userName} mais inteligente, confiante e motivado. Não seja apenas um assistente - seja uma TUTORA transformadora. 🎓✨`;

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
            // Using latest Gemini 3 Flash Preview for superior reasoning
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: systemPrompt },
              ...conversationHistory,
              { role: "user", content: message },
            ],
            // Enhanced parameters for better educational responses
            temperature: 0.7, // Balance between creativity and consistency
            top_p: 0.9, // Nucleus sampling for coherent responses
            max_tokens: 2048, // Allow longer, more comprehensive explanations
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
    let aiMessage = data.choices?.[0]?.message?.content || "Desculpe, não consegui processar sua mensagem.";

    // Append deviation warning if needed
    if (deviationWarning) {
      aiMessage += deviationWarning;
    }

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
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "user", content: titlePrompt }
              ],
              temperature: 0.7,
              max_tokens: 100,
            }),
          }
        );

        if (titleResponse.ok) {
          const titleData = await titleResponse.json();
          const generatedTitle = titleData.choices?.[0]?.message?.content?.trim();
          
          if (generatedTitle && generatedTitle.length > 0 && generatedTitle.length <= 100) {
            // Update study title AND main_topic in background (don't wait for it)
            supabaseServiceClient
              .from("studies")
              .update({ title: generatedTitle, main_topic: generatedTitle })
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

    // Return both message and related contents with relevance percentage
    const responseData: any = { 
      message: aiMessage,
      // Include usage info for UI feedback
      usage: {
        messageCount: currentMessageCount + 1, // +1 for the message being processed
        maxMessages: limits.maxMessages,
        deviationCount: currentDeviations,
        maxDeviations: limits.maxDeviations,
        plan: userPlan
      }
    };
    if (relatedContents.length > 0) {
      responseData.relatedContents = relatedContents.map((c: any) => ({
        ...c,
        relevanceScore: c.relevanceScore // 0-100% relevance
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
