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

    const windows: { start: number; end: number; level: number }[] = [];
    const histogram = new Uint32Array(91);
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
        let maxEnergy = 0;
        for (const samples of channels) {
          let energy = 0;
          for (let index = offset; index < limit; index++) energy += samples[index] ** 2;
          maxEnergy = Math.max(maxEnergy, energy);
        }
        const level = Math.max(-90, Math.min(0, 10 * Math.log10(maxEnergy / (limit - offset))));
        histogram[Math.round(level) + 90]++;
        windows.push({ start: from, end: timestamp + limit / sampleRate, level });
      }
    }
    signal.throwIfAborted();
    const percentile = (fraction: number) => {
      const rank = Math.max(1, Math.ceil(windows.length * fraction));
      let count = 0;
      return histogram.findIndex(size => (count += size) >= rank) - 90;
    };
    // Allow room tone above the old fixed gate, but keep the gate well below
    // foreground audio. A flat or entirely quiet track never produces a cut.
    const noiseFloor = percentile(.05), foreground = percentile(.9);
    const threshold = Math.min(-30, foreground - 12, Math.max(-42, noiseFloor + 6));
    const pauses: StudioPause[] = [];
    let heardSound = false;
    let quietSince: number | undefined;
    let previousEnd = start;
    for (const window of windows) {
      if (window.start - previousEnd > .03) {
        heardSound = false;
        quietSince = undefined;
      }
      previousEnd = window.end;
      if (window.level < threshold) {
        if (heardSound) quietSince ??= window.start;
      } else {
        if (quietSince !== undefined && window.start - quietSince >= minimumPause) {
          pauses.push({ start: quietSince + breathingRoom, end: window.start - breathingRoom });
        }
        heardSound = true;
        quietSince = undefined;
      }
    }
    return pauses;
  } finally {
    input.dispose();
  }
}
