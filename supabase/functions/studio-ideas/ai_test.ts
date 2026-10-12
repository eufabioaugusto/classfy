import { generateStudioIdeas, IdeasAiError, type AiDiagnostic } from './ai.ts';
import type { IdeasContext } from './core.ts';

const context: IdeasContext = {
  categories: [], recentContents: [],
  source: { type: 'category', label: 'Categoria: Design', categoryId: '33333333-3333-4333-8333-333333333333', contentIds: [] },
};
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
async function errorCode(call: () => Promise<unknown>, code: string): Promise<IdeasAiError> {
  try { await call(); throw new Error('Expected failure'); }
  catch (error) { assert(error instanceof IdeasAiError); equal(error.code, code); return error; }
}
function result(status: number, text: string, finishReason: unknown = 'STOP') {
  return { provider: 'gemini' as const, response: new Response('{}', { status }), text, data: { candidates: [{ finishReason }], error: { message: 'private provider diagnostic' } } };
}

Deno.test('AI adapter checks HTTP before parsing empty or invalid provider output', async () => {
  const diagnostics: AiDiagnostic[] = [];
  for (const text of ['', '{invalid']) {
    const error = await errorCode(() => generateStudioIdeas({ action: 'suggest', context }, async () => result(429, text), item => diagnostics.push(item)), 'ai_unavailable');
    equal(error.diagnostic.status, 429);
  }
  equal(diagnostics.length, 2); equal(Object.keys(diagnostics[0]), ['provider', 'status', 'finishReason', 'charLength']);
  assert(!JSON.stringify(diagnostics).includes('private provider diagnostic'));
});
Deno.test('AI adapter classifies a successful HTTP response with invalid JSON separately', async () => {
  const diagnostics: AiDiagnostic[] = [];
  const error = await errorCode(() => generateStudioIdeas({ action: 'suggest', context }, async () => result(200, '{invalid'), item => diagnostics.push(item)), 'ai_invalid_response');
  equal(error.diagnostic, { provider: 'gemini', status: 200, finishReason: 'STOP', charLength: 8 });
  equal(diagnostics.length, 1);
});
Deno.test('AI adapter rejects token-truncated and empty output without treating it as complete JSON', async () => {
  for (const text of ['', '{"suggestions":[]}']) {
    const error = await errorCode(() => generateStudioIdeas({ action: 'suggest', context }, async () => result(200, text, 'MAX_TOKENS'), () => {}), 'ai_invalid_response');
    equal(error.diagnostic.finishReason, 'MAX_TOKENS');
  }
});
Deno.test('AI adapter returns plain/fenced JSON and leaves semantic validation to core', async () => {
  for (const text of ['{"suggestions":[]}', '```json\n{"suggestions":[]}\n```']) {
    const output = await generateStudioIdeas({ action: 'suggest', context }, async () => result(200, text), () => { throw new Error('success should not emit diagnostic'); });
    equal(output, { suggestions: [] });
  }
});
Deno.test('AI adapter diagnostic allowlist excludes arbitrary provider values or user content', async () => {
  const diagnostics: AiDiagnostic[] = [];
  const error = await errorCode(() => generateStudioIdeas({ action: 'suggest', context }, async () => result(200, 'private script content', 'secret arbitrary finish reason'), item => diagnostics.push(item)), 'ai_invalid_response');
  equal(error.diagnostic.finishReason, 'UNKNOWN');
  assert(!JSON.stringify(diagnostics).includes('private script content'));
  assert(!JSON.stringify(diagnostics).includes('secret arbitrary finish reason'));
});
Deno.test('AI adapter masks transport errors, never forwarding original exception text', async () => {
  const error = await errorCode(() => generateStudioIdeas({ action: 'suggest', context }, async () => { throw new Error('secret token diagnostic'); }, () => {}), 'ai_unavailable');
  equal(error.diagnostic.status, null); assert(!error.message.includes('secret'));
});
Deno.test('AI adapter requests structured JSON with enough output budget for reasoning and a long script', async () => {
  for (const input of [
    { action: 'suggest' as const, context },
    { action: 'script' as const, context, kind: 'aula' as const, durationMinutes: 10 },
  ]) {
    await generateStudioIdeas(input, async options => {
      equal(options.responseMimeType, 'application/json');
      equal(options.maxTokens, input.action === 'suggest' ? 6000 : 8192);
      assert(options.messages.some(item => item.content.includes('Retorne APENAS JSON válido')));
      return result(200, '{}');
    }, () => {});
  }
});
