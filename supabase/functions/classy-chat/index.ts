import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_LIMITS = {
  maxMessages: 5,
  maxDeviations: 3,
};

const MODELS = {
  main: "google/gemini-3-flash-preview",
  classifier: "google/gemini-2.5-flash-lite",
};

type PlanType = "free" | "pro" | "premium";
type ActiveMode = "onboard" | "explain" | "recommend" | "practice" | "review" | "plan";
type LearnerLevel = "beginner" | "intermediate" | "advanced" | "unknown";

interface StudyAiStateRow {
  user_goal: string | null;
  current_focus: string | null;
  learner_level: LearnerLevel;
  active_mode: ActiveMode;
  learning_style: "direct" | "step_by_step" | "analogy" | "mixed";
  session_summary: string | null;
  mastered_topics: string[];
  weak_topics: string[];
  open_questions: string[];
  next_best_action: string | null;
  last_active_content_id: string | null;
  last_video_timestamp_seconds: number | null;
  last_quiz_score: number | null;
  last_quiz_total: number | null;
  last_checkpoint_at: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      studyId,
      message,
      activeContentId,
      currentVideoTime,
      playlistSummary,
    } = await req.json();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Não autorizado" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse({ error: "Não autorizado" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: study, error: studyError } = await supabase
      .from("studies")
      .select("*")
      .eq("id", studyId)
      .single();

    if (studyError || !study || study.user_id !== user.id) {
      return jsonResponse({ error: "Estudo não encontrado ou acesso negado" }, 404);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, plan")
      .eq("id", user.id)
      .single();

    const userName = profile?.display_name?.split(" ")[0] || "você";
    const userPlan = (profile?.plan || "free") as PlanType;
    const limits = await loadStudyLimits(supabase, userPlan);
    const currentUserMessageCount = Number(study.message_count || 0);
    const currentDeviations = Number(study.topic_deviations_count || 0);

    if (!playlistSummary && currentUserMessageCount >= limits.maxMessages) {
      return jsonResponse({
        error: "MESSAGE_LIMIT_REACHED",
        message:
          `${userName}, você atingiu o limite de ${limits.maxMessages} mensagens suas neste estudo. ` +
          "Faça upgrade ou crie um novo estudo para continuar. 📚",
        limitReached: true,
        limitType: "messages",
        usage: {
          userMessageCount: currentUserMessageCount,
          maxMessages: limits.maxMessages,
          deviationCount: currentDeviations,
          maxDeviations: limits.maxDeviations,
          plan: userPlan,
        },
      });
    }

    const [
      { data: stateRow },
      { data: activeContentData },
      { data: messages },
      { data: recentNotes },
      { data: quizAttempts },
    ] = await Promise.all([
      supabase
        .from("study_ai_state")
        .select("*")
        .eq("study_id", studyId)
        .maybeSingle(),
      activeContentId
        ? supabase
          .from("contents")
          .select("id, title, description, content_type, creator_id, profiles!contents_creator_id_fkey(display_name)")
          .eq("id", activeContentId)
          .single()
        : Promise.resolve({ data: null }),
      supabase
        .from("study_messages")
        .select("role, content, metadata")
        .eq("study_id", studyId)
        .order("created_at", { ascending: true })
        .limit(40),
      supabase
        .from("study_notes")
        .select("note_text, content_id, timestamp_seconds, created_at")
        .eq("user_id", user.id)
        .eq("study_id", studyId)
        .order("created_at", { ascending: false })
        .limit(activeContentId ? 6 : 4),
      supabase
        .from("quiz_attempts")
        .select("score, max_score, completed_at, quiz:study_quizzes!quiz_attempts_quiz_id_fkey(study_id, content_id)")
        .eq("user_id", user.id)
        .order("completed_at", { ascending: false })
        .limit(5),
    ]);

    const aiState = normalizeStateRow(stateRow as Partial<StudyAiStateRow> | null);
    const conversationHistory = ((messages as any[]) || []).map((item) => ({
      role: item.role,
      content: item.content,
    }));
    const userHistory = conversationHistory.filter((item) => item.role === "user");
    const isFirstMessage = userHistory.length === 0;

    let transcriptionText = "";
    if (activeContentId) {
      const { data: transcriptionData } = await supabase
        .from("transcriptions")
        .select("text")
        .eq("content_id", activeContentId)
        .maybeSingle();
      transcriptionText = transcriptionData?.text || "";
    }

    const { data: progressData } = activeContentId
      ? await supabase
        .from("user_progress")
        .select("progress_percent, last_position_seconds, completed")
        .eq("user_id", user.id)
        .eq("content_id", activeContentId)
        .maybeSingle()
      : { data: null };

    const latestQuizAttempt = ((quizAttempts as any[]) || []).find((attempt) => {
      const quizStudyId = attempt.quiz?.study_id;
      return quizStudyId === studyId;
    }) || null;

    if (isFirstMessage && !study.main_topic && !playlistSummary) {
      await supabase
        .from("studies")
        .update({ main_topic: study.title || extractFocusFromMessage(message) })
        .eq("id", studyId);
    }

    const intent = playlistSummary
      ? "recommend"
      : detectIntent(message, {
        isFirstMessage,
        activeContent: activeContentData,
      });

    const activeMode = mapIntentToMode(intent, isFirstMessage);
    const learnerLevel = inferLearnerLevel(aiState, latestQuizAttempt, progressData);
    const currentFocus = deriveCurrentFocus({
      studyTitle: study.title,
      studyMainTopic: study.main_topic,
      state: aiState,
      message,
      activeContent: activeContentData,
    });

    let deviationWarning = "";
    let deviationCountForUsage = currentDeviations;
    if (!playlistSummary) {
      const topicCheck = await detectOffTopic({
        supabase,
        mainTopic: study.main_topic || study.title,
        message,
        isFirstMessage,
        currentUserMessageCount,
        activeMode,
        activeContentTitle: activeContentData?.title,
      });

      if (topicCheck.isOffTopic) {
        const newDeviationCount = currentDeviations + 1;
        deviationCountForUsage = newDeviationCount;

        await supabase
          .from("studies")
          .update({ topic_deviations_count: newDeviationCount })
          .eq("id", studyId);

        if (newDeviationCount >= limits.maxDeviations) {
          return jsonResponse({
            error: "DEVIATION_LIMIT_REACHED",
            message:
              `${userName}, este estudo já está bem longe do foco inicial em "${study.main_topic || study.title}". ` +
              "Para manter sua jornada organizada, crie um novo estudo para esse novo tema. 🎯",
            limitReached: true,
            limitType: "deviations",
            suggestedTopic: extractFocusFromMessage(message),
            usage: {
              userMessageCount: currentUserMessageCount,
              maxMessages: limits.maxMessages,
              deviationCount: newDeviationCount,
              maxDeviations: limits.maxDeviations,
              plan: userPlan,
            },
          });
        }

        const remainingDeviations = limits.maxDeviations - newDeviationCount;
        deviationWarning =
          `\n\n🎯 Este ponto parece abrir um novo subtema. ` +
          `Se quiser, eu posso te ajudar aqui mesmo agora, mas talvez faça sentido criar um estudo separado. ` +
          `Você ainda tem ${remainingDeviations} desvio(s) disponível(is) neste estudo.`;
      }
    }

    const shouldSearch = !playlistSummary && shouldSearchRelatedContent({
      activeMode,
      isFirstMessage,
      hasActiveContent: Boolean(activeContentData),
    });

    const relatedContents = shouldSearch
      ? await searchRelatedContent(supabase, {
        query: currentFocus || study.title || message,
        activeContentId: activeContentId || null,
      })
      : [];

    const contentStrategy = transcriptionText && activeMode === "explain"
      ? "grounded"
      : relatedContents.length > 0
      ? "recommendation"
      : "mixed";

    const nextBestAction = deriveNextBestAction({
      activeMode,
      activeContent: activeContentData,
      relatedContents,
      latestQuizAttempt,
      progressData,
      currentFocus,
    });

    const userGoal = aiState.user_goal || (isFirstMessage ? extractFocusFromMessage(message) : study.title);
    const notesSummary = summarizeNotes((recentNotes as any[]) || []);
    const quizSummary = summarizeQuizAttempt(latestQuizAttempt);
    const sessionSummary = buildSessionSummary({
      existingSummary: aiState.session_summary,
      currentFocus,
      learnerLevel,
      message,
      activeMode,
    });

    const tutorPrompt = buildTutorPrompt({
      userName,
      userPlan,
      userGoal,
      currentFocus,
      learnerLevel,
      activeMode,
      studyTitle: study.title,
      activeContent: activeContentData,
      transcriptionText,
      currentVideoTime,
      progressData,
      notesSummary,
      quizSummary,
      relatedContents,
      isFirstMessage,
      playlistSummary: Boolean(playlistSummary),
      message,
      nextBestAction,
    });

    let aiMessage = await generateAiMessage(tutorPrompt, conversationHistory, message, playlistSummary);
    if (deviationWarning) {
      aiMessage += deviationWarning;
    }

    const followUpSuggestions = buildFollowUpSuggestions({
      activeMode,
      activeContent: activeContentData,
      currentFocus,
      relatedContents,
      latestQuizAttempt,
    });

    const citations = buildCitations({
      activeContent: activeContentData,
      currentVideoTime,
      hasTranscript: Boolean(transcriptionText),
      notes: (recentNotes as any[]) || [],
      latestQuizAttempt,
    });

    const uiBlocks = buildUiBlocks({
      activeMode,
      isFirstMessage,
      userGoal,
      currentFocus,
      nextBestAction,
      latestQuizAttempt,
    });

    await supabase
      .from("study_ai_state")
      .upsert({
        study_id: studyId,
        user_goal: userGoal,
        current_focus: currentFocus,
        learner_level: learnerLevel,
        active_mode: activeMode,
        learning_style: aiState.learning_style || "mixed",
        session_summary: sessionSummary,
        mastered_topics: mergeTopics(aiState.mastered_topics, extractMasteredTopics(latestQuizAttempt, currentFocus)),
        weak_topics: mergeTopics(aiState.weak_topics, extractWeakTopics(latestQuizAttempt, currentFocus)),
        open_questions: mergeTopics(aiState.open_questions, collectOpenQuestions(activeMode, message)),
        next_best_action: nextBestAction,
        last_active_content_id: activeContentId || aiState.last_active_content_id,
        last_video_timestamp_seconds: typeof currentVideoTime === "number"
          ? Math.round(currentVideoTime)
          : aiState.last_video_timestamp_seconds,
        last_quiz_score: latestQuizAttempt?.score ?? aiState.last_quiz_score,
        last_quiz_total: latestQuizAttempt?.max_score ?? aiState.last_quiz_total,
        last_checkpoint_at: uiBlocks.some((block) => block.type === "checkpoint")
          ? new Date().toISOString()
          : aiState.last_checkpoint_at,
      })
      .eq("study_id", studyId);

    const responseData = {
      message: aiMessage,
      intent,
      contentStrategy,
      usage: {
        userMessageCount: currentUserMessageCount + (playlistSummary ? 0 : 1),
        maxMessages: limits.maxMessages,
        deviationCount: deviationCountForUsage,
        maxDeviations: limits.maxDeviations,
        plan: userPlan,
      },
      studyState: {
        activeMode,
        currentFocus,
        learnerLevel,
        nextBestAction,
        userGoal,
      },
      uiBlocks,
      followUpSuggestions,
      citations,
      relatedContents,
    };

    return jsonResponse(responseData);
  } catch (error) {
    console.error("Error in classy-chat:", error);
    return jsonResponse({ error: (error as Error).message || "Erro ao processar mensagem" }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadStudyLimits(supabase: ReturnType<typeof createClient>, plan: PlanType) {
  const { data } = await supabase.rpc("get_study_limits", { p_plan: plan });
  return {
    maxMessages: Number(data?.max_messages ?? DEFAULT_LIMITS.maxMessages),
    maxDeviations: Number(data?.max_deviations ?? DEFAULT_LIMITS.maxDeviations),
  };
}

function normalizeStateRow(row: Partial<StudyAiStateRow> | null): StudyAiStateRow {
  return {
    user_goal: row?.user_goal ?? null,
    current_focus: row?.current_focus ?? null,
    learner_level: (row?.learner_level as LearnerLevel) || "unknown",
    active_mode: (row?.active_mode as ActiveMode) || "onboard",
    learning_style: row?.learning_style || "mixed",
    session_summary: row?.session_summary ?? null,
    mastered_topics: row?.mastered_topics || [],
    weak_topics: row?.weak_topics || [],
    open_questions: row?.open_questions || [],
    next_best_action: row?.next_best_action ?? null,
    last_active_content_id: row?.last_active_content_id ?? null,
    last_video_timestamp_seconds: row?.last_video_timestamp_seconds ?? null,
    last_quiz_score: row?.last_quiz_score ?? null,
    last_quiz_total: row?.last_quiz_total ?? null,
    last_checkpoint_at: row?.last_checkpoint_at ?? null,
  };
}

function detectIntent(
  message: string,
  options: { isFirstMessage: boolean; activeContent: any | null },
) {
  const normalized = message.toLowerCase();

  if (options.isFirstMessage) return "onboard";
  if (normalized.includes("quiz") || normalized.includes("exerc") || normalized.includes("pratic")) return "practice";
  if (normalized.includes("resum") || normalized.includes("revisa") || normalized.includes("recapitula")) return "review";
  if (normalized.includes("plano") || normalized.includes("trilha") || normalized.includes("ordem para estudar")) return "plan";
  if (
    normalized.includes("recomenda") ||
    normalized.includes("indica") ||
    normalized.includes("sugere") ||
    normalized.includes("o que assistir")
  ) return "recommend";
  if (options.activeContent && (
    normalized.includes("vídeo") ||
    normalized.includes("aula") ||
    normalized.includes("conteúdo") ||
    normalized.includes("o que ele") ||
    normalized.includes("o que ela") ||
    normalized.includes("explica")
  )) return "explain";

  return "explain";
}

function mapIntentToMode(intent: string, isFirstMessage: boolean): ActiveMode {
  if (isFirstMessage) return "onboard";
  if (intent === "practice") return "practice";
  if (intent === "review") return "review";
  if (intent === "plan") return "plan";
  if (intent === "recommend") return "recommend";
  return "explain";
}

function inferLearnerLevel(aiState: StudyAiStateRow, latestQuizAttempt: any, progressData: any): LearnerLevel {
  if (latestQuizAttempt?.max_score) {
    const ratio = latestQuizAttempt.score / latestQuizAttempt.max_score;
    if (ratio >= 0.85) return "advanced";
    if (ratio >= 0.6) return "intermediate";
    return "beginner";
  }

  if (typeof progressData?.progress_percent === "number") {
    if (progressData.progress_percent >= 80) return "intermediate";
    if (progressData.progress_percent >= 35) return "beginner";
  }

  return aiState.learner_level || "unknown";
}

function deriveCurrentFocus(options: {
  studyTitle: string;
  studyMainTopic: string | null;
  state: StudyAiStateRow;
  message: string;
  activeContent: any | null;
}) {
  if (options.activeContent?.title) return options.activeContent.title;
  if (options.state.current_focus) return options.state.current_focus;
  if (options.studyMainTopic) return options.studyMainTopic;
  return extractFocusFromMessage(options.message) || options.studyTitle;
}

async function detectOffTopic(options: {
  supabase: ReturnType<typeof createClient>;
  mainTopic: string;
  message: string;
  isFirstMessage: boolean;
  currentUserMessageCount: number;
  activeMode: ActiveMode;
  activeContentTitle?: string;
}) {
  if (options.isFirstMessage || options.currentUserMessageCount < 2 || options.activeMode === "practice" || options.activeMode === "review") {
    return { isOffTopic: false };
  }

  if (options.activeContentTitle && overlapScore(options.activeContentTitle, options.message) >= 0.15) {
    return { isOffTopic: false };
  }

  if (overlapScore(options.mainTopic, options.message) >= 0.18) {
    return { isOffTopic: false };
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return { isOffTopic: false };

  const prompt = `Você classifica se uma mensagem de estudo está fora do tema.

Tema principal: "${options.mainTopic}"
Mensagem: "${options.message}"

Considere OFF_TOPIC apenas se o assunto for claramente outro domínio de conhecimento.
Perguntas tangenciais, aplicações práticas, exemplos e aprofundamentos relacionados ainda são ON_TOPIC.

Responda apenas com JSON:
{"isOffTopic": true}
ou
{"isOffTopic": false}`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELS.classifier,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 80,
      }),
    });

    if (!response.ok) return { isOffTopic: false };
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(content);
    return { isOffTopic: Boolean(parsed?.isOffTopic) };
  } catch {
    return { isOffTopic: false };
  }
}

function overlapScore(base: string, candidate: string) {
  const baseTokens = tokenize(base);
  const candidateTokens = tokenize(candidate);
  if (baseTokens.length === 0 || candidateTokens.length === 0) return 0;

  const baseSet = new Set(baseTokens);
  const overlap = candidateTokens.filter((token) => baseSet.has(token)).length;
  return overlap / Math.max(candidateTokens.length, 1);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3);
}

function shouldSearchRelatedContent(options: {
  activeMode: ActiveMode;
  isFirstMessage: boolean;
  hasActiveContent: boolean;
}) {
  if (options.activeMode === "recommend" || options.activeMode === "plan") return true;
  if (options.isFirstMessage) return true;
  if (!options.hasActiveContent) return true;
  return false;
}

async function searchRelatedContent(
  supabase: ReturnType<typeof createClient>,
  options: { query: string; activeContentId: string | null },
) {
  const { data, error } = await supabase.rpc("search_platform_content", {
    p_query: options.query,
    p_limit: 8,
    p_exclude_id: options.activeContentId,
  });

  if (error || !data) return [];

  return data.map((item: any) => ({
    id: item.item_id,
    itemType: item.item_type,
    title: item.title,
    description: item.description,
    content_type: item.content_type,
    thumbnail_url: item.thumbnail_url,
    visibility: item.visibility,
    tags: item.tags,
    total_lessons: item.total_lessons,
    total_duration_seconds: item.total_duration_seconds,
    relevanceScore: Math.round(Number(item.rank || 0) * 100),
  }));
}

function deriveNextBestAction(options: {
  activeMode: ActiveMode;
  activeContent: any | null;
  relatedContents: any[];
  latestQuizAttempt: any;
  progressData: any;
  currentFocus: string | null;
}) {
  if (options.activeMode === "practice") return "Responder a um exercício rápido e validar seu entendimento.";
  if (options.activeMode === "review") return "Revisar os pontos fracos e depois refazer o quiz.";
  if (options.activeMode === "plan") return "Seguir uma ordem de estudo clara, começando pelos fundamentos.";
  if (options.latestQuizAttempt?.max_score && options.latestQuizAttempt.score / options.latestQuizAttempt.max_score < 0.7) {
    return "Revisar os conceitos centrais antes de avançar para um novo conteúdo.";
  }
  if (options.activeContent && !options.progressData?.completed) {
    return "Concluir o conteúdo atual e testar a compreensão com uma pergunta ou quiz.";
  }
  if (options.relatedContents.length > 0) {
    return "Abrir o primeiro conteúdo recomendado para aprofundar o tema atual.";
  }
  return `Aprofundar "${options.currentFocus || "este tema"}" com uma explicação prática e exemplos.`;
}

function summarizeNotes(notes: any[]) {
  if (!notes.length) return "Sem notas recentes.";
  return notes
    .slice(0, 3)
    .map((note) => note.note_text)
    .join(" | ")
    .slice(0, 400);
}

function summarizeQuizAttempt(quizAttempt: any) {
  if (!quizAttempt?.max_score) return "Sem quiz recente.";
  return `Último quiz: ${quizAttempt.score}/${quizAttempt.max_score}.`;
}

function buildSessionSummary(options: {
  existingSummary: string | null;
  currentFocus: string | null;
  learnerLevel: LearnerLevel;
  message: string;
  activeMode: ActiveMode;
}) {
  const lastTurn = `Foco atual: ${options.currentFocus || "não definido"}; modo: ${options.activeMode}; nível: ${options.learnerLevel}; última intenção: ${extractFocusFromMessage(options.message)}.`;
  if (!options.existingSummary) return lastTurn;
  return `${options.existingSummary.slice(0, 220)} ${lastTurn}`.slice(0, 420);
}

function buildTutorPrompt(options: {
  userName: string;
  userPlan: PlanType;
  userGoal: string | null;
  currentFocus: string | null;
  learnerLevel: LearnerLevel;
  activeMode: ActiveMode;
  studyTitle: string;
  activeContent: any | null;
  transcriptionText: string;
  currentVideoTime?: number;
  progressData: any;
  notesSummary: string;
  quizSummary: string;
  relatedContents: any[];
  isFirstMessage: boolean;
  playlistSummary: boolean;
  message: string;
  nextBestAction: string;
}) {
  const relatedContentSummary = options.relatedContents.length > 0
    ? options.relatedContents
      .slice(0, 5)
      .map((item, index) => `${index + 1}. ${item.title} (${item.content_type})`)
      .join("\n")
    : "Nenhum conteúdo relacionado encontrado.";

  return `Você é Classy, a tutora estratégica da Classfy.

REGRAS:
- Responda em português do Brasil.
- Seja calorosa, objetiva e didática.
- Responda primeiro à necessidade real do estudante.
- Se houver transcrição do conteúdo ativo, priorize isso como fonte.
- Se houver conteúdos relacionados, contextualize a trilha mas NÃO liste manualmente os títulos como uma lista longa; os cards já aparecem na UI.
- Não cite concorrentes nem links externos.
- Não seja genérica.
- Máximo de 150 palavras.

CONTEXTO DO ESTUDANTE:
- Nome: ${options.userName}
- Plano: ${options.userPlan}
- Objetivo atual: ${options.userGoal || options.studyTitle}
- Foco atual: ${options.currentFocus || options.studyTitle}
- Nível inferido: ${options.learnerLevel}
- Modo atual: ${options.activeMode}
- Próximo melhor passo: ${options.nextBestAction}

SINAIS DE APRENDIZADO:
- Progresso: ${options.progressData?.progress_percent ?? 0}%
- ${options.quizSummary}
- Notas recentes: ${options.notesSummary}

CONTEÚDO ATIVO:
${options.activeContent ? `- Título: ${options.activeContent.title}
- Tipo: ${options.activeContent.content_type}
- Criador: ${options.activeContent.profiles?.display_name || "Desconhecido"}
- Timestamp atual: ${typeof options.currentVideoTime === "number" ? formatTimestamp(options.currentVideoTime) : "não informado"}`
    : "Nenhum conteúdo ativo agora."}

TRANSCRIÇÃO DO CONTEÚDO ATIVO:
${options.transcriptionText ? options.transcriptionText.slice(0, 7000) : "Sem transcrição disponível."}

CONTEÚDOS RELACIONADOS:
${relatedContentSummary}

MENSAGEM DO ESTUDANTE:
${options.message}

INSTRUÇÕES DE ENTREGA:
${options.playlistSummary
    ? "- Gere um resumo curto da playlist salva, explicando o que a pessoa pode aprender com a trilha."
    : options.isFirstMessage
    ? "- Faça onboarding estratégico: acolha, diga como vai ajudar e convide a escolher o primeiro foco."
    : "- Responda com estratégia pedagógica, e conduza o estudante para o próximo melhor passo."}
`;
}

async function generateAiMessage(
  systemPrompt: string,
  conversationHistory: Array<{ role: string; content: string }>,
  message: string,
  playlistSummary: boolean,
) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY not configured");
  }

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODELS.main,
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationHistory.slice(-8),
        { role: "user", content: message },
      ],
      temperature: playlistSummary ? 0.5 : 0.65,
      max_tokens: 700,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Limite de requisições atingido. Tente novamente em alguns instantes.");
    }
    if (response.status === 402) {
      throw new Error("Créditos de IA esgotados. Entre em contato com o suporte.");
    }
    throw new Error(`AI gateway error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "Desculpe, não consegui processar sua mensagem.";
}

function buildFollowUpSuggestions(options: {
  activeMode: ActiveMode;
  activeContent: any | null;
  currentFocus: string | null;
  relatedContents: any[];
  latestQuizAttempt: any;
}) {
  if (options.activeMode === "practice") {
    return [
      "Me faça uma pergunta de revisão",
      "Quero um exercício mais difícil",
      "Mostre a resposta comentada",
    ];
  }

  if (options.activeMode === "review" || (options.latestQuizAttempt?.max_score && options.latestQuizAttempt.score / options.latestQuizAttempt.max_score < 0.7)) {
    return [
      "Resuma os pontos que eu errei",
      "Explique isso passo a passo",
      "Monte um mini plano de revisão",
    ];
  }

  if (options.relatedContents.length > 0) {
    return [
      "Monte uma trilha para mim",
      "Começar pelo básico",
      "Quero aplicações práticas",
    ];
  }

  if (options.activeContent) {
    return [
      "Resuma este trecho em 3 pontos",
      "Me dê um exemplo prático",
      "Crie uma pergunta para testar meu entendimento",
    ];
  }

  return [
    `Quero entender melhor ${options.currentFocus || "esse tema"}`,
    "Me explique com um exemplo",
    "Como eu aplico isso na prática?",
  ];
}

function buildCitations(options: {
  activeContent: any | null;
  currentVideoTime?: number;
  hasTranscript: boolean;
  notes: any[];
  latestQuizAttempt: any;
}) {
  const citations: Array<{ source: "transcript" | "note" | "quiz"; label: string; timestampSeconds?: number }> = [];

  if (options.activeContent && options.hasTranscript) {
    citations.push({
      source: "transcript",
      label: options.currentVideoTime
        ? `${options.activeContent.title} • ${formatTimestamp(options.currentVideoTime)}`
        : options.activeContent.title,
      timestampSeconds: typeof options.currentVideoTime === "number" ? Math.round(options.currentVideoTime) : undefined,
    });
  }

  if (options.notes.length > 0) {
    citations.push({
      source: "note",
      label: `${options.notes.length} nota(s) recente(s) neste estudo`,
    });
  }

  if (options.latestQuizAttempt?.max_score) {
    citations.push({
      source: "quiz",
      label: `${options.latestQuizAttempt.score}/${options.latestQuizAttempt.max_score} no último quiz`,
    });
  }

  return citations;
}

function buildUiBlocks(options: {
  activeMode: ActiveMode;
  isFirstMessage: boolean;
  userGoal: string | null;
  currentFocus: string | null;
  nextBestAction: string;
  latestQuizAttempt: any;
}) {
  const blocks: Array<{ type: "goal" | "checkpoint" | "practice" | "next_step"; title: string; body?: string; bullets?: string[]; prompt?: string; action?: string }> = [];

  if (options.isFirstMessage) {
    blocks.push({
      type: "goal",
      title: "Objetivo da sessão",
      body: options.userGoal || options.currentFocus || "Definir seu foco de aprendizado",
    });
  }

  if (options.latestQuizAttempt?.max_score && options.latestQuizAttempt.score / options.latestQuizAttempt.max_score < 0.7) {
    blocks.push({
      type: "checkpoint",
      title: "Checkpoint de revisão",
      bullets: [
        `Seu último quiz ficou em ${options.latestQuizAttempt.score}/${options.latestQuizAttempt.max_score}.`,
        "Vale revisar os fundamentos antes de avançar.",
      ],
    });
  }

  if (options.activeMode === "practice") {
    blocks.push({
      type: "practice",
      title: "Prática guiada",
      prompt: "Depois da explicação, tente resumir o conceito com suas próprias palavras.",
    });
  }

  blocks.push({
    type: "next_step",
    title: "Próximo melhor passo",
    action: options.nextBestAction,
  });

  return blocks.slice(0, 3);
}

function extractFocusFromMessage(message: string) {
  return message
    .replace(/^ol[aá]!?\s*/i, "")
    .replace(/^quero aprender sobre\s*/i, "")
    .trim()
    .slice(0, 100);
}

function mergeTopics(existing: string[], incoming: string[]) {
  return Array.from(new Set([...(existing || []), ...(incoming || [])])).slice(0, 8);
}

function extractWeakTopics(latestQuizAttempt: any, currentFocus: string | null) {
  if (!latestQuizAttempt?.max_score) return [];
  return latestQuizAttempt.score / latestQuizAttempt.max_score < 0.7 && currentFocus ? [currentFocus] : [];
}

function extractMasteredTopics(latestQuizAttempt: any, currentFocus: string | null) {
  if (!latestQuizAttempt?.max_score) return [];
  return latestQuizAttempt.score / latestQuizAttempt.max_score >= 0.85 && currentFocus ? [currentFocus] : [];
}

function collectOpenQuestions(activeMode: ActiveMode, message: string) {
  if (activeMode === "explain" || activeMode === "review") {
    return [extractFocusFromMessage(message)];
  }
  return [];
}

function formatTimestamp(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function safeJsonParse(raw: string) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : raw);
  } catch {
    return null;
  }
}
