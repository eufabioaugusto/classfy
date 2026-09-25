import { describe, expect, it } from "vitest";
import { extractInterestTerms, isDisplayableInterest } from "./interests";

describe("interesses para iniciar um estudo", () => {
  it("guarda o tema do pedido como uma sugestão, sem verbos soltos", () => {
    expect(extractInterestTerms({
      title: "Quero estudar a aula AULA MUX 1, do Creator Mentor. Encontre esse vídeo na Classfy",
    })).toEqual(["aula mux 1"]);
    expect(isDisplayableInterest("quero")).toBe(false);
    expect(isDisplayableInterest("estudar")).toBe(false);
    expect(isDisplayableInterest("aula mux 1")).toBe(true);
  });

  it("preserva siglas de assunto e oculta IDs técnicos dos chips", () => {
    expect(isDisplayableInterest("IA")).toBe(true);
    expect(isDisplayableInterest("UX")).toBe(true);
    expect(isDisplayableInterest("2df30d62-4410-422a-b086-c92ca8ef0f6b")).toBe(false);
  });
});
