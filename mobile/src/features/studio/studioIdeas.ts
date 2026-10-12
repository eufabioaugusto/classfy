import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { parseStudioIdeasContext, parseStudioIdeasScript, parseStudioIdeasSuggestions, studioIdeasFriendlyError, StudioIdeasRequestError, type StudioIdeasRequest } from './studioIdeasContract';
export * from './studioIdeasContract';

export const newStudioIdeasRequestId = () => Crypto.randomUUID();
export async function requestStudioIdeas(request: StudioIdeasRequest, signal?: AbortSignal) {
  let response;
  try { response = await supabase.functions.invoke('studio-ideas', { body: request, signal, timeout: 90000 }); }
  catch { throw new StudioIdeasRequestError('transport', studioIdeasFriendlyError('transport')); }
  const { data, error } = response;
  if (signal?.aborted) throw new Error('Pedido interrompido.');
  if (error || data?.error) {
    let detail: { code?: unknown; retryAfterSeconds?: unknown } = data || {};
    if (error && error.context && typeof error.context.json === 'function') {
      try { detail = await error.context.clone().json(); } catch { /* Keep the safe generic message. */ }
    }
    throw new StudioIdeasRequestError(typeof detail.code === 'string' ? detail.code : 'transport', studioIdeasFriendlyError(detail.code, detail.retryAfterSeconds));
  }
  try {
    if (request.action === 'context') return parseStudioIdeasContext(data);
    if (request.action === 'suggest') return parseStudioIdeasSuggestions(data);
    return parseStudioIdeasScript(data, request);
  } catch { throw new StudioIdeasRequestError('invalid_response', 'A Classy não conseguiu montar esse conteúdo. Tente novamente.'); }
}
