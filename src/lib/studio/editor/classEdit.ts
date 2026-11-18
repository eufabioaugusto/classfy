import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';

export type StudioPause = { start: number; end: number };

const minimumPause = .9;
const breathingRoom = .2;

// Decode a packet at a time to avoid holding the whole recording in memory.
export async function findStudioPauses(file: Blob, start: number, end: number, signal: AbortSignal): Promise<StudioPause[]> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    signal.throwIfAborted();
    if (!track || !await track.canDecode()) throw new Error('O Class Edit precisa de uma faixa de áudio que o navegador consiga ler.');

    const pauses: StudioPause[] = [];
    let heardSound = false;
    let quietSince: number | undefined;
    let previousEnd = start;
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(start, end)) {
      signal.throwIfAborted();
      const { sampleRate, length, numberOfChannels } = buffer;
      const channels = Array.from({ length: numberOfChannels }, (_, index) => buffer.getChannelData(index));
      const first = Math.max(0, Math.ceil((start - timestamp) * sampleRate));
      const last = Math.min(length, Math.floor((end - timestamp) * sampleRate));
      const windowSize = Math.round(sampleRate * .02);
      for (let offset = first; offset < last; offset += windowSize) {
        const from = timestamp + offset / sampleRate;
        const limit = Math.min(last, offset + windowSize);
        if (from - previousEnd > .03) {
          heardSound = false;
          quietSince = undefined;
        }
        previousEnd = timestamp + limit / sampleRate;

        const quiet = channels.every(samples => {
          let energy = 0;
          for (let index = offset; index < limit; index++) {
            const sample = samples[index];
            if (Math.abs(sample) >= .025) return false;
            energy += sample * sample;
          }
          return energy < (limit - offset) * .008 ** 2;
        });
        if (quiet) {
          if (heardSound) quietSince ??= from;
        } else {
          if (quietSince !== undefined && from - quietSince >= minimumPause) {
            pauses.push({ start: quietSince + breathingRoom, end: from - breathingRoom });
          }
          heardSound = true;
          quietSince = undefined;
        }
      }
    }
    signal.throwIfAborted();
    return pauses;
  } finally {
    input.dispose();
  }
}
