import { describe, expect, it } from "vitest";
import { buildEditorialHero, normalizeHeroHref, type HomeHeroSettings } from "./homeHeroEditorial";

const settings: HomeHeroSettings = {
  id: 1,
  content_id: "aula-1",
  created_at: "",
  updated_at: "",
  is_active: true,
  eyebrow_label: "Em destaque",
  chip_label: "Para começar",
  show_chip: true,
  title: "Uma nova chamada",
  description: "Aprenda com esta aula.",
  thumbnail_url: "/hero.webp",
  image_position: "right",
  alignment: "right",
  primary_label: "Ver aula",
  primary_href: null,
  show_secondary: false,
  secondary_label: "Estudar com a Classy",
  secondary_href: null,
};

describe("curadoria do destaque da Home", () => {
  it("aplica a copy e o enquadramento sem perder os metadados do vídeo", () => {
    const hero = buildEditorialHero({
      id: "aula-1", title: "Título original", description: "Descrição original",
      thumbnail_url: "/original.webp", duration_seconds: 321,
      content_type: "aula", profiles: { display_name: "Creator" },
    }, settings);

    expect(hero).toMatchObject({
      title: "Uma nova chamada", description: "Aprenda com esta aula.",
      thumbnail_url: "/hero.webp", alignment: "right", image_position: "right",
      duration_seconds: 321, content_type: "aula", show_secondary: false,
    });
  });

  it("mantém os textos do conteúdo quando o editor deixa os overrides vazios", () => {
    const hero = buildEditorialHero({ id: "aula-1", title: "Título original", description: "Descrição original" }, {
      ...settings, title: "", description: null, thumbnail_url: null,
    });
    expect(hero.title).toBe("Título original");
    expect(hero.description).toBe("Descrição original");
  });

  it("não aceita destinos externos ou protocolos no botão", () => {
    expect(normalizeHeroHref("/watch/aula-1", "/watch/default")).toBe("/watch/aula-1");
    expect(normalizeHeroHref("https://outro.site", "/watch/default")).toBe("/watch/default");
    expect(normalizeHeroHref("//outro.site", "/watch/default")).toBe("/watch/default");
    expect(normalizeHeroHref("/\\outro.site", "/watch/default")).toBe("/watch/default");
  });
});
