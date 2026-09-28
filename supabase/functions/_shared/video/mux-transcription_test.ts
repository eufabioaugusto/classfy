import { MuxVideoProvider } from './mux.ts';

Deno.test('transcrição Mux usa áudio pronto e URL assinada sem tornar playback público', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PRIVATE KEY-----`;
  const values: Record<string,string> = { MUX_TOKEN_ID: 'test', MUX_TOKEN_SECRET: 'test', MUX_SIGNING_KEY_ID: 'test-key', MUX_SIGNING_PRIVATE_KEY: btoa(pem) };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Deno.env.get(key)]));
  for (const [key,value] of Object.entries(values)) Deno.env.set(key,value);
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(`${init?.method || 'GET'} ${input}`);
    return new Response(JSON.stringify({ data: { static_renditions: { files: [{ name: 'audio.m4a', status: 'ready' }] } } }));
  };
  try {
    const result = await new MuxVideoProvider().getTranscriptionSource({ provider_asset_id: 'asset-1', provider_playback_id: 'playback-1' }, { duration_seconds: 150 });
    const url = new URL(result.url);
    if (url.pathname !== '/playback-1/audio.m4a' || !url.searchParams.get('token')) throw new Error('Fonte não assinada');
    if (result.mimeType !== 'audio/mp4' || requests.length !== 1 || !requests[0].startsWith('GET ')) throw new Error('Alteração indevida de playback');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key,value] of Object.entries(previous)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key,value);
  }
});

Deno.test('transcrição recusa mídia sem vínculo pronto', async () => {
  try { await new MuxVideoProvider().getTranscriptionSource({}, {}); }
  catch (error) { if (String(error).includes('não está pronta')) return; throw error; }
  throw new Error('Deveria recusar mídia incompleta');
});
