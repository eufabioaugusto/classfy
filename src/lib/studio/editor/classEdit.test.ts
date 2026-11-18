import { describe, expect, it, vi } from 'vitest';
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
  it('encurta uma pausa que atravessa pacotes, preserva respiro e ignora pausas curtas e nas pontas', async () => {
    source.packets = [
      packet(0, 1000, 0), packet(1, 1000, .1),
      packet(2, 500, .001), packet(2.5, 700, .001),
      packet(3.2, 1000, .1), packet(4.2, 400, 0), packet(4.6, 400, .1), packet(5, 1000, 0),
    ];
    const pauses = await findStudioPauses(new Blob(), 0, 6, new AbortController().signal);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].start).toBeCloseTo(2.2);
    expect(pauses[0].end).toBeCloseTo(3);
    expect(source.dispose).toHaveBeenCalled();
  });

  it('encurta uma pausa com ruído de fundo acima do limiar antigo', async () => {
    source.packets = [packet(0, 8000, .22), packet(8, 1300, .018), packet(9.3, 9000, .21)];
    const pauses = await findStudioPauses(new Blob(), 0, 18.3, new AbortController().signal);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].start).toBeCloseTo(8.2);
    expect(pauses[0].end).toBeCloseTo(9.1);
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
