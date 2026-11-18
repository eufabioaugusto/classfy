import { pipeline } from '@huggingface/transformers';

self.onmessage = async ({ data }: MessageEvent<{ audio: Float32Array; language: string }>) => {
  try {
    const transcribe = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base_timestamped', {
      revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e',
      device: 'wasm',
      dtype: 'q8',
      progress_callback: event => {
        if (event.status === 'initiate') self.postMessage({ stage: 'Preparando modelo de voz' });
      },
    });
    self.postMessage({ stage: 'Transcrevendo áudio' });
    const result = await transcribe(data.audio, {
      language: data.language || undefined,
      task: 'transcribe',
      return_timestamps: 'word',
      chunk_length_s: 27,
      stride_length_s: 4,
    });
    self.postMessage({ chunks: (Array.isArray(result) ? result[0] : result).chunks ?? [] });
  } catch {
    self.postMessage({ error: 'Não foi possível carregar o modelo ou transcrever neste navegador. Tente novamente ou importe um SRT.' });
  }
};
