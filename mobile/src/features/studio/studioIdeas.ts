import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { parseStudioIdeasContext, parseStudioIdeasScript, parseStudioIdeasSuggestions, studioIdeasFriendlyError, StudioIdeasRequestError, type StudioIdeasRequest } from './studioIdeasContract';
export * from './studioIdeasContract';

export const newStudioIdeasRequestId = () => Crypto.randomUUID();
export async function requestStudioIdeas(request: StudioIdeasRequest, signal: AbortSignal | undefined, expectedOwner: string, isCurrent: () => boolean = () => true) {
  if (signal?.aborted || !isCurrent()) throw new StudioIdeasRequestError('interrupted', 'Pedido interrompido.');
  // Freeze the token belonging to the account that supplied this form. The
  // Functions client otherwise resolves whichever session exists later.
  let accessToken: string;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (signal?.aborted || !isCurrent()) throw new StudioIdeasRequestError('interrupted', 'Pedido interrompido.');
    if (error || !data.session?.access_token || data.session.user.id !== expectedOwner) throw new StudioIdeasRequestError('unauthorized', studioIdeasFriendlyError('unauthorized'));
    accessToken = data.session.access_token;
  } catch (cause) { if (cause instanceof StudioIdeasRequestError) throw cause; throw new StudioIdeasRequestError('unauthorized', studioIdeasFriendlyError('unauthorized')); }
  let response;
  if (signal?.aborted || !isCurrent()) throw new StudioIdeasRequestError('interrupted', 'Pedido interrompido.');
  try { response = await supabase.functions.invoke('studio-ideas', { body: request, signal, timeout: 90000, headers: { Authorization: `Bearer ${accessToken}` } }); }
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
    if (request.action === 'context' || request.action === 'save_editorial') return parseStudioIdeasContext(data);
    if (request.action === 'suggest') return parseStudioIdeasSuggestions(data);
    return parseStudioIdeasScript(data, request);
  } catch { throw new StudioIdeasRequestError('invalid_response', 'A Classy não conseguiu montar esse conteúdo. Tente novamente.'); }
}
