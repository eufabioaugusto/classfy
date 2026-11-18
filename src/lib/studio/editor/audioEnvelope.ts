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
  const peaks = new Uint8Array(Math.max(1, Math.min(36000, Math.ceil(duration * 40))));
  let decoded = false;
  for await (const window of studioAudioWindows(file, 0, duration, signal)) {
    decoded = true;
    const first = Math.min(peaks.length - 1, Math.floor(window.start / duration * peaks.length));
    const end = Math.min(peaks.length, Math.ceil(window.end / duration * peaks.length));
    const height = Math.round(Math.max(0, Math.min(1, (window.level + 55) / 49)) * 255);
    for (let index = first; index < end; index++) peaks[index] = Math.max(peaks[index], height);
  }
  return decoded ? { duration, peaks } : null;
}

export function studioWaveformPath({ duration, peaks }: StudioWaveform, start: number, end: number, columns: number): string {
  const points = ['M0 20'];
  for (let column = 0; column < columns; column++) {
    const from = Math.floor((start + (end - start) * column / columns) / duration * peaks.length);
    const to = Math.ceil((start + (end - start) * (column + 1) / columns) / duration * peaks.length);
    let peak = 0;
    for (let index = Math.max(0, from); index < Math.min(peaks.length, to); index++) peak = Math.max(peak, peaks[index]);
    points.push(`L${column} ${(20 - peak / 255 * 19).toFixed(1)}`);
  }
  return points.join(' ') + ` H${columns} V20 Z`;
}
