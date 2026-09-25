import { describe, expect, it } from "vitest";
import { normalizeStudyTitle, toShortTitle } from "./getStudyJourneySummary";

describe("título do estudo", () => {
  it("usa a aula solicitada como assunto, sem copiar as instruções seguintes", () => {
    const prompt = "Quero estudar a aula AULA MUX 1, do Creator Mentor. Encontre esse vídeo na Classfy, explique por que ele é relevante e coloque-o no meu mapa do estudo para eu assistir.";
    expect(normalizeStudyTitle(prompt)).toBe("AULA MUX 1");
  });

  it("preserva o título de conteúdo que preenche o novo chat", () => {
    expect(normalizeStudyTitle("Quero aprender sobre A LUZ - Aula 1")).toBe("A LUZ - Aula 1");
    expect(normalizeStudyTitle("Quero aprender sobre finanças, investimentos e orçamento")).toBe("finanças, investimentos e orçamento");
  });

  it("resume títulos longos anteriores ao exibi-los no mapa", () => {
    expect(toShortTitle("Aprender Quero estudar a aula AULA MUX 1, do Creator Mentor. Encontre esse vídeo na Classfy")).toBe("AULA MUX 1");
  });

  it("mantém o tema dentro de um tamanho legível", () => {
    const title = normalizeStudyTitle("Quero aprender sobre estratégias de inovação e transformação digital aplicadas à operação de pequenas empresas brasileiras");
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title).toMatch(/^estratégias de inovação/);
  });
});
