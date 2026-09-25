export type ClassyActiveMode =
  | "onboard"
  | "explain"
  | "recommend"
  | "practice"
  | "review"
  | "plan";

export function addressStudentByName(answer: string, displayName?: string | null): string {
  const firstName = displayName?.trim().split(/\s+/)[0];
  if (!firstName || !/^[\p{L}][\p{L}'’-]*$/u.test(firstName) || !answer.trim()) {
    return answer;
  }

  const escapedName = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(?:^|[^\\p{L}])${escapedName}(?=$|[^\\p{L}])`, "iu").test(answer)) {
    return answer;
  }

  const trimmedAnswer = answer.trimStart();
  if (/^\p{Lu}\p{Ll}/u.test(trimmedAnswer)) {
    return `${firstName}, ${trimmedAnswer[0].toLocaleLowerCase("pt-BR")}${trimmedAnswer.slice(1)}`;
  }
  return `${firstName},\n\n${trimmedAnswer}`;
}
export type ClassyLearnerLevel =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "unknown";
export type ClassyLearningStyle =
  | "direct"
  | "step_by_step"
  | "analogy"
  | "mixed";
export type ClassyTopicRelation = "on_topic" | "related" | "off_topic";
export type ClassyGrounding =
  | "transcript"
  | "study_context"
  | "general_knowledge"
  | "mixed";
export type ClassyConfidence = "high" | "medium" | "low";

export interface ClassyRequest {
  studyId: string;
  message: string;
  activeContentId: string | null;
  currentVideoTime?: number;
  playlistSummary: boolean;
  userInterests: string[];
  userDifficulties: string[];
}

export interface ClassyAiTurn {
  answer: string;
  intent: ClassyActiveMode;
  topicRelation: ClassyTopicRelation;
  currentFocus: string | null;
  learnerLevel: ClassyLearnerLevel;
  learningStyle: ClassyLearningStyle;
  unresolvedQuestion: string | null;
  conversationSummary: string | null;
  grounding: ClassyGrounding;
  confidence: ClassyConfidence;
  telemetry?: {
    provider: string;
    model: string;
    responseMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_PLAYLIST_MESSAGE_LENGTH = 12_000;

export function parseClassyRequest(
  body: unknown,
): { value?: ClassyRequest; error?: string } {
  if (!body || typeof body !== "object") {
    return { error: "Corpo da requisição inválido" };
  }

  const input = body as Record<string, unknown>;
  const studyId = typeof input.studyId === "string" ? input.studyId.trim() : "";
  const playlistSummary = input.playlistSummary === true;
  const maxLength = playlistSummary
    ? MAX_PLAYLIST_MESSAGE_LENGTH
    : MAX_MESSAGE_LENGTH;
  const message = typeof input.message === "string" ? input.message.trim() : "";

  if (!UUID_PATTERN.test(studyId)) {
    return { error: "studyId inválido" };
  }
  if (!message) {
    return { error: "Mensagem vazia" };
  }
  if (message.length > maxLength) {
    return {
      error: `Mensagem muito longa. Use no máximo ${maxLength} caracteres.`,
    };
  }

  const activeContentId =
    typeof input.activeContentId === "string" && input.activeContentId.trim()
      ? input.activeContentId.trim()
      : null;
  if (activeContentId && !UUID_PATTERN.test(activeContentId)) {
    return { error: "activeContentId inválido" };
  }

  const rawVideoTime = input.currentVideoTime;
  const currentVideoTime =
    typeof rawVideoTime === "number" && Number.isFinite(rawVideoTime)
      ? Math.max(0, Math.min(rawVideoTime, 86_400))
      : undefined;

  return {
    value: {
      studyId,
      message,
      activeContentId,
      currentVideoTime,
      playlistSummary,
      userInterests: sanitizeContextList(input.user_interests),
      userDifficulties: sanitizeContextList(input.user_difficulties),
    },
  };
}

export function sanitizeContextList(value: unknown, maxItems = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function inferDeclaredLearnerLevel(
  message: string,
): ClassyLearnerLevel | null {
  const normalized = normalizeText(message);

  if (
    /\b(comecando do zero|do zero|nunca (vi|estudei|usei)|nenhum contato|sou iniciante|nao sei nada)\b/
      .test(normalized)
  ) {
    return "beginner";
  }
  if (
    /\b(ja sei o basico|tenho uma base|ja tive contato|nivel intermediario|conhecimento intermediario)\b/
      .test(normalized)
  ) {
    return "intermediate";
  }
  if (
    /\b(sou avancad[oa]|nivel avancado|trabalho com isso|atuo (com|na area)|domino (o|a|esse|essa))\b/
      .test(normalized)
  ) {
    return "advanced";
  }
  return null;
}

export function inferLearningStyle(
  message: string,
): ClassyLearningStyle | null {
  const normalized = normalizeText(message);

  if (
    /\b(passo a passo|por etapas|bem detalhad[oa]|desde o comeco)\b/.test(
      normalized,
    )
  ) return "step_by_step";
  if (
    /\b(analogia|metafora|comparacao|exemplo do dia a dia)\b/.test(normalized)
  ) return "analogy";
  if (
    /\b(direto ao ponto|seja direto|resumo|resumido|sem enrolacao|objetiv[oa])\b/
      .test(normalized)
  ) return "direct";
  return null;
}

export function extractExplicitFocus(message: string): string | null {
  const compact = message.replace(/\s+/g, " ").trim();
  const patterns = [
    /(?:quero|gostaria de|preciso)\s+(?:aprender|entender|estudar|revisar|praticar)(?:\s+mais)?(?:\s+sobre)?\s+(.+)/i,
    /(?:me explique|explique|fale|ensine)(?:\s+mais)?(?:\s+sobre)?\s+(.+)/i,
    /(?:meu foco|o foco|tema)\s+(?:e|é|eh|sera|será)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (!match?.[1]) continue;
    const candidate = cleanFocus(match[1]);
    if (candidate.length >= 3 && candidate.length <= 100) return candidate;
  }

  return null;
}

export function selectTranscriptExcerpt(
  transcript: string,
  currentTime?: number,
  durationSeconds?: number | null,
  maxChars = 8_000,
) {
  const clean = transcript.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;

  const hasTimeline = typeof currentTime === "number" &&
    typeof durationSeconds === "number" && durationSeconds > 0;
  const ratio = hasTimeline
    ? Math.max(0, Math.min(currentTime! / durationSeconds!, 1))
    : 0;
  const center = Math.round(clean.length * ratio);
  const start = Math.max(
    0,
    Math.min(center - Math.floor(maxChars / 2), clean.length - maxChars),
  );
  const raw = clean.slice(start, start + maxChars);
  const safeStart = start === 0 ? 0 : Math.max(0, raw.indexOf(" ") + 1);
  const safeEnd = start + maxChars >= clean.length
    ? raw.length
    : raw.lastIndexOf(" ");
  return raw.slice(safeStart, safeEnd > safeStart ? safeEnd : raw.length)
    .trim();
}

export function detectStudyIntent(
  message: string,
  options: { isFirstMessage: boolean; hasActiveContent: boolean },
) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("quiz") || normalized.includes("exerc") ||
    normalized.includes("pratic")
  ) return "practice";
  if (
    normalized.includes("resum") || normalized.includes("revisa") ||
    normalized.includes("recapitula")
  ) return "review";
  if (
    normalized.includes("plano") || normalized.includes("trilha") ||
    normalized.includes("ordem para estudar")
  ) return "plan";
  if (
    normalized.includes("recomenda") ||
    normalized.includes("indica") ||
    normalized.includes("sugere") ||
    normalized.includes("o que assistir")
  ) return "recommend";
  if (
    options.hasActiveContent && (
      normalized.includes("vídeo") ||
      normalized.includes("aula") ||
      normalized.includes("conteúdo") ||
      normalized.includes("o que ele") ||
      normalized.includes("o que ela") ||
      normalized.includes("explica")
    )
  ) return "explain";

  if (options.isFirstMessage && normalized.split(/\s+/).length <= 7 &&
    !/[?]/.test(normalized) &&
    !/^(me |como |por que |o que |explique|ensine|mostre|compare|quero saber)/.test(normalized)) return "onboard";
  return "explain";
}

export function parseClassyAiTurn(
  raw: string,
  fallback: {
    intent: ClassyActiveMode;
    learnerLevel: ClassyLearnerLevel;
    learningStyle: ClassyLearningStyle;
    currentFocus: string | null;
    hasTranscript: boolean;
  },
): ClassyAiTurn {
  const parsed = safeJsonParse(raw);
  const answer = typeof parsed?.answer === "string" && parsed.answer.trim()
    ? parsed.answer.trim()
    : extractPartialJsonAnswer(raw);
  const parsedFocus = typeof parsed?.current_focus === "string"
    ? normalizeFocusCandidate(parsed.current_focus)
    : null;
  const requestedGrounding = enumValue<ClassyGrounding>(parsed?.grounding, [
    "transcript",
    "study_context",
    "general_knowledge",
    "mixed",
  ]) ||
    (fallback.hasTranscript ? "mixed" : "general_knowledge");

  return {
    answer: answer ||
      "Não consegui formar uma resposta segura agora. Tente reformular em uma frase.",
    intent: enumValue<ClassyActiveMode>(parsed?.intent, [
      "onboard",
      "explain",
      "recommend",
      "practice",
      "review",
      "plan",
    ]) || fallback.intent,
    topicRelation: enumValue<ClassyTopicRelation>(parsed?.topic_relation, [
      "on_topic",
      "related",
      "off_topic",
    ]) || "on_topic",
    currentFocus: parsedFocus || fallback.currentFocus,
    learnerLevel: enumValue<ClassyLearnerLevel>(parsed?.learner_level, [
      "beginner",
      "intermediate",
      "advanced",
      "unknown",
    ]) || fallback.learnerLevel,
    learningStyle: enumValue<ClassyLearningStyle>(parsed?.learning_style, [
      "direct",
      "step_by_step",
      "analogy",
      "mixed",
    ]) || fallback.learningStyle,
    unresolvedQuestion: typeof parsed?.unresolved_question === "string" &&
        parsed.unresolved_question.trim()
      ? parsed.unresolved_question.replace(/\s+/g, " ").trim().slice(0, 180)
      : null,
    conversationSummary: typeof parsed?.conversation_summary === "string" && parsed.conversation_summary.trim()
      ? parsed.conversation_summary.replace(/\s+/g, " ").trim().slice(0, 800)
      : null,
    grounding: requestedGrounding === "transcript" && !fallback.hasTranscript
      ? "general_knowledge"
      : requestedGrounding,
    confidence: enumValue<ClassyConfidence>(parsed?.confidence, [
      "high",
      "medium",
      "low",
    ]) || "medium",
  };
}

export function buildSourceTransparency(
  grounding: ClassyGrounding,
  sources: { hasTranscript: boolean; notesCount: number; hasQuiz: boolean },
) {
  if (grounding === "transcript" && sources.hasTranscript) {
    return "Base: transcrição do conteúdo aberto.";
  }
  if (grounding === "mixed" && sources.hasTranscript) {
    return "Base: conteúdo aberto e contexto do seu estudo.";
  }
  if (
    grounding === "study_context" && (sources.notesCount > 0 || sources.hasQuiz)
  ) {
    return "Base: histórico, notas e progresso deste estudo.";
  }
  if (grounding === "study_context") {
    return "Base: conversa e progresso deste estudo.";
  }
  return "Base: conhecimento geral. Não encontrei uma fonte específica na Classfy para esta resposta.";
}

function cleanFocus(value: string) {
  return value
    .replace(/[\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(sobre|a respeito de)\s+/i, "")
    .replace(/[?.!,;:\s]+$/g, "")
    .trim();
}

function normalizeFocusCandidate(value: string) {
  const focus = cleanFocus(value);
  const words = focus.split(/\s+/).filter(Boolean);
  if (!focus || focus.length > 80 || words.length > 10 || /[?!]/.test(value)) {
    return null;
  }
  return focus;
}

function extractPartialJsonAnswer(raw: string) {
  const trimmed = raw.trim();
  const answerKey = trimmed.match(/"answer"\s*:\s*"/i);

  if (!answerKey || answerKey.index === undefined) {
    return trimmed.startsWith("{") || trimmed.startsWith("```") ? "" : trimmed;
  }

  const start = answerKey.index + answerKey[0].length;
  let escaped = "";
  let isEscaped = false;

  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === '"' && !isEscaped) break;
    escaped += character;
    isEscaped = character === "\\" && !isEscaped;
    if (character !== "\\") isEscaped = false;
  }

  if (escaped.endsWith("\\")) escaped = escaped.slice(0, -1);

  try {
    return JSON.parse(`"${escaped}"`).trim();
  } catch {
    return escaped
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();
  }
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
): T | null {
  return typeof value === "string" && values.includes(value as T)
    ? value as T
    : null;
}

function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const candidate = fenced || raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
