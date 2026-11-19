import { describe, expect, it } from 'vitest';
import { compileStudioRecipe, emptyStudioEditing, studioTicks, validateStudioRecipe, withStudioTakes, type StudioEditing } from '../../../../shared/studio';
import { addCaptionTrack } from './commands';
import { studioPromotionCues, studioPromotionRecipe, suggestStudioPromotionCuts } from './studioPromotionClips';

const terms = 'Como descobrir um caminho melhor quando uma decisão importante aparece e precisamos pensar com calma antes de tomar a próxima atitude.';
const cue = (start: number, end = start + 16, text = terms) => ({ start, end, text });

describe('cortes para divulgar', () => {
  it('prioriza três trechos completos sem sobreposição e mantém a ordem da montagem', () => {
    const cuts = suggestStudioPromotionCuts([cue(0), cue(16), cue(32), cue(48)]);
    expect(cuts).toHaveLength(3);
    for (const [index, cut] of cuts.entries()) {
      expect(cut.end - cut.start).toBeGreaterThanOrEqual(12);
      expect(cut.end - cut.start).toBeLessThanOrEqual(60);
      if (index) expect(cut.start).toBeGreaterThanOrEqual(cuts[index - 1].end);
    }
  });

  it('usa uma pausa como fronteira de fala e retorna os cortes disponíveis', () => {
    expect(suggestStudioPromotionCuts([cue(0, 16, terms.slice(0, -1)), cue(18, 34)])).toHaveLength(2);
    expect(suggestStudioPromotionCuts([cue(0, 4)])).toEqual([]);
  });

  it('recorta o original em velocidade reduzida e reposiciona as legendas na saída vertical', () => {
    const editing: StudioEditing = emptyStudioEditing('aula');
    editing.assets = [{ id: 'video', name: 'Original', uri: 'file:///original.mp4', kind: 'video',
      durationTicks: studioTicks(40), width: 1920, height: 1080, hasAudio: true }];
    editing.main = [{ id: 'take', assetId: 'video', sourceStartTicks: 0, sourceEndTicks: studioTicks(40), playbackRate: .5, mask: 'ellipse' }];
    const source = compileStudioRecipe(addCaptionTrack(withStudioTakes({
      id: 'project', ownerId: 'owner', kind: 'aula', editing,
    }), [cue(4, 6, 'Primeira frase'), cue(40, 42, 'Segunda frase')], {}));
    const cut = studioPromotionRecipe(source, { start: 4.00001, end: 22.00002, title: 'Corte' }, .7);
    expect(validateStudioRecipe(cut)).toEqual([]);
    expect([cut.output.width, cut.output.height]).toEqual([1080, 1920]);
    expect(cut.clips.find(clip => clip.id === 'take')).toMatchObject({ startTicks: 0, playbackRate: .5, mask: 'ellipse' });
    expect(cut.clips.find(clip => clip.kind === 'caption')).toMatchObject({ startTicks: 0, rect: { y: .68 }, text: { alignment: 'center' } });
    expect(studioPromotionCues(cut).map(item => item.text)).toEqual(['Primeira frase']);
    expect(studioPromotionCues(source)).toHaveLength(2);
  });
});
