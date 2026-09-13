import { describe, expect, it } from "vitest";
import { coverTargetSize, getCoverCropRect } from "./coverCrop";

describe("getCoverCropRect", () => {
  it("recorta verticalmente um vídeo retrato para uma capa 16:9", () => {
    const crop = getCoverCropRect(1080, 1920, 16 / 9);

    expect(crop.sx).toBe(0);
    expect(crop.sw).toBe(1080);
    expect(crop.sh).toBeCloseTo(607.5);
    expect(crop.sy).toBeCloseTo(656.25);
  });

  it("respeita o enquadramento escolhido no eixo recortado", () => {
    const top = getCoverCropRect(1080, 1920, 16 / 9, { x: 50, y: 0 });
    const bottom = getCoverCropRect(1080, 1920, 16 / 9, {
      x: 50,
      y: 100,
    });

    expect(top.sy).toBe(0);
    expect(bottom.sy + bottom.sh).toBeCloseTo(1920);
  });

  it("recorta horizontalmente sem deformar uma origem mais larga", () => {
    const crop = getCoverCropRect(2560, 1080, 16 / 9, { x: 100, y: 50 });

    expect(crop.sw / crop.sh).toBeCloseTo(16 / 9);
    expect(crop.sx + crop.sw).toBeCloseTo(2560);
  });
});

describe("coverTargetSize", () => {
  it("exporta aulas em alta resolução horizontal", () => {
    expect(coverTargetSize(16 / 9)).toEqual({ width: 1920, height: 1080 });
  });

  it("exporta shorts em alta resolução vertical", () => {
    expect(coverTargetSize(9 / 16)).toEqual({ width: 1080, height: 1920 });
  });
});
