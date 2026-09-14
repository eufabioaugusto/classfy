import { describe, expect, it } from "vitest";
import {
  resolveResumePosition,
  shouldRestartFromBeginning,
} from "./resumePosition";

describe("retomada e replay de vídeo", () => {
  it("reinicia conteúdo marcado como concluído", () => {
    expect(
      resolveResumePosition({
        savedPosition: 149,
        duration: 149,
        completed: true,
      }),
    ).toBe(0);
  });

  it("protege registros antigos salvos no último frame", () => {
    expect(
      resolveResumePosition({ savedPosition: 148, duration: 149 }),
    ).toBe(0);
  });

  it("mantém a posição de um conteúdo ainda em andamento", () => {
    expect(
      resolveResumePosition({ savedPosition: 61, duration: 149 }),
    ).toBe(61);
  });

  it("detecta replay no mesmo elemento de mídia", () => {
    expect(
      shouldRestartFromBeginning({
        currentTime: 149,
        duration: 149,
        ended: true,
      }),
    ).toBe(true);
  });
});
