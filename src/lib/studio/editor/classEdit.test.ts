import { describe, expect, it, vi } from 'vitest';
import { readStudioWaveform, studioWaveformPath } from './audioEnvelope';
import { findStudioPauses } from './classEdit';

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
    expect(pauses).toHaveLength(3);
    expect(pauses[0].start).toBe(0);
    expect(pauses[0].end).toBeCloseTo(.8);
    expect(pauses[1].start).toBeCloseTo(2.2);
    expect(pauses[1].end).toBeCloseTo(3);
    expect(pauses[2].start).toBeCloseTo(5.2);
    expect(pauses[2].end).toBe(6);
    expect(source.dispose).toHaveBeenCalled();
  });

  it('encurta uma pausa com ruído de fundo acima do limiar antigo', async () => {
    source.packets = [packet(0, 8000, .22), packet(8, 1300, .018), packet(9.3, 9000, .21)];
    const pauses = await findStudioPauses(new Blob(), 0, 18.3, new AbortController().signal);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].start).toBeCloseTo(8.2);
    expect(pauses[0].end).toBeCloseTo(9.1);
  });

  it('encurta a espera até a primeira fala aos 2,8 s mesmo com som ambiente', async () => {
    source.packets = [packet(0, 2800, .018), packet(2.8, 15500, .21)];
    const pauses = await findStudioPauses(new Blob(), 0, 18.3, new AbortController().signal);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].start).toBe(0);
    expect(pauses[0].end).toBeCloseTo(2.6);
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
    expect(studioWaveformPath(waveform!, 1, 2, 2)).toBe('M0 20 L0 1.0 L1 1.0 H2 V20 Z');
  });

  it('comprime o ruído de fundo e mantém visíveis os níveis de fala', async () => {
    source.packets = [packet(0, 1000, .014), packet(1, 1000, .05), packet(2, 1000, .15)];
    const waveform = await readStudioWaveform(new Blob(), 3, new AbortController().signal);
    const quiet = waveform!.peaks[10], soft = waveform!.peaks[50], strong = waveform!.peaks[90];
    expect(quiet).toBe(0);
    expect(soft).toBeGreaterThan(20);
    expect(soft).toBeLessThan(strong);
    expect(strong).toBeGreaterThan(230);
  });

  it('diferencia falta de amostras de um take sem pausas', async () => {
    source.packets = [];
    const signal = new AbortController().signal;
    expect(await readStudioWaveform(new Blob(), 2, signal)).toBeNull();
    await expect(findStudioPauses(new Blob(), 0, 2, signal)).rejects.toThrow('não conseguiu ler amostras');
  });
});
