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
      .limit(50);

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
      
      // Use Postgres full-text search for scalable content discovery

      // Use Postgres full-text search for scalable content discovery
      console.log(`\n========== CLASSY SEARCH (FTS): "${searchQuery}" ==========`);
      
      const { data: ftsResults, error: ftsError } = await supabaseServiceClient
        .rpc("search_platform_content", {
          p_query: searchQuery,
          p_limit: 10,
          p_exclude_id: activeContentId || null,
        });

      if (ftsError) {
        console.error('FTS search error:', ftsError);
      }

      if (ftsResults && ftsResults.length > 0) {
        relatedContents = ftsResults.map((r: any) => ({
          id: r.item_id,
          itemType: r.item_type,
          title: r.title,
          description: r.description,
          content_type: r.content_type,
          thumbnail_url: r.thumbnail_url,
          visibility: r.visibility,
          tags: r.tags,
          total_lessons: r.total_lessons,
          total_duration_seconds: r.total_duration_seconds,
          relevanceScore: Math.round(r.rank * 100),
        }));
        console.log(`✅ FTS encontrou ${relatedContents.length} resultados`);
        relatedContents.forEach((c: any) => {
          console.log(`  ${c.relevanceScore}% - "${c.title}" [${c.item_type}]`);
        });
      } else {
        console.log('⚠️ FTS sem resultados, tentando busca semântica com IA...');
        
        // Fallback: fetch top contents for AI semantic analysis
        const { data: fallbackContents } = await supabaseServiceClient
          .from("contents")
          .select("id, title, description, content_type, thumbnail_url, visibility, tags")
          .eq("status", "approved")
          .in("content_type", ["aula", "short", "podcast"])
          .limit(20);

        const { data: fallbackCourses } = await supabaseServiceClient
          .from("courses")
          .select("id, title, description, thumbnail_url, visibility, tags, total_lessons, total_duration_seconds")
          .eq("status", "approved")
          .limit(10);

        const fallbackItems = [
          ...(fallbackContents || []).map((c: any) => ({ ...c, itemType: 'content' })),
          ...(fallbackCourses || []).map((c: any) => ({ ...c, itemType: 'course', content_type: 'curso' })),
        ].filter((item: any) => !activeContentId || item.id !== activeContentId);

        if (fallbackItems.length > 0) {
          const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
          const semanticPrompt = `Você é um analisador de relevância para conteúdos educacionais.

TEMA BUSCADO: "${searchQuery}"

CONTEÚDOS:
${fallbackItems.slice(0, 15).map((c: any, i: number) => `${i + 1}. "${c.title}" [${c.itemType === 'course' ? 'CURSO' : c.content_type?.toUpperCase()}] - ${(c.description || '').substring(0, 100)}`).join('\n')}

Avalie relevância (0-100%). RESPONDA APENAS JSON: {"results": [{"index": 1, "relevance": 85}]}
Inclua APENAS >= 50%.`;

          try {
            const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-lite",
                messages: [{ role: "user", content: semanticPrompt }],
                temperature: 0.1,
              }),
            });

            if (aiResponse.ok) {
              const aiData = await aiResponse.json();
              const aiResult = aiData.choices[0]?.message?.content?.trim() || "";
              const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                relatedContents = (parsed.results || [])
                  .filter((r: any) => r.relevance >= 50)
                  .map((r: any) => {
                    const idx = r.index - 1;
                    if (idx >= 0 && idx < fallbackItems.length) {
                      return { ...fallbackItems[idx], relevanceScore: r.relevance };
                    }
                    return null;
                  })
                  .filter(Boolean)
                  .slice(0, 10);
                console.log(`✅ IA fallback: ${relatedContents.length} matches`);
              }
            }
          } catch (aiErr) {
            console.error('AI fallback error:', aiErr);
          }
        }
      }

      console.log(`🎯 RESULTADO FINAL: ${relatedContents.length} conteúdos encontrados`);
      console.log('========================================\n');
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
