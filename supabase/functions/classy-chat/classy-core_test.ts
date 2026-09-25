import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  addressStudentByName,
  buildVerifiedProgressAnswer,
  buildSourceTransparency,
  detectStudyIntent,
  extractExplicitFocus,
  inferDeclaredLearnerLevel,
  inferLearningStyle,
  isCompleteClassyAiTurn,
  isStudyProgressQuestion,
  parseClassyAiTurn,
  parseClassyRequest,
  selectTranscriptExcerpt,
  prioritizeExplicitlyRequestedContent,
} from "./classy-core.ts";

Deno.test("prioriza a aula pedida e mantém sugestões", () => {
  const contents = [{ title: "AULA MUX 1" }, { title: "A LUZ - Aula 1" }];
  assertEquals(
    prioritizeExplicitlyRequestedContent(
      "Quero estudar a aula A LUZ - Aula 1, da Cindy Ribas.",
      contents,
    ),
    [contents[1], contents[0]],
  );
  assertEquals(
    prioritizeExplicitlyRequestedContent("Quero aprender sobre luz", contents),
    contents,
  );
});

Deno.test("trata o estudante pelo primeiro nome sem repetir", () => {
  assertEquals(
    addressStudentByName("Para começarmos, o que você já sabe?", "Fábio Silva"),
    "Fábio, para começarmos, o que você já sabe?",
  );
  assertEquals(
    addressStudentByName("Fábio, vamos por partes.", "Fábio Silva"),
    "Fábio, vamos por partes.",
  );
  assertEquals(
    addressStudentByName("## Próximo passo\nVamos praticar.", "Ana Maria"),
    "Ana,\n\n## Próximo passo\nVamos praticar.",
  );
  assertEquals(addressStudentByName("Vamos começar.", null), "Vamos começar.");
});

Deno.test("valida e limita a entrada da Classy", () => {
  assertEquals(
    parseClassyRequest({ studyId: "invalido", message: "oi" }).error,
    "studyId inválido",
  );
  const parsed = parseClassyRequest({
    studyId: "c085fbc4-dc3e-4804-81e0-26575b186b7c",
    message: "  Quero aprender UX  ",
    currentVideoTime: -20,
    user_interests: ["design", 12, " produto  digital "],
  });
  assertEquals(parsed.value?.message, "Quero aprender UX");
  assertEquals(parsed.value?.currentVideoTime, 0);
  assertEquals(parsed.value?.userInterests, ["design", "produto digital"]);
});

Deno.test("detecta nível e preferência declarados pelo estudante", () => {
  assertEquals(
    inferDeclaredLearnerLevel("Estou começando do zero"),
    "beginner",
  );
  assertEquals(
    inferDeclaredLearnerLevel("Já sei o básico e já tive contato"),
    "intermediate",
  );
  assertEquals(
    inferDeclaredLearnerLevel("Trabalho com isso há alguns anos"),
    "advanced",
  );
  assertEquals(inferLearningStyle("Me explique passo a passo"), "step_by_step");
  assertEquals(
    inferLearningStyle("Quero direto ao ponto, sem enrolação"),
    "direct",
  );
});

Deno.test("respeita pedido direto já na primeira mensagem", () => {
  const first = { isFirstMessage: true, hasActiveContent: false };
  assertEquals(detectStudyIntent("tecnologias emergentes", first), "onboard");
  assertEquals(detectStudyIntent("Explique computação quântica em termos simples", first), "explain");
  assertEquals(detectStudyIntent("Monte um plano para estudar IA", first), "plan");
  assertEquals(detectStudyIntent("Me recomenda vídeos de UX", first), "recommend");
});

Deno.test("extrai somente mudanças explícitas de foco", () => {
  assertEquals(
    extractExplicitFocus("Quero entender pesquisa com usuários."),
    "pesquisa com usuários",
  );
  assertEquals(extractExplicitFocus("E como isso funciona na prática?"), null);
  assertEquals(
    extractExplicitFocus("Quero aprender tecnologias emergentes começando por inteligência artificial generativa. Indique um vídeo disponível na Classfy para iniciantes, explique por que ele é relevante e adicione-o ao meu mapa do estudo."),
    "inteligência artificial generativa",
  );
  assertEquals(extractExplicitFocus("Explique por que este vídeo é relevante."), null);
});

Deno.test("não aceita resposta estruturada interrompida", () => {
  assertEquals(isCompleteClassyAiTurn('{"answer":"Resposta interrompida'), false);
  assertEquals(isCompleteClassyAiTurn('{"answer":"Resposta completa."}'), true);
});

Deno.test("usa progresso confirmado em perguntas sobre o mapa", () => {
  assertEquals(isStudyProgressQuestion("Terminei de assistir. O que ficou registrado no mapa?"), true);
  assertEquals(isStudyProgressQuestion("Explique o tema desta aula"), false);
  assertEquals(
    buildVerifiedProgressAnswer("AULA MUX 1", 91, true),
    "O vídeo **AULA MUX 1** está registrado como concluído (100%) no seu mapa de estudo. Você pode reabri-lo pelo mapa quando quiser.",
  );
});

Deno.test("seleciona trecho da transcrição perto do momento assistido", () => {
  const transcript = Array.from(
    { length: 3000 },
    (_, index) => `palavra${index}`,
  ).join(" ");
  const excerpt = selectTranscriptExcerpt(transcript, 90, 100, 900);
  assertMatch(excerpt, /palavra2[5-9][0-9][0-9]/);
  assertEquals(excerpt.length <= 900, true);
});

Deno.test("normaliza resposta estruturada e impede fonte inexistente", () => {
  const turn = parseClassyAiTurn(
    JSON.stringify({
      answer: "UX organiza a jornada.",
      intent: "explain",
      topic_relation: "related",
      current_focus: "UX",
      learner_level: "intermediate",
      learning_style: "analogy",
      unresolved_question: null,
      conversation_summary: "Objetivo: aprender UX. Nível intermediário. Próximo passo: aplicar em um projeto.",
      grounding: "transcript",
      confidence: "high",
    }),
    {
      intent: "onboard",
      learnerLevel: "unknown",
      learningStyle: "mixed",
      currentFocus: null,
      hasTranscript: false,
    },
  );
  assertEquals(turn.answer, "UX organiza a jornada.");
  assertEquals(turn.grounding, "general_knowledge");
  assertEquals(turn.learnerLevel, "intermediate");
  assertEquals(turn.conversationSummary, "Objetivo: aprender UX. Nível intermediário. Próximo passo: aplicar em um projeto.");
});

Deno.test("recupera a resposta de JSON truncado sem expor o protocolo", () => {
  const result = parseClassyAiTurn(
    '{"answer":"Não há relação comprovada com UX/UI.\\n\\nContinue com um exercício prático',
    {
      intent: "explain",
      learnerLevel: "beginner",
      learningStyle: "direct",
      currentFocus: "Design UX/UI",
      hasTranscript: false,
    },
  );

  assertEquals(
    result.answer,
    "Não há relação comprovada com UX/UI.\n\nContinue com um exercício prático",
  );
  assertEquals(result.currentFocus, "Design UX/UI");
});

Deno.test("rejeita foco verboso devolvido pelo modelo", () => {
  const result = parseClassyAiTurn(
    JSON.stringify({
      answer: "Resposta válida",
      current_focus:
        "O vídeo recomendado realmente tem relação com UX/UI e como devo continuar este estudo agora?",
    }),
    {
      intent: "explain",
      learnerLevel: "unknown",
      learningStyle: "mixed",
      currentFocus: "Design UX/UI",
      hasTranscript: false,
    },
  );

  assertEquals(result.currentFocus, "Design UX/UI");
});

Deno.test("explica a proveniência em linguagem humana", () => {
  assertEquals(
    buildSourceTransparency("general_knowledge", {
      hasTranscript: false,
      notesCount: 0,
      hasQuiz: false,
    }),
    "Base: conhecimento geral. Não encontrei uma fonte específica na Classfy para esta resposta.",
  );
});
