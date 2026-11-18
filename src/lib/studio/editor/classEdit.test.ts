import { describe, expect, it, vi } from 'vitest';
import { readStudioWaveform, studioWaveformPath } from './audioEnvelope';
import { findStudioPauses } from './classEdit';
import { findStudioRetakes } from './studioRetakes';

const source = vi.hoisted(() => ({
  packets: [] as { timestamp: number; buffer: Pick<AudioBuffer, 'sampleRate' | 'length' | 'numberOfChannels' | 'getChannelData'> }[],
  dispose: vi.fn(),
}));
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  Input: class {
    async getPrimaryAudioTrack() { return { canDecode: async () => true }; }
    dispose = source.dispose;
  },
  AudioBufferSink: class {
    async *buffers() { yield* source.packets; }
  },
}));

function packet(timestamp: number, length: number, level: number) {
  const samples = new Float32Array(length).fill(level);
  return { timestamp, buffer: { sampleRate: 1000, length, numberOfChannels: 1, getChannelData: () => samples } };
}

describe('detecção de pausas do Class Edit', () => {
  it('encurta uma pausa que atravessa pacotes, preserva respiro e encurta também as pontas', async () => {
    source.packets = [
      packet(0, 1000, 0), packet(1, 1000, .1),
      packet(2, 500, .001), packet(2.5, 700, .001),
      packet(3.2, 1000, .1), packet(4.2, 400, 0), packet(4.6, 400, .1), packet(5, 1000, 0),
    ];
    const pauses = await findStudioPauses(new Blob(), 0, 6, new AbortController().signal);
    expect(pauses).toHaveLength(4);
    expect(pauses[0].start).toBe(0);
    expect(pauses[0].end).toBeCloseTo(.995);
    expect(pauses[1].start).toBeCloseTo(2.005);
    expect(pauses[1].end).toBeCloseTo(3.195);
    expect(pauses[2].start).toBeCloseTo(4.205);
    expect(pauses[2].end).toBeCloseTo(4.595);
    expect(pauses[3].start).toBeCloseTo(5.005);
    expect(pauses[3].end).toBe(6);
    expect(source.dispose).toHaveBeenCalled();
  });

  it('encurta uma pausa com ruído de fundo acima do limiar antigo', async () => {
    source.packets = [packet(0, 8000, .22), packet(8, 1300, .018), packet(9.3, 9000, .21)];
    const pauses = await findStudioPauses(new Blob(), 0, 18.3, new AbortController().signal);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].start).toBeCloseTo(8.005);
    expect(pauses[0].end).toBeCloseTo(9.295);
  });

  it('encurta a espera até a primeira fala aos 2,8 s mesmo com som ambiente', async () => {
    source.packets = [packet(0, 2800, .018), packet(2.8, 15500, .21)];
    const pauses = await findStudioPauses(new Blob(), 0, 18.3, new AbortController().signal);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].start).toBe(0);
    expect(pauses[0].end).toBeCloseTo(2.795);
  });

  it('preserva voz baixa quando fica próxima do nível de fundo', async () => {
    source.packets = [packet(0, 1500, .04), packet(1.5, 1500, .022), packet(3, 1500, .04)];
    expect(await findStudioPauses(new Blob(), 0, 4.5, new AbortController().signal)).toEqual([]);
  });

  it('ignora ausência de amostras e um take inteiramente silencioso', async () => {
    const signal = new AbortController().signal;
    source.packets = [packet(0, 1000, .1), packet(1, 500, 0), packet(2, 500, 0), packet(2.5, 1000, .1)];
    expect(await findStudioPauses(new Blob(), 0, 4, signal)).toEqual([]);
    source.packets = [packet(0, 3000, 0)];
    expect(await findStudioPauses(new Blob(), 0, 3, signal)).toEqual([]);
  });
});

describe('forma de onda vinculada ao vídeo', () => {
  it('mostra pausas e usa o intervalo original do trecho após aparar ou dividir', async () => {
    source.packets = [packet(0, 1000, 0), packet(1, 1000, .5)];
    const waveform = await readStudioWaveform(new Blob(), 2, new AbortController().signal);
    expect(waveform).not.toBeNull();
    expect(studioWaveformPath(waveform!, 0, 1, 2)).toBe('M0 20 L0 20.0 L1 20.0 H2 V20 Z');
    expect(studioWaveformPath(waveform!, 1, 2, 2)).not.toBe('M0 20 L0 20.0 L1 20.0 H2 V20 Z');
  });

  it('comprime o ruído de fundo e mantém visíveis os níveis de fala', async () => {
    source.packets = [packet(0, 1000, .014), packet(1, 1000, .05), packet(2, 1000, .15)];
    const waveform = await readStudioWaveform(new Blob(), 3, new AbortController().signal);
    const quiet = waveform!.peaks[10], soft = waveform!.peaks[50], strong = waveform!.peaks[90];
    expect(quiet).toBe(0);
    expect(soft).toBeGreaterThan(20);
    expect(soft).toBeLessThan(strong);
    expect(strong).toBeGreaterThan(175);
  });

  it('mantém diferença entre picos fortes mesmo acima do percentil de referência', async () => {
    source.packets = [packet(0, 1000, .015), packet(1, 1000, .14), packet(2, 40, .35), packet(2.04, 40, .8)];
    const waveform = (await readStudioWaveform(new Blob(), 2.08, new AbortController().signal))!;
    expect(Math.max(...waveform.peaks)).toBeLessThan(255);
    const firstPeak = waveform.peaks[80], secondPeak = waveform.peaks.at(-1)!;
    expect(secondPeak).toBeGreaterThan(firstPeak);
    const maximumGain = studioWaveformPath(waveform, 2.06, 2.08, 1, 4);
    const peakY = Number(maximumGain.match(/L0 ([\d.]+)/)?.[1]);
    expect(peakY).toBeGreaterThanOrEqual(4);
    expect(peakY).toBeLessThan(6);
  });

  it('diferencia falta de amostras de um take sem pausas', async () => {
    source.packets = [];
    const signal = new AbortController().signal;
    expect(await readStudioWaveform(new Blob(), 2, signal)).toBeNull();
    await expect(findStudioPauses(new Blob(), 0, 2, signal)).rejects.toThrow('não conseguiu ler amostras');
  });
});

describe('revisão de takes repetidos do Class Edit', () => {
  it('agrupa três tentativas próximas mesmo com legendas divididas de forma diferente', () => {
    const cues = [
      { start: 1, end: 2, text: 'Hoje vamos aprender' },
      { start: 2, end: 4, text: 'a editar vídeos pelo celular.' },
      { start: 6, end: 9, text: 'Hoje nós vamos aprender a editar vídeos pelo celular.' },
      { start: 11, end: 14, text: 'Hoje vamos aprender a editar vídeos pelo celular.' },
      { start: 15, end: 18, text: 'Primeiro abra o aplicativo e importe a gravação.' },
      { start: 90, end: 93, text: 'Hoje vamos aprender a editar vídeos pelo celular.' },
    ];
    expect(findStudioRetakes(cues).map(group => group.map(cue => [cue.start, cue.end]))).toEqual([[[1, 4], [6, 9], [11, 14]]]);
  });
});
