import { describe, expect, it } from 'vitest';
import { measureStudioScene } from '../../../../shared/studio/autoEnhance';
import { studioSignatureFaceKey, studioSignaturePixel, studioSignatureTone, suggestStudioSignature } from '../../../../shared/studio/signatureLook';
const stats = (rgb: number[]) => measureStudioScene(new Uint8ClampedArray([...rgb, 255]));
describe('Assinatura seletiva Classfy', () => {
  const signature = { version: 1 as const, strength: .85, subjectExposure: .2, backgroundExposure: -1.2, backgroundBlur: .28, temperature: .18 };
  it('escurece cenário mantendo o rosto protagonista com os mesmos pixels de entrada', () => {
    const rgb = [.6, .48, .4], face = studioSignaturePixel(rgb, 1, 1, signature), background = studioSignaturePixel(rgb, 0, 0, signature);
    expect(face[0]).toBeGreaterThan(rgb[0]); expect(background[0]).toBeLessThan(rgb[0] * .6);
    expect(face[0] / background[0]).toBeGreaterThan(2); expect(face[2]).toBeGreaterThan(background[2]);
  });
  it('intensidade zero é original exato mesmo com fundo desfocado diferente', () => {
    const rgb = [.1, .2, .3]; expect(studioSignaturePixel(rgb, .5, .8, { ...signature, strength: 0 }, [.8, .9, .9])).toEqual(rgb);
  });
  it('curva conserva preto e é monotônica, com realces suaves', () => {
    expect(studioSignatureTone(0)).toBe(0); expect(studioSignatureTone(1)).toBe(.97);
    let prior = 0; for (let i = 0; i <= 1000; i++) { const next = studioSignatureTone(i / 1000); expect(next).toBeGreaterThanOrEqual(prior); prior = next; }
  });
  it('luz no rosto tem borda suave e direção leve, sem atingir fundo distante', () => {
    const face = { x: .5, y: .3, width: .2, height: .3 };
    expect(studioSignatureFaceKey(.5, .3, face)).toBeGreaterThan(.8);
    expect(studioSignatureFaceKey(.46, .3, face)).toBeGreaterThan(studioSignatureFaceKey(.54, .3, face));
    expect(studioSignatureFaceKey(.1, .9, face)).toBe(0); expect(studioSignatureFaceKey(.5, .3)).toBe(0);
  });
  it('fundo claro e fundo já escuro recebem correções próprias', () => {
    const subject = stats([120, 100, 80]);
    const bright = suggestStudioSignature([{ subject, background: stats([210, 200, 190]), personPresent: true, facePresent: true }]);
    const dark = suggestStudioSignature([{ subject, background: stats([15, 15, 15]), personPresent: true, facePresent: true }]);
    expect(bright.backgroundExposure).toBeLessThan(dark.backgroundExposure); expect(dark.backgroundExposure).toBe(-.25);
    expect(bright.subjectExposure).toBe(dark.subjectExposure);
  });
  it('uma roupa escura não eleva a exposição de uma face clara detectada', () => {
    const face = { subject: stats([220, 190, 160]), background: stats([180, 180, 180]), personPresent: true, facePresent: true };
    const body = { ...face, subject: stats([20, 20, 20]), facePresent: false };
    expect(suggestStudioSignature([face, body]).subjectExposure).toBe(suggestStudioSignature([face]).subjectExposure);
  });
  it('não declara assinatura aplicada em trecho sem pessoa detectada', () => {
    expect(() => suggestStudioSignature([{ subject: null, background: stats([128, 128, 128]), personPresent: false, facePresent: false }])).toThrow('destacar uma pessoa');
  });
});
