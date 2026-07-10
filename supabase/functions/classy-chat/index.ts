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
  main: "google/gemini-2.5-flash",
  classifier: "google/gemini-2.5-flash",
};

type AiProvider = "gemini" | "openrouter" | "lovable" | "none";

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
  live_plan_steps: string[];
  last_celebration: string | null;
  celebration_count: number;
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
      user_interests,
      user_difficulties,
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
    const dailyLimits = await getDailyLimits(supabase);
    const maxMessagesToday = dailyLimits[userPlan];

    const timeLimit24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dailyUserMessageCount } = await supabase
      .from("study_messages")
      .select("*", { count: "exact", head: true })
      .eq("study_id", studyId)
      .eq("role", "user")
      .gt("created_at", timeLimit24hAgo);
    
    const currentDailyCount = dailyUserMessageCount || 0;
    const currentDeviations = Number(study.topic_deviations_count || 0);

    if (!playlistSummary && currentDailyCount >= maxMessagesToday) {
      return jsonResponse({
        error: "MESSAGE_LIMIT_REACHED",
        message:
          `${userName}, você atingiu o seu limite diário de ${maxMessagesToday} mensagens de chat neste estudo. ` +
          "Faça upgrade de plano para enviar mais ou aguarde o reset de 24 horas. 📚",
        limitReached: true,
        limitType: "messages",
        usage: {
          userMessageCount: currentDailyCount,
          maxMessages: maxMessagesToday,
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
        .select("role, content, metadata, created_at")
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
    const rawMessages = (messages as any[]) || [];
    const conversationHistory = rawMessages.map((item) => ({
      role: item.role,
      content: item.content,
    }));
    const userHistory = conversationHistory.filter((item) => item.role === "user");
    const isFirstMessage = userHistory.length === 0;
    const currentUserMessageCount = userHistory.length;
    const isReturningStudy = currentUserMessageCount > 0 && Boolean(aiState.session_summary || aiState.current_focus);

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
    const previousQuizAttempt = ((quizAttempts as any[]) || []).filter((attempt) => {
      const quizStudyId = attempt.quiz?.study_id;
      return quizStudyId === studyId;
    })[1] || null;

    if (isFirstMessage && !study.main_topic && !playlistSummary) {
      await supabase
        .from("studies")
        .update({ main_topic: sanitizeStudyLabel(study.title) || extractFocusFromMessage(message) })
        .eq("id", studyId);
    }

    const intent = playlistSummary
      ? "recommend"
      : detectIntent(message, {
        isFirstMessage,
        activeContent: activeContentData,
      });

    const baseActiveMode = mapIntentToMode(intent, isFirstMessage);
    const learnerLevel = inferLearnerLevel(aiState, latestQuizAttempt, progressData);
    const currentFocus = deriveCurrentFocus({
      studyTitle: study.title,
      studyMainTopic: study.main_topic,
      state: aiState,
      message,
      activeContent: activeContentData,
    });
    const focusChanged = Boolean(
      aiState.current_focus &&
      currentFocus &&
      aiState.current_focus !== currentFocus,
    );
    const userMessagesSinceCheckpoint = countUserMessagesSinceCheckpoint(rawMessages, aiState.last_checkpoint_at);
    const activeMode = deriveAdaptiveMode({
      baseMode: baseActiveMode,
      latestQuizAttempt,
      progressData,
      hasActiveContent: Boolean(activeContentData),
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
      currentUserMessageCount,
      hasActiveContent: Boolean(activeContentData),
      latestQuizAttempt,
    });

    const relatedContents = shouldSearch
      ? await searchRelatedContent(supabase, {
        query: currentFocus || study.title || message,
        activeContentId: activeContentId || null,
        learnerLevel,
        activeMode,
      })
      : [];
    const recommendedPath = buildRecommendedPath({
      activeMode,
      learnerLevel,
      relatedContents,
      currentFocus,
      activeContent: activeContentData,
    });
    const contentStrategy = currentUserMessageCount < 2
      ? null
      : transcriptionText && activeMode === "explain"
      ? "grounded"
      : relatedContents.length > 0
      ? "recommendation"
      : "mixed";

    const nextBestAction = deriveNextBestAction({
      activeMode,
      activeContent: activeContentData,
      relatedContents,
      recommendedPath,
      latestQuizAttempt,
      progressData,
      currentFocus,
    });
    const refinedLivePlanSteps = buildLivePlanSteps({
      currentFocus,
      activeMode,
      learnerLevel,
      nextBestAction,
      recommendedPath,
      activeContent: activeContentData,
      progressData,
      weakTopics: aiState.weak_topics,
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
      focusChanged,
      latestQuizAttempt,
      nextBestAction,
    });
    const checkpointStatus = deriveCheckpointStatus({
      latestQuizAttempt,
      userMessagesSinceCheckpoint,
      focusChanged,
      lastCheckpointAt: aiState.last_checkpoint_at,
    });
    const celebrationMessage = buildCelebrationMessage({
      latestQuizAttempt,
      previousQuizAttempt,
      progressData,
      currentFocus,
      masteredTopics: aiState.mastered_topics,
      lastCelebration: aiState.last_celebration,
    });
    const sourceTransparency = currentUserMessageCount < 2
      ? ""
      : buildSourceTransparency({
        contentStrategy,
        hasTranscript: Boolean(transcriptionText),
        notesCount: ((recentNotes as any[]) || []).length,
        latestQuizAttempt,
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
      sessionSummary,
      weakTopics: aiState.weak_topics,
      masteredTopics: aiState.mastered_topics,
      openQuestions: aiState.open_questions,
      recommendedPath,
      livePlanSteps: refinedLivePlanSteps,
      checkpointStatus,
      celebrationMessage,
      sourceTransparency,
      relatedContents,
      isFirstMessage,
      playlistSummary: Boolean(playlistSummary),
      message,
      nextBestAction,
      userInterests: Array.isArray(user_interests) ? user_interests : [],
      userDifficulties: Array.isArray(user_difficulties) ? user_difficulties : [],
    });

    const aiProviderAvailable = resolveAiProvider() !== "none";
    let aiMessage = aiProviderAvailable
      ? await generateAiMessage(tutorPrompt, conversationHistory, message, playlistSummary)
      : buildFallbackAiMessage({
        userName,
        userGoal,
        currentFocus,
        activeMode,
        activeContent: activeContentData,
        relatedContents,
        nextBestAction,
        latestQuizAttempt,
        isFirstMessage,
        playlistSummary: Boolean(playlistSummary),
        celebrationMessage,
        learnerLevel,
      });

    if (deviationWarning) {
      aiMessage += deviationWarning;
    }

    const followUpSuggestions = buildFollowUpSuggestions({
      activeMode,
      activeContent: activeContentData,
      currentFocus,
      relatedContents,
      latestQuizAttempt,
      recommendedPath,
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
      currentUserMessageCount,
      isReturningStudy,
      userGoal,
      currentFocus,
      sessionSummary,
      nextBestAction,
      latestQuizAttempt,
      checkpointStatus,
      recommendedPath,
      livePlanSteps: refinedLivePlanSteps,
      celebrationMessage,
      sourceTransparency,
    });

    const mergedMasteredTopics = mergeTopics(aiState.mastered_topics, extractMasteredTopics(latestQuizAttempt, currentFocus));
    const mergedWeakTopics = mergeTopics(aiState.weak_topics, extractWeakTopics(latestQuizAttempt, currentFocus));
    const mergedOpenQuestions = mergeTopics(aiState.open_questions, collectOpenQuestions(activeMode, message));

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
        mastered_topics: mergedMasteredTopics,
        weak_topics: mergedWeakTopics,
        open_questions: mergedOpenQuestions,
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
        live_plan_steps: refinedLivePlanSteps,
        last_celebration: celebrationMessage || aiState.last_celebration,
        celebration_count: celebrationMessage ? aiState.celebration_count + 1 : aiState.celebration_count,
      })
      .eq("study_id", studyId);

    await trackStudyAiEvents(supabase, {
      userId: user.id,
      studyId,
      events: [
        {
          event_key: "assistant_response",
          payload: {
            active_mode: activeMode,
            current_focus: currentFocus,
            checkpoint_status: checkpointStatus,
            content_strategy: contentStrategy,
          },
        },
        ...(didQuizImprove(previousQuizAttempt, latestQuizAttempt)
          ? [{
            event_key: "quiz_improved_after_guidance",
            payload: {
              previous_score: previousQuizAttempt?.score ?? null,
              previous_total: previousQuizAttempt?.max_score ?? null,
              score: latestQuizAttempt?.score ?? null,
              total: latestQuizAttempt?.max_score ?? null,
              current_focus: currentFocus,
            },
          }]
          : []),
      ],
    });

    const responseData = {
      message: aiMessage,
      intent,
      contentStrategy,
      sourceTransparency,
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
        sessionSummary,
        masteredTopics: mergedMasteredTopics,
        weakTopics: mergedWeakTopics,
        openQuestions: mergedOpenQuestions,
        lastCheckpointAt: uiBlocks.some((block) => block.type === "checkpoint")
          ? new Date().toISOString()
          : aiState.last_checkpoint_at,
        lastQuizScore: latestQuizAttempt?.score ?? aiState.last_quiz_score,
        lastQuizTotal: latestQuizAttempt?.max_score ?? aiState.last_quiz_total,
        checkpointStatus,
        livePlanSteps: refinedLivePlanSteps,
        lastCelebration: celebrationMessage || aiState.last_celebration,
        celebrationCount: celebrationMessage ? aiState.celebration_count + 1 : aiState.celebration_count,
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

function resolveAiProvider(): AiProvider {
  if (Deno.env.get("GEMINI_API_KEY")) return "gemini";
  if (Deno.env.get("OPENROUTER_API_KEY")) return "openrouter";
  if (Deno.env.get("LOVABLE_API_KEY")) return "lovable";
  return "none";
}

function resolveModelName(model: string, provider: AiProvider) {
  if (provider === "gemini") {
    return "gemini-2.5-flash";
  }
  if (provider === "openrouter" || provider === "lovable") {
    return "google/gemini-2.5-flash";
  }
  return model;
}

async function requestAiCompletion(options: {
  model: string;
  systemPrompt?: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  maxTokens: number;
}) {
  const provider = resolveAiProvider();

  if (provider === "none") {
    throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  }

  if (provider === "gemini") {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const modelName = resolveModelName(options.model, provider);
    
    // Sanitize and format contents for Gemini (alternating user/model starting with user)
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    for (const msg of options.messages) {
      if (msg.role === "system") continue;
      const role = msg.role === "assistant" ? "model" : "user";
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += "\n\n" + msg.content;
      } else {
        contents.push({
          role,
          parts: [{ text: msg.content }],
        });
      }
    }
    
    // Ensure it starts with user
    while (contents.length > 0 && contents[0].role === "model") {
      contents.shift();
    }
    
    if (contents.length === 0) {
      contents.push({
        role: "user",
        parts: [{ text: "Olá" }],
      });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiKey!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: options.systemPrompt
          ? {
            parts: [{ text: options.systemPrompt }],
          }
          : undefined,
        contents,
        generationConfig: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`Gemini API Error (status ${response.status}):`, JSON.stringify(data));
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("")
      .trim();

    return { provider, response, data, text };
  }

  const endpoint = provider === "openrouter"
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";
  const apiKey = provider === "openrouter" ? Deno.env.get("OPENROUTER_API_KEY") : Deno.env.get("LOVABLE_API_KEY");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolveModelName(options.model, provider),
      messages: [
        ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
        ...options.messages,
      ],
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      ...(provider === "openrouter" ? { transforms: ["middle-out"] } : {}),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error(`AI API Error (status ${response.status}):`, JSON.stringify(data));
  }
  const text = data?.choices?.[0]?.message?.content?.trim?.() || "";

  return { provider, response, data, text };
}

async function trackStudyAiEvents(
  supabase: ReturnType<typeof createClient>,
  options: {
    userId: string;
    studyId: string;
    events: Array<{ event_key: string; payload: Record<string, unknown> }>;
  },
) {
  const rows = options.events.filter(Boolean);
  if (rows.length === 0) return;

  await supabase.from("study_ai_events").insert(
    rows.map((event) => ({
      user_id: options.userId,
      study_id: options.studyId,
      event_key: event.event_key,
      payload: event.payload,
    })),
  );
}

async function getDailyLimits(supabase: ReturnType<typeof createClient>): Promise<Record<PlanType, number>> {
  try {
    const { data } = await supabase
      .from("system_config")
      .select("config_value")
      .eq("config_key", "classy_chat_daily_limits")
      .maybeSingle();
    if (data?.config_value) {
      return {
        free: Number(data.config_value.free ?? 15),
        pro: Number(data.config_value.pro ?? 50),
        premium: Number(data.config_value.premium ?? 200),
      };
    }
  } catch (err) {
    console.error("Failed to load classy_chat_daily_limits from system_config:", err);
  }
  return { free: 15, pro: 50, premium: 200 };
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
    live_plan_steps: row?.live_plan_steps || [],
    last_celebration: row?.last_celebration ?? null,
    celebration_count: Number(row?.celebration_count ?? 0),
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
  if (options.state.current_focus) return sanitizeStudyLabel(options.state.current_focus);
  if (options.studyMainTopic) return sanitizeStudyLabel(options.studyMainTopic);
  return extractFocusFromMessage(options.message) || sanitizeStudyLabel(options.studyTitle);
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

  if (resolveAiProvider() === "none") return { isOffTopic: false };

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
    const { response, text } = await requestAiCompletion({
      model: MODELS.classifier,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      maxTokens: 80,
    });

    if (!response.ok) return { isOffTopic: false };
    const parsed = safeJsonParse(text);
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
  currentUserMessageCount: number;
  hasActiveContent: boolean;
  latestQuizAttempt: any;
}) {
  if (options.activeMode === "onboard") return false;
  if (options.isFirstMessage || options.currentUserMessageCount < 1) return false;
  if (options.activeMode === "recommend" || options.activeMode === "plan") return true;
  if (options.latestQuizAttempt?.max_score && options.latestQuizAttempt.score / options.latestQuizAttempt.max_score < 0.7) return true;
  if (options.activeMode === "explain" && !options.hasActiveContent) return true;
  if (!options.hasActiveContent) return true;
  return false;
}

async function searchRelatedContent(
  supabase: ReturnType<typeof createClient>,
  options: { query: string; activeContentId: string | null; learnerLevel: LearnerLevel; activeMode: ActiveMode },
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
  })).sort((a: any, b: any) => rankRelatedContent(b, options) - rankRelatedContent(a, options));
}

function rankRelatedContent(
  item: any,
  options: { learnerLevel: LearnerLevel; activeMode: ActiveMode },
) {
  let score = Number(item.rank || 0) * 100;
  const contentType = String(item.content_type || "").toLowerCase();
  const totalLessons = Number(item.total_lessons || 0);
  const totalDuration = Number(item.total_duration_seconds || 0);

  if (options.activeMode === "review" || options.learnerLevel === "beginner") {
    if (contentType.includes("video") || contentType.includes("audio")) score += 12;
    if (totalLessons > 0 && totalLessons <= 10) score += 8;
    if (totalDuration > 0 && totalDuration <= 1800) score += 6;
  }

  if (options.activeMode === "plan" || options.activeMode === "recommend") {
    if (totalLessons > 3) score += 8;
  }

  if (options.learnerLevel === "advanced") {
    score += totalLessons > 10 ? 6 : 0;
  }

  return score;
}

function buildLivePlanSteps(options: {
  currentFocus: string | null;
  activeMode: ActiveMode;
  learnerLevel: LearnerLevel;
  nextBestAction: string | null;
  recommendedPath: string[];
  activeContent: any | null;
  progressData: any;
  weakTopics: string[];
}) {
  const steps: string[] = [];

  if (options.activeContent && !options.progressData?.completed) {
    steps.push(`Concluir ${options.activeContent.title} antes de abrir outra frente.`);
  }

  if (options.weakTopics.length > 0) {
    steps.push(`Revisar ${options.weakTopics.slice(0, 2).join(" e ")} com foco em clareza prática.`);
  }

  if (options.nextBestAction) {
    steps.push(options.nextBestAction);
  }

  if (options.recommendedPath.length > 0) {
    steps.push(...options.recommendedPath);
  }

  if (steps.length === 0 && options.currentFocus) {
    steps.push(`Consolidar ${options.currentFocus} com explicação, prática e revisão curta.`);
  }

  return Array.from(new Set(steps)).slice(0, 4);
}

function countUserMessagesSinceCheckpoint(messages: any[], lastCheckpointAt: string | null) {
  return messages.filter((item) => {
    if (item.role !== "user") return false;
    if (!lastCheckpointAt) return true;
    return new Date(item.created_at).getTime() > new Date(lastCheckpointAt).getTime();
  }).length;
}

function deriveAdaptiveMode(options: {
  baseMode: ActiveMode;
  latestQuizAttempt: any;
  progressData: any;
  hasActiveContent: boolean;
}): ActiveMode {
  if (options.baseMode === "practice" || options.baseMode === "plan" || options.baseMode === "recommend") {
    return options.baseMode;
  }

  if (options.latestQuizAttempt?.max_score) {
    const ratio = options.latestQuizAttempt.score / options.latestQuizAttempt.max_score;
    if (ratio < 0.7) return "review";
    if (ratio >= 0.85 && !options.hasActiveContent) return "plan";
  }

  if (options.progressData?.completed && !options.hasActiveContent) {
    return "recommend";
  }

  return options.baseMode;
}

function deriveCheckpointStatus(options: {
  latestQuizAttempt: any;
  userMessagesSinceCheckpoint: number;
  focusChanged: boolean;
  lastCheckpointAt: string | null;
}): "fresh" | "due" | "recommended" {
  const hoursSinceCheckpoint = options.lastCheckpointAt
    ? (Date.now() - new Date(options.lastCheckpointAt).getTime()) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY;

  if (
    options.latestQuizAttempt?.max_score &&
    options.latestQuizAttempt.score / options.latestQuizAttempt.max_score < 0.7 &&
    hoursSinceCheckpoint >= 6
  ) {
    return "recommended";
  }

  if (
    !options.lastCheckpointAt ||
    options.focusChanged ||
    options.userMessagesSinceCheckpoint >= 4 ||
    hoursSinceCheckpoint >= 24
  ) {
    return "due";
  }

  return "fresh";
}

function didQuizImprove(previousQuizAttempt: any, latestQuizAttempt: any) {
  if (!previousQuizAttempt?.max_score || !latestQuizAttempt?.max_score) return false;
  const previousRatio = previousQuizAttempt.score / previousQuizAttempt.max_score;
  const latestRatio = latestQuizAttempt.score / latestQuizAttempt.max_score;
  return latestRatio - previousRatio >= 0.15;
}

function buildCelebrationMessage(options: {
  latestQuizAttempt: any;
  previousQuizAttempt: any;
  progressData: any;
  currentFocus: string | null;
  masteredTopics: string[];
  lastCelebration: string | null;
}) {
  if (didQuizImprove(options.previousQuizAttempt, options.latestQuizAttempt)) {
    return `Seu desempenho melhorou no quiz de ${options.currentFocus || "este estudo"}. Isso mostra retenção real, não só leitura passiva.`;
  }

  if (
    options.latestQuizAttempt?.max_score &&
    options.latestQuizAttempt.score / options.latestQuizAttempt.max_score >= 0.85 &&
    options.currentFocus &&
    !options.masteredTopics.includes(options.currentFocus)
  ) {
    return `Você já demonstra domínio forte em ${options.currentFocus}. Vale começar a conectar esse tema com aplicações mais avançadas.`;
  }

  if (options.progressData?.completed && options.currentFocus && options.lastCelebration?.includes(options.currentFocus) !== true) {
    return `Você concluiu uma etapa importante em ${options.currentFocus}. Esse é um bom momento para consolidar e avançar com intenção.`;
  }

  return null;
}

function buildSourceTransparency(options: {
  contentStrategy: string;
  hasTranscript: boolean;
  notesCount: number;
  latestQuizAttempt: any;
}) {
  if (options.contentStrategy === "grounded" && options.hasTranscript) {
    return "Resposta ancorada na transcrição do conteúdo ativo e no seu contexto atual de estudo.";
  }

  if (options.contentStrategy === "recommendation") {
    return "Resposta guiada por curadoria de conteúdos relacionados e pelo seu histórico neste estudo.";
  }

  if (options.notesCount > 0 || options.latestQuizAttempt?.max_score) {
    return "Resposta montada com base no histórico da conversa, notas recentes e sinais do seu quiz.";
  }

  return "Resposta baseada na conversa atual e no estado pedagógico persistido deste estudo.";
}

function buildRecommendedPath(options: {
  activeMode: ActiveMode;
  learnerLevel: LearnerLevel;
  relatedContents: any[];
  currentFocus: string | null;
  activeContent: any | null;
}) {
  if (options.relatedContents.length === 0) return [];

  const picks = options.relatedContents.slice(0, 3);
  const verbs = options.activeMode === "review"
    ? ["Reveja", "Reforce", "Feche"]
    : options.activeMode === "plan"
    ? ["Comece", "Avance", "Consolide"]
    : ["Abra", "Aprofunde", "Conecte"];

  return picks.map((content, index) => {
    const step = verbs[index] || "Explore";
    if (index === 0 && options.activeContent?.title) {
      return `${index + 1}. ${step} com ${content.title} para continuar depois de ${options.activeContent.title}.`;
    }
    if (options.learnerLevel === "beginner" && index === 0) {
      return `${index + 1}. ${step} por ${content.title} para firmar a base de ${options.currentFocus || "este tema"}.`;
    }
    if (options.activeMode === "review" && index === 1) {
      return `${index + 1}. ${step} com ${content.title} para corrigir pontos frágeis antes de avançar.`;
    }
    return `${index + 1}. ${step} com ${content.title} para aprofundar ${options.currentFocus || "o tema atual"}.`;
  });
}

function deriveNextBestAction(options: {
  activeMode: ActiveMode;
  activeContent: any | null;
  relatedContents: any[];
  recommendedPath: string[];
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
  if (options.recommendedPath.length > 0) {
    return options.recommendedPath[0];
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
  focusChanged: boolean;
  latestQuizAttempt: any;
  nextBestAction: string;
}) {
  const summaryParts = [
    `Foco atual em ${options.currentFocus || "tema não definido"}`,
    `modo ${options.activeMode}`,
    `nível ${options.learnerLevel}`,
  ];

  if (options.focusChanged) {
    summaryParts.push("houve mudança recente de foco");
  }

  if (options.latestQuizAttempt?.max_score) {
    summaryParts.push(`último quiz ${options.latestQuizAttempt.score}/${options.latestQuizAttempt.max_score}`);
  }

  summaryParts.push(`próximo passo: ${options.nextBestAction}`);

  const currentSnapshot = `${summaryParts.join(", ")}.`;
  if (!options.existingSummary) return currentSnapshot;

  return `${options.existingSummary.slice(0, 190)} ${currentSnapshot}`.slice(0, 420);
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
  sessionSummary: string;
  weakTopics: string[];
  masteredTopics: string[];
  openQuestions: string[];
  recommendedPath: string[];
  livePlanSteps: string[];
  checkpointStatus: "fresh" | "due" | "recommended";
  celebrationMessage: string | null;
  sourceTransparency: string;
  relatedContents: any[];
  isFirstMessage: boolean;
  playlistSummary: boolean;
  message: string;
  nextBestAction: string;
  userInterests: string[];
  userDifficulties: string[];
}) {
  const relatedContentSummary = options.relatedContents.length > 0
    ? options.relatedContents
      .slice(0, 5)
      .map((item, index) => `${index + 1}. ${item.title} (${item.content_type})`)
      .join("\n")
    : "Nenhum conteúdo relacionado encontrado.";

  return `Você é a Classy, a mentora intelectual e estratégica da Classfy. Seu papel é oferecer mentoria pedagógica de altíssimo nível, combinando clareza conceitual, sofisticação intelectual e calor humano.

DIRETRIZES DE TOM E FORMATAÇÃO (PREMIUM UX):
1. ZERO CLICHÊS DE IA: Banimento estrito de saudações e encerramentos artificiais.
   - NUNCA use frases como: "Que ótima pergunta!", "Excelente escolha!", "Entendi que você...", "Como você mencionou...", "Espero que isso ajude!", "Estou aqui para ajudar!", "Certamente!", "Com certeza!", "Ótimo, Creator!".
   - Vá direto ao ponto de valor da resposta. A empatia se expressa pela relevância e pela profundidade pedagógica, não por cordialidades mecânicas.
2. TÉCNICA DE FEYNMAN & ANALOGIAS: Explique conceitos difíceis com metáforas simples do mundo real. Prefira o entendimento intuitivo à teoria pura.
3. CONVERSA FLUIDA: Evite listas numeradas ou bullet points excessivos. Escreva de forma orgânica, usando no máximo 2 a 3 parágrafos curtos.
4. MARKDOWN SOFISTICADO: Use **negrito** estritamente para destacar um conceito-chave na primeira aparição. Evite excesso de formatação ou emojis.
5. CONEXÃO ATIVA: Conecte o assunto atual aos interesses do estudante (${options.userInterests.slice(0, 3).join(", ")}) ou a tópicos frágeis identificados (${options.weakTopics.slice(0, 3).join(", ")}).
6. MÁXIMO DE 180 PALAVRAS: Seja concisa, mas profunda. Cada frase deve carregar valor real.

REGRAS DE CONDUTA POR MODO:
- onboard (Abertura de Conversa):
  * Não se apresente com discursos longos. Reconheça o tema central com um gancho intelectual instigante.
  * Faça exatamente uma pergunta calibrada e cirúrgica para entender o nível de maturidade ou o objetivo prático do estudante no assunto.
- explain (Explicação e Aprofundamento):
  * Ensine o conceito com precisão cirúrgica usando uma analogia marcante.
  * Termine com uma provocação ou um convite para refletir sobre a aplicação prática daquilo.
- practice (Exercício e Desafio):
  * Não peça para o usuário treinar sozinho. Proponha um micro-desafio de cenário real curto e imediato: "Imagine a situação X. Como você aplicaria Y para resolver?"
- review (Mentoria de Lacunas):
  * Identifique erros ou lacunas passadas com base no progresso (${options.progressData?.progress_percent ?? 0}%) ou tópicos frágeis (${options.weakTopics.join(", ")}).
  * Re-explique sob uma perspectiva alternativa e peça para o estudante resumir de volta.
- recommend / plan (Direcionamento de Estudos):
  * Explique brevemente o porquê pedagógico da rota sugerida antes de apresentá-la.

CONTEXTO DO ESTUDANTE:
- Nome: ${options.userName}
- Nível: ${options.learnerLevel}
- Objetivo: ${options.userGoal || options.studyTitle}
- Foco atual: ${options.currentFocus || options.studyTitle}
- Tópicos consolidados: ${options.masteredTopics.length > 0 ? options.masteredTopics.join(", ") : "nenhum ainda"}
- Tópicos frágeis mapeados: ${options.weakTopics.length > 0 ? options.weakTopics.join(", ") : "nenhum ainda"}
- Notas da jornada: ${options.notesSummary || "sem notas"}
- Resumo da jornada: ${options.sessionSummary || "iniciando agora"}

CONTEÚDO ATIVO ATUAL:
${options.activeContent ? `- Título: ${options.activeContent.title} (${options.activeContent.content_type})
- Criador: ${options.activeContent.profiles?.display_name || "Desconhecido"}
- Timestamp: ${typeof options.currentVideoTime === "number" ? formatTimestamp(options.currentVideoTime) : "não informado"}`
    : "Nenhum conteúdo ativo."}

TRANSCRIÇÃO DO CONTEÚDO ATIVO:
${options.transcriptionText ? options.transcriptionText.slice(0, 6000) : "Sem transcrição disponível."}

INSTRUÇÕES DE ENTREGA:
${options.playlistSummary
    ? "Gere um resumo estratégico de valor da playlist salva, descrevendo de forma inspiradora o impacto que o estudante terá ao dominá-la."
    : options.isFirstMessage
    ? "Esta é a primeira mensagem da conversa. Acolha com o modo 'onboard', sem despejar trilhas ou resumos operacionais. Foco total em calibrar o estudante com 1 pergunta intrigante."
    : "Responda de forma fluida seguindo as diretrizes Conversacionais Premium."}
`;
}

async function generateAiMessage(
  systemPrompt: string,
  conversationHistory: Array<{ role: string; content: string }>,
  message: string,
  playlistSummary: boolean,
) {
  const { response, text } = await requestAiCompletion({
    model: MODELS.main,
    systemPrompt,
    messages: [
      ...conversationHistory.slice(-8),
      { role: "user", content: message },
    ],
    temperature: playlistSummary ? 0.5 : 0.65,
    maxTokens: 2500,
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

  return text || "Desculpe, não consegui processar sua mensagem.";
}

function buildFallbackAiMessage(options: {
  userName: string;
  userGoal: string | null;
  currentFocus: string | null;
  activeMode: ActiveMode;
  activeContent: any | null;
  relatedContents: any[];
  nextBestAction: string | null;
  latestQuizAttempt: any;
  isFirstMessage: boolean;
  playlistSummary: boolean;
  celebrationMessage: string | null;
  learnerLevel: LearnerLevel;
}) {
  const focus = options.currentFocus || options.userGoal || "este tema";
  const relatedTitles = options.relatedContents
    .slice(0, 3)
    .map((content) => `- ${content.title}`)
    .join("\n");

  if (options.playlistSummary) {
    return [
      `Essa trilha foi organizada para te ajudar a avançar em ${focus} com uma sequência prática de conteúdos.`,
      options.relatedContents.length > 0 ? `Vale começar por:\n${relatedTitles}` : null,
      options.nextBestAction ? `Próximo passo: ${options.nextBestAction}` : null,
    ].filter(Boolean).join("\n\n");
  }

  if (options.isFirstMessage) {
    return [
      `Perfeito, ${options.userName}. Entendi que você quer aprender sobre ${focus}.`,
      options.activeContent?.title
        ? `Como já existe um conteúdo ativo, posso usar esse material para te explicar, revisar ou aprofundar sem perder contexto.`
        : `Posso te ajudar a sair do zero, organizar o tema ou ir direto para aplicações práticas, dependendo do que você precisa.`,
      `Você quer começar pelo básico, por aplicações práticas ou por um objetivo específico seu?`,
    ].join("\n\n");
  }

  const modeLabel = {
    explain: `Vamos destrinchar ${focus} de forma objetiva.`,
    recommend: `Vou te orientar com curadoria para avançar em ${focus}.`,
    practice: `Vamos transformar ${focus} em prática agora.`,
    review: `Hora de revisar ${focus} com foco no que mais importa.`,
    plan: `Vou organizar um caminho claro para você estudar ${focus}.`,
    onboard: `Vamos estruturar seu estudo em ${focus}.`,
  }[options.activeMode];

  const quizHint = options.latestQuizAttempt
    ? `Seu último quiz ficou em ${options.latestQuizAttempt.score}/${options.latestQuizAttempt.max_score}.`
    : null;

  const levelHint = options.learnerLevel !== "unknown"
    ? `Estou assumindo um nível ${translateLearnerLevel(options.learnerLevel)} por enquanto.`
    : null;

  return [
    modeLabel,
    options.celebrationMessage || null,
    quizHint,
    levelHint,
    options.activeContent?.title
      ? `Estou considerando o conteúdo ativo "${options.activeContent.title}" como contexto principal.`
      : null,
    options.relatedContents.length > 0
      ? `Conteúdos que podem complementar este passo:\n${relatedTitles}`
      : null,
    options.nextBestAction
      ? `Próximo melhor passo: ${options.nextBestAction}`
      : `Se quiser, eu posso seguir por explicação, revisão ou recomendação de conteúdos.`,
  ].filter(Boolean).join("\n\n");
}

function translateLearnerLevel(level: LearnerLevel) {
  switch (level) {
    case "beginner":
      return "iniciante";
    case "intermediate":
      return "intermediário";
    case "advanced":
      return "avançado";
    default:
      return "indefinido";
  }
}

function buildFollowUpSuggestions(options: {
  activeMode: ActiveMode;
  activeContent: any | null;
  currentFocus: string | null;
  relatedContents: any[];
  latestQuizAttempt: any;
  recommendedPath: string[];
}) {
  if (options.activeMode === "practice") {
    return [
      "Me faça uma pergunta de revisão",
      "Quero um exercício mais difícil",
      "Mostre a resposta comentada",
    ];
  }

  if (options.activeMode === "onboard") {
    return [
      "Quero começar do zero",
      "Já sei o básico",
      "Quero aplicar isso no trabalho",
    ];
  }

  if (options.activeMode === "review" || (options.latestQuizAttempt?.max_score && options.latestQuizAttempt.score / options.latestQuizAttempt.max_score < 0.7)) {
    return [
      "Resuma os pontos que eu errei",
      "Explique isso passo a passo",
      "Monte um mini plano de revisão",
    ];
  }

  if (options.recommendedPath.length > 0 || options.relatedContents.length > 0) {
    return [];
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
  currentUserMessageCount: number;
  isReturningStudy: boolean;
  userGoal: string | null;
  currentFocus: string | null;
  sessionSummary: string;
  nextBestAction: string;
  latestQuizAttempt: any;
  checkpointStatus: "fresh" | "due" | "recommended";
  recommendedPath: string[];
  livePlanSteps: string[];
  celebrationMessage: string | null;
  sourceTransparency: string;
}) {
  const blocks: Array<{ type: "goal" | "checkpoint" | "practice" | "next_step" | "resume" | "trail" | "celebration" | "sources"; title: string; body?: string; bullets?: string[]; prompt?: string; action?: string }> = [];

  if (options.isFirstMessage || options.currentUserMessageCount < 2 || options.activeMode === "onboard") {
    return blocks;
  }

  if (options.activeMode === "practice") {
    blocks.push({
      type: "practice",
      title: "Prática guiada",
      prompt: "Depois da explicação, tente resumir o conceito com suas próprias palavras.",
    });
  }

  if (options.celebrationMessage && !options.isFirstMessage) {
    blocks.push({
      type: "celebration",
      title: "Sinal de progresso",
      body: options.celebrationMessage,
    });
  }

  if (
    options.recommendedPath.length > 0 &&
    options.livePlanSteps.length > 0 &&
    (options.activeMode === "plan" || options.activeMode === "recommend" || options.activeMode === "review")
  ) {
    blocks.push({
      type: "trail",
      title: "Rota sugerida",
      bullets: options.livePlanSteps.slice(0, 3),
    });
  }

  if (options.activeMode !== "onboard" && !options.isFirstMessage && options.nextBestAction && blocks.length === 0) {
    blocks.push({
      type: "next_step",
      title: "Sugestão da Classy",
      action: options.nextBestAction,
    });
  }

  return blocks.slice(0, 1);
}

function extractFocusFromMessage(message: string) {
  return sanitizeStudyLabel(message).slice(0, 100);
}

function sanitizeStudyLabel(value: string | null | undefined) {
  if (!value) return "";

  const normalized = value
    .replace(/^ol[aá](?:,\s*[^!?.]+)?[!?.]?\s*/i, "")
    .replace(/^quero aprender(?:\s+sobre)?\s+/i, "")
    .replace(/^aprender(?:\s+sobre)?\s+/i, "")
    .replace(/^estudo(?:\s+sobre)?\s+/i, "")
    .replace(/^tema:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[!?.:,;\s]+$/g, "");

  const segments = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const midpoint = segments.length / 2;

  if (
    segments.length >= 6 &&
    Number.isInteger(midpoint) &&
    segments.slice(0, midpoint).join(" ").toLowerCase() ===
      segments.slice(midpoint).join(" ").toLowerCase()
  ) {
    return segments.slice(0, midpoint).join(" ");
  }

  return normalized;
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
  const focus = extractFocusFromMessage(message);
  if (!focus) return [];

  if (activeMode === "explain") {
    return [`Quero entender melhor ${focus}`];
  }

  if (activeMode === "review") {
    return [`Quais são os pontos mais importantes sobre ${focus}?`];
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
