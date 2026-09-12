import { describe, expect, it } from "vitest";
import { getStandaloneDraftIssues, type StandalonePublicationDraft } from "@/lib/studio/publication";
import { emptyCourseLesson, emptyCourseModule, getCourseDraftIssues, type CoursePublicationDraft } from "@/lib/studio/course";

const standalone = (changes: Partial<StandalonePublicationDraft> = {}): StandalonePublicationDraft => ({
  title: "Aula clara", description: "Uma descrição completa", visibility: "free", price: "0", discount: "0", tags: [],
  fileUrl: "media:asset", thumbnailUrl: "https://example.com/capa.jpg", duration: 120, mediaAssetId: "asset", videoProvider: "mux", uploadState: "ready", ...changes,
});

const course = (changes: Partial<CoursePublicationDraft> = {}): CoursePublicationDraft => {
  const module = emptyCourseModule();
  module.title = "Comece aqui";
  const lesson = emptyCourseLesson();
  Object.assign(lesson, { title: "Primeira aula", mediaAssetId: "asset", fileUrl: "media:asset", uploadState: "ready" });
  module.lessons = [lesson];
  return {
    title: "Curso completo", description: "Descrição do curso", thumbnailUrl: "https://example.com/capa.jpg", visibility: "free",
    price: "0", discount: "0", level: "beginner", requirements: "", whatYouLearn: "", tags: [], issueCertificate: true,
    accessType: "lifetime", accessDays: "365", lessonOrder: "free", allowComments: true, allowReviews: true, allowDownloads: true,
    modules: [module], ...changes,
  };
};

describe("validação de publicação avulsa", () => {
  it("aceita short com exatamente 180 segundos", () => {
    expect(getStandaloneDraftIssues("short", standalone({ duration: 180, description: "" }))).toEqual([]);
  });

  it("recusa short acima de 180 segundos", () => {
    expect(getStandaloneDraftIssues("short", standalone({ duration: 181, description: "" }))).toContain("Reduza o short para até 3 minutos");
  });

  it("não aceita mídia ainda em processamento", () => {
    expect(getStandaloneDraftIssues("aula", standalone({ uploadState: "processing" }))).toContain("Aguarde o processamento da mídia");
  });

  it("exige preço positivo quando o acesso é pago", () => {
    expect(getStandaloneDraftIssues("podcast", standalone({ visibility: "paid", price: "0" }))).toContain("Informe um preço válido");
  });
});

describe("validação do construtor de curso", () => {
  it("aceita curso mínimo íntegro", () => expect(getCourseDraftIssues(course())).toEqual([]));

  it("permite aula textual como unidade válida", () => {
    const value = course();
    value.modules[0].lessons[0] = { ...value.modules[0].lessons[0], lessonType: "text", body: "Conteúdo da aula", fileUrl: "", mediaAssetId: null, uploadState: "ready" };
    expect(getCourseDraftIssues(value)).toEqual([]);
  });

  it("impede envio de itens incompletos", () => {
    const value = course();
    value.modules[0].materials = [{ id: "material", title: "Planilha", description: "", fileUrl: "", fileType: "", fileSize: 0 }];
    expect(getCourseDraftIssues(value)).toContain("Envie ou remova os materiais incompletos");
  });

  it("exige prazo válido quando o acesso é limitado", () => {
    expect(getCourseDraftIssues(course({ accessType: "limited", accessDays: "0" }))).toContain("Informe o prazo de acesso");
  });
});
