import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';

export type StudioAudioWindow = { start: number; end: number; level: number };

export async function* studioAudioWindows(file: Blob, start: number, end: number, signal: AbortSignal): AsyncGenerator<StudioAudioWindow> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    signal.throwIfAborted();
    if (!track || !await track.canDecode()) return;
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(start, end)) {
      signal.throwIfAborted();
      const { sampleRate, length, numberOfChannels } = buffer;
      const channels = Array.from({ length: numberOfChannels }, (_, index) => buffer.getChannelData(index));
      const first = Math.max(0, Math.ceil((start - timestamp) * sampleRate));
      const last = Math.min(length, Math.floor((end - timestamp) * sampleRate));
      const windowSize = Math.max(1, Math.round(sampleRate * .02));
      for (let offset = first; offset < last; offset += windowSize) {
        const limit = Math.min(last, offset + windowSize);
        let maxEnergy = 0;
        for (const samples of channels) {
          let energy = 0;
          for (let index = offset; index < limit; index++) energy += samples[index] ** 2;
          maxEnergy = Math.max(maxEnergy, energy);
        }
        yield { start: timestamp + offset / sampleRate, end: timestamp + limit / sampleRate,
          level: Math.max(-90, Math.min(0, 10 * Math.log10(maxEnergy / (limit - offset)))) };
      }
    }
    signal.throwIfAborted();
  } finally {
    input.dispose();
  }
}

export type StudioWaveform = { duration: number; peaks: Uint8Array };

export async function readStudioWaveform(file: Blob, duration: number, signal: AbortSignal): Promise<StudioWaveform | null> {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const levels = new Float32Array(Math.max(1, Math.min(36000, Math.ceil(duration * 40)))).fill(-90);
  const histogram = new Uint32Array(91);
  let decoded = 0;
  for await (const window of studioAudioWindows(file, 0, duration, signal)) {
    histogram[Math.round(window.level) + 90]++;
    decoded++;
    const first = Math.max(0, Math.floor(window.start / duration * levels.length));
    const end = Math.min(levels.length, Math.ceil(window.end / duration * levels.length));
    for (let index = first; index < end; index++) levels[index] = Math.max(levels[index], window.level);
  }
  if (!decoded) return null;

  const percentile = (fraction: number) => {
    let count = 0;
    for (let i = 0; i < histogram.length; i++) {
      count += histogram[i];
      if (count >= decoded * fraction) return i - 90;
    }
    return 0;
  };
  const background = percentile(.2), strong = percentile(.95);
  // Require a clear contrast before treating quiet windows as a noise floor.
  const floor = strong - background >= 12 ? Math.min(-27, Math.max(-55, background + 5)) : -55;
  const ceiling = Math.min(0, Math.max(-18, strong, floor + 16));
  const peaks = Uint8Array.from(levels, level => {
    const intensity = Math.max(0, (level - floor) / (ceiling - floor));
    // Leave headroom above the reference percentile instead of flattening loud syllables.
    const height = intensity <= 1 ? .73 * intensity ** 1.25 : .73 + .23 * (1 - Math.exp(-(intensity - 1) * 2));
    return Math.round(height * 255);
  });
  return { duration, peaks };
}

export function studioWaveformPath({ duration, peaks }: StudioWaveform, start: number, end: number, columns: number, gain = 1): string {
  const points = ['M0 20'];
  for (let column = 0; column < columns; column++) {
    const from = Math.floor((start + (end - start) * column / columns) / duration * peaks.length);
    const to = Math.ceil((start + (end - start) * (column + 1) / columns) / duration * peaks.length);
    let peak = 0;
    for (let index = Math.max(0, from); index < Math.min(peaks.length, to); index++) peak = Math.max(peak, peaks[index]);
    const normalized = peak / 255;
    const height = gain <= 1 ? normalized * Math.max(0, gain) : 1 - (1 - normalized) ** gain;
    points.push(`L${column} ${(20 - height * 19).toFixed(1)}`);
  }
  return points.join(' ') + ` H${columns} V20 Z`;
}
