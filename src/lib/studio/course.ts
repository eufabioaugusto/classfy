import type { MediaUploadState, PublicationVisibility } from "@/lib/studio/publication";

export type CourseLevel = "beginner" | "intermediate" | "advanced";
export type CourseLessonType = "video" | "audio" | "text";
export type CourseQuestionType = "multiple" | "true-false" | "essay" | "fill-blank";

export interface CourseQuestionDraft {
  id: string;
  question: string;
  type: CourseQuestionType;
  options: string[];
  correctAnswer: number | string;
  explanation: string;
  points: number;
}

export interface CourseQuizDraft {
  id: string;
  title: string;
  description: string;
  questions: CourseQuestionDraft[];
  passingScore: number;
  maxAttempts: number;
}

export interface CourseLessonDraft {
  id: string;
  title: string;
  description: string;
  lessonType: CourseLessonType;
  body: string;
  fileUrl: string;
  mediaAssetId: string | null;
  videoProvider: string | null;
  duration: number;
  isPreview: boolean;
  uploadState: MediaUploadState;
}

export interface CourseMaterialDraft {
  id: string;
  title: string;
  description: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
}

export interface CourseModuleDraft {
  id: string;
  title: string;
  description: string;
  lessons: CourseLessonDraft[];
  quizzes: CourseQuizDraft[];
  materials: CourseMaterialDraft[];
}

export interface CoursePublicationDraft {
  title: string;
  description: string;
  thumbnailUrl: string;
  visibility: PublicationVisibility;
  price: string;
  discount: string;
  level: CourseLevel;
  requirements: string;
  whatYouLearn: string;
  tags: string[];
  issueCertificate: boolean;
  accessType: "lifetime" | "limited";
  accessDays: string;
  lessonOrder: "sequential" | "free";
  allowComments: boolean;
  allowReviews: boolean;
  allowDownloads: boolean;
  modules: CourseModuleDraft[];
}

export const emptyCourseModule = (): CourseModuleDraft => ({
  id: crypto.randomUUID(), title: "", description: "", lessons: [], quizzes: [], materials: [],
});

export const emptyCourseLesson = (): CourseLessonDraft => ({
  id: crypto.randomUUID(), title: "", description: "", lessonType: "video", body: "", fileUrl: "",
  mediaAssetId: null, videoProvider: null, duration: 0, isPreview: false, uploadState: "idle",
});

export const emptyCourseQuiz = (): CourseQuizDraft => ({
  id: crypto.randomUUID(), title: "", description: "", questions: [], passingScore: 70, maxAttempts: 3,
});

export const emptyCourseMaterial = (): CourseMaterialDraft => ({
  id: crypto.randomUUID(), title: "", description: "", fileUrl: "", fileType: "", fileSize: 0,
});

export function getCourseDraftIssues(draft: CoursePublicationDraft) {
  const issues: string[] = [];
  if (!draft.title.trim()) issues.push("Informe o título do curso");
  if (!draft.description.trim()) issues.push("Escreva uma descrição");
  if (!draft.thumbnailUrl) issues.push("Escolha uma capa");
  if (!draft.modules.length) issues.push("Adicione pelo menos um módulo");
  if (draft.modules.some((module) => !module.title.trim())) issues.push("Dê um nome a todos os módulos");

  const lessons = draft.modules.flatMap((module) => module.lessons);
  if (!lessons.length) issues.push("Adicione pelo menos uma aula");
  if (lessons.some((lesson) => !lesson.title.trim())) issues.push("Dê um título a todas as aulas");
  if (lessons.some((lesson) => lesson.lessonType === "text" && !lesson.body.trim())) issues.push("Preencha o texto das aulas adicionadas");
  if (lessons.some((lesson) => lesson.lessonType !== "text" && (!lesson.mediaAssetId || lesson.uploadState !== "ready"))) {
    issues.push("Conclua o envio das mídias das aulas");
  }

  const quizzes = draft.modules.flatMap((module) => module.quizzes);
  if (quizzes.some((quiz) => !quiz.title.trim() || !quiz.questions.length || quiz.questions.some((question) => !question.question.trim()))) {
    issues.push("Preencha ou remova os quizzes incompletos");
  }
  const materials = draft.modules.flatMap((module) => module.materials);
  if (materials.some((material) => !material.title.trim() || !material.fileUrl)) issues.push("Envie ou remova os materiais incompletos");
  if (draft.visibility === "paid" && (!Number.isFinite(Number(draft.price)) || Number(draft.price) <= 0)) issues.push("Informe um preço válido");
  if (draft.accessType === "limited" && (!Number.isFinite(Number(draft.accessDays)) || Number(draft.accessDays) < 1)) issues.push("Informe o prazo de acesso");
  return Array.from(new Set(issues));
}
