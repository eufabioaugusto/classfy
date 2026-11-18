import { TextStreamer, pipeline } from '@huggingface/transformers';

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
    self.postMessage({ stage: transcriptionStage, progress: 0 });
    const chunkSeconds = 27, strideSeconds = 4;
    const duration = data.audio.length / 16000;
    const chunkCount = 1 + Math.ceil(Math.max(0, duration - chunkSeconds) / (chunkSeconds - 2 * strideSeconds));
    let completed = 0;
    const streamer = new class extends TextStreamer {
      put() {}
      end() { self.postMessage({ stage: transcriptionStage, progress: Math.min(1, ++completed / chunkCount) }); }
    }(transcribe.tokenizer);
    const result = await transcribe(data.audio, {
      language: data.language || undefined,
      task: 'transcribe',
      return_timestamps: 'word',
      chunk_length_s: chunkSeconds,
      stride_length_s: strideSeconds,
      streamer,
    });
    self.postMessage({ chunks: (Array.isArray(result) ? result[0] : result).chunks ?? [] });
  } catch {
    self.postMessage({ error: 'Não foi possível carregar o modelo ou transcrever neste navegador. Tente novamente ou importe um SRT.' });
  }
};
