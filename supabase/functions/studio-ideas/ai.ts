import { requestAiTextCompletion } from '../_shared/ai-provider.ts';
import { generationPrompt, IdeasError, type IdeasDependencies } from './core.ts';

export interface AiDiagnostic {
  provider: 'gemini' | 'openrouter' | 'lovable' | 'none' | 'unknown';
  status: number | null;
  finishReason: string;
  charLength: number;
}
export class IdeasAiError extends IdeasError {
  constructor(code: 'ai_unavailable' | 'ai_invalid_response', message: string, public diagnostic: AiDiagnostic) {
    super(code, message, 503);
  }
}
type Completion = typeof requestAiTextCompletion;
type GenerationInput = Parameters<IdeasDependencies['generate']>[0];
const FINISH_REASONS = new Set([
  'STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT',
  'SPII', 'MALFORMED_FUNCTION_CALL', 'IMAGE_SAFETY', 'UNEXPECTED_TOOL_CALL', 'NO_IMAGE',
  'FINISH_REASON_UNSPECIFIED', 'stop', 'length', 'content_filter', 'tool_calls', 'error',
]);
function safeDiagnostic(result: Awaited<ReturnType<Completion>>): AiDiagnostic {
  const finish = result.data?.candidates?.[0]?.finishReason ?? result.data?.choices?.[0]?.finish_reason;
  return {
    provider: ['gemini', 'openrouter', 'lovable', 'none'].includes(result.provider) ? result.provider : 'unknown',
    status: Number.isInteger(result.response.status) ? result.response.status : null,
    finishReason: typeof finish === 'string' && FINISH_REASONS.has(finish) ? finish : 'UNKNOWN',
    charLength: typeof result.text === 'string' ? result.text.length : 0,
  };
}
export async function generateStudioIdeas(
  input: GenerationInput,
  completion: Completion = requestAiTextCompletion,
  report: (diagnostic: AiDiagnostic) => void = diagnostic => console.warn('[studio-ideas-ai]', diagnostic),
): Promise<unknown> {
  const prompts = generationPrompt(input);
  let result: Awaited<ReturnType<Completion>>;
  try {
    result = await completion({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: prompts.systemPrompt },
        { role: 'user', content: `${prompts.userPrompt}\nRetorne APENAS JSON válido seguindo exatamente esta estrutura:\n${prompts.schemaHint}` },
      ],
      temperature: input.action === 'suggest' ? 0.7 : 0.4,
      maxTokens: prompts.maxTokens,
      responseMimeType: 'application/json',
    });
  } catch {
    const diagnostic: AiDiagnostic = { provider: 'unknown', status: null, finishReason: 'UNKNOWN', charLength: 0 };
    report(diagnostic);
    throw new IdeasAiError('ai_unavailable', 'A Classy está indisponível no momento. Tente novamente em alguns minutos.', diagnostic);
  }
  const diagnostic = safeDiagnostic(result);
  // The shared JSON helper parses before checking HTTP status. This adapter
  // classifies provider failures first and never logs payloads or user context.
  if (!result.response.ok) {
    report(diagnostic);
    throw new IdeasAiError('ai_unavailable', 'A Classy está indisponível no momento. Tente novamente em alguns minutos.', diagnostic);
  }
  const text = result.text?.trim() ?? '';
  if (!text || ['MAX_TOKENS', 'length', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'content_filter'].includes(diagnostic.finishReason)) {
    report(diagnostic);
    throw new IdeasAiError('ai_invalid_response', 'A Classy não conseguiu preparar uma resposta completa. Tente novamente.', diagnostic);
  }
  // Some gateways wrap a valid object in a Markdown fence; no recovery of
  // truncated JSON or arbitrary surrounding text is attempted.
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  try { return JSON.parse(fenced?.[1]?.trim() || text); }
  catch {
    report(diagnostic);
    throw new IdeasAiError('ai_invalid_response', 'A Classy não conseguiu preparar uma resposta válida. Tente novamente.', diagnostic);
  }
}
