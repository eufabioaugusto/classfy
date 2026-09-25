import { describe, expect, it } from "vitest";
import { shouldDismissMiniPlayer, shouldExpandMiniPlayer, shouldMinimizePlayer } from "./mobilePlayerGesture";

describe("gestos dos players no celular", () => {
  it("minimiza com arrasto intencional ou impulso para baixo", () => {
    expect(shouldMinimizePlayer(100, 0)).toBe(true);
    expect(shouldMinimizePlayer(20, 600)).toBe(true);
    expect(shouldMinimizePlayer(30, 100)).toBe(false);
    expect(shouldMinimizePlayer(-100, -600)).toBe(false);
  });

  it("expande para cima e exige um gesto maior para fechar o mini player", () => {
    expect(shouldExpandMiniPlayer(-100, 0)).toBe(true);
    expect(shouldDismissMiniPlayer(95, 0)).toBe(false);
    expect(shouldDismissMiniPlayer(125, 0)).toBe(true);
  });
});
