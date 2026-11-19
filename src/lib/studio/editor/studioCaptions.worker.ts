import { pipeline } from '@huggingface/transformers';
import { detectStudioCaptionLanguage } from './studioCaptionLanguage';

self.onmessage = async ({ data }: MessageEvent<{ audio: Float32Array; language: string }>) => {
  try {
    const modelStage = 'Preparando modelo de voz';
    const transcriptionStage = 'Transcrevendo áudio';
    const files = new Map<string, { loaded: number; total: number }>();
    self.postMessage({ stage: modelStage, progress: 0 });
    const transcribe = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base_timestamped', {
      revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e',
      device: 'wasm',
      dtype: 'q8',
      progress_callback: event => {
        if (event.status === 'progress' && event.total > 0) {
          files.set(event.file, { loaded: event.loaded, total: event.total });
        } else if (event.status === 'done') {
          const file = files.get(event.file);
          if (file) file.loaded = file.total;
        } else return;
        let loaded = 0, total = 0;
        for (const file of files.values()) { loaded += file.loaded; total += file.total; }
        if (total) self.postMessage({ stage: modelStage, progress: loaded / total });
      },
    });
    if (!data.language) self.postMessage({ stage: 'Detectando idioma' });
    const language = data.language || await detectStudioCaptionLanguage(transcribe, data.audio);
    self.postMessage({ stage: transcriptionStage, progress: 0 });
    const sampleRate = 16000;
    const windowSize = 20 * sampleRate;
    const context = 4 * sampleRate;
    const chunks: { text: string; timestamp: [number, number] }[] = [];
    for (let offset = 0; offset < data.audio.length; offset += windowSize) {
      const end = Math.min(offset + windowSize, data.audio.length);
      const from = Math.max(0, offset - context);
      const to = Math.min(data.audio.length, end + context);
      const result = await transcribe(data.audio.subarray(from, to), {
        language,
        task: 'transcribe',
        return_timestamps: 'word',
      });
      for (const word of (Array.isArray(result) ? result[0] : result).chunks ?? []) {
        const [start, stop] = word.timestamp;
        if (!Number.isFinite(start)) continue;
        const absoluteStart = Math.max(0, start) + from / sampleRate;
        const absoluteEnd = Math.min(to / sampleRate, (stop ?? start + .5) + from / sampleRate);
        const midpoint = (absoluteStart + absoluteEnd) / 2;
        if (absoluteEnd > absoluteStart && midpoint >= offset / sampleRate && midpoint < end / sampleRate) {
          chunks.push({ text: word.text, timestamp: [absoluteStart, absoluteEnd] });
        }
      }
      self.postMessage({ stage: transcriptionStage, progress: end / data.audio.length });
    }
    self.postMessage({ chunks });
  } catch {
    self.postMessage({ error: 'Não foi possível carregar o modelo ou transcrever neste navegador. Tente novamente ou importe um SRT.' });
  }
};
