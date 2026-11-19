import { Tensor, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

export async function detectStudioCaptionLanguage(transcriber: AutomaticSpeechRecognitionPipeline, audio: Float32Array) {
  const config = transcriber.model.generation_config as typeof transcriber.model.generation_config & { lang_to_id: Record<string, number> };
  const { decoder_start_token_id: startId, lang_to_id: languages } = config;
  const sampleRate = 16000;
  const windowSize = sampleRate * 12;
  let bestStart = 0, bestEnergy = -1;
  for (let start = 0; start < audio.length; start += windowSize / 2) {
    let energy = 0;
    for (let i = start; i < Math.min(start + windowSize, audio.length); i += 32) {
      energy += Math.min(.01, audio[i] ** 2);
    }
    if (energy > bestEnergy) { bestEnergy = energy; bestStart = start; }
  }
  const features = await transcriber.processor(audio.subarray(bestStart, bestStart + windowSize));
  // Whisper predicts the language immediately after the start-of-transcript token.
  const { logits } = await transcriber.model({
    ...features,
    decoder_input_ids: new Tensor('int64', [BigInt(startId)], [1, 1]),
  });
  let bestLanguage = '', bestLogit = -Infinity;
  for (const [token, id] of Object.entries(languages)) {
    const score = Number(logits.data[id]);
    if (score > bestLogit) { bestLogit = score; bestLanguage = token.slice(2, -2); }
  }
  if (!bestLanguage) throw new Error('Não foi possível detectar o idioma do áudio.');
  return bestLanguage;
}
