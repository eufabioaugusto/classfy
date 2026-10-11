import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createGoogleAuthorizeURL, createPKCEVerifier, toBase64URLDigest } from './oauthPkce.ts';
import {
  createOAuthCallbackCoordinator, GOOGLE_OAUTH_REDIRECT, MobileOAuthError,
  OAUTH_ATTEMPT_TTL_MS, parseOAuthCallback, readPendingOAuthAttempt, resolveAuthDestination,
} from './oauth.ts';

const attemptId = '00ba2c64-c5ed-46f7-a658-d2e61ac50c56';
const contentId = '9aa3eab6-4235-4bd9-9cb1-a0f6d5c01234';
const liveId = 'bfb1fe54-cb70-4bfb-8a52-0a7fa703c388';
const callback = (query = 'code=one-time-code') => `${GOOGLE_OAUTH_REDIRECT}?attempt=${attemptId}&${query}`;

test('retoma live e conteúdo apenas com IDs válidos, priorizando live', () => {
  assert.deepEqual(resolveAuthDestination({ contentId }), { pathname: '/watch/[id]', params: { id: contentId } });
  assert.deepEqual(resolveAuthDestination({ contentId, liveId }), { pathname: '/live/[id]', params: { id: liveId } });
  for (const unsafe of ['https://evil.example', '../admin', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz']) {
    assert.equal(resolveAuthDestination({ contentId: unsafe, liveId: unsafe }), '/(tabs)');
  }
});

test('callback aceita somente código PKCE no esquema e caminho do app', () => {
  assert.equal(parseOAuthCallback(callback()).code, 'one-time-code');
  for (const unsafe of [
    `https://evil.example/auth/callback?attempt=${attemptId}&code=stolen`,
    `classfy://auth/other?attempt=${attemptId}&code=stolen`,
    `classfy://other@auth/callback?attempt=${attemptId}&code=stolen`,
    `${GOOGLE_OAUTH_REDIRECT}?code=missing-attempt`,
    callback('access_token=token&refresh_token=token'),
    `${callback()}#access_token=token`,
  ]) {
    assert.throws(() => parseOAuthCallback(unsafe), MobileOAuthError);
  }
});

test('destino persiste entre reinícios e tentativa vencida ou adulterada é rejeitada', () => {
  const now = 1770000000000;
  const pending = { id: attemptId, createdAt: now, destination: resolveAuthDestination({ contentId }) };
  assert.deepEqual(readPendingOAuthAttempt(JSON.stringify(pending), now + 1000), pending);
  assert.equal(readPendingOAuthAttempt(JSON.stringify(pending), now + OAUTH_ATTEMPT_TTL_MS + 1), null);
  assert.equal(readPendingOAuthAttempt(JSON.stringify(pending), now - 1), null);
  assert.equal(readPendingOAuthAttempt(JSON.stringify({ ...pending, destination: 'https://evil.example' }), now), null);
  assert.equal(readPendingOAuthAttempt('{invalid', now), null);
});

function setup(exchangeCode = async () => {}) {
  let pending = { id: attemptId, createdAt: Date.now(), destination: resolveAuthDestination({ contentId }) };
  const exchanges = [];
  const clears = [];
  const complete = createOAuthCallbackCoordinator({
    readPending: async () => pending,
    clearPending: async (id) => { clears.push(id); pending = null; },
    exchangeCode: async (code) => { exchanges.push(code); await exchangeCode(code); },
  });
  return { complete, exchanges, clears };
}

test('browser e Expo Router simultâneos trocam código uma única vez', async () => {
  const { complete, exchanges, clears } = setup();
  const [browser, router] = await Promise.all([complete(callback()), complete(callback())]);
  assert.deepEqual(browser, { status: 'success', destination: resolveAuthDestination({ contentId }) });
  assert.deepEqual(router, browser);
  assert.deepEqual(exchanges, ['one-time-code']);
  assert.deepEqual(clears, [attemptId]);
  assert.deepEqual(await complete(callback()), browser);
});

test('callback de outra tentativa não troca código nem apaga a sessão pendente', async () => {
  const { complete, exchanges, clears } = setup();
  await assert.rejects(complete(callback().replace(attemptId, liveId)), { code: 'callback' });
  assert.deepEqual(exchanges, []);
  assert.deepEqual(clears, []);
});

test('cancelamento Google volta em silêncio e remove somente a tentativa atual', async () => {
  const { complete, exchanges, clears } = setup();
  assert.deepEqual(await complete(callback('error=access_denied')), { status: 'cancelled' });
  assert.deepEqual(exchanges, []);
  assert.deepEqual(clears, [attemptId]);
});

test('recusa de consentimento no fragmento também cancela em silêncio', async () => {
  const { complete, exchanges } = setup();
  assert.deepEqual(await complete(`${GOOGLE_OAUTH_REDIRECT}?attempt=${attemptId}#error=access_denied`), { status: 'cancelled' });
  assert.deepEqual(exchanges, []);
});

test('falha da troca não vaza detalhes do provedor nem redireciona como sucesso', async () => {
  const { complete, clears } = setup(async () => { throw new Error('sensitive backend detail'); });
  await assert.rejects(complete(callback()), (error) => error.code === 'exchange'
    && !error.message.includes('sensitive'));
  assert.deepEqual(clears, [attemptId]);
});

test('authorize solicita S256 com desafio SHA-256 e verifier não aparece na URL', () => {
  const verifier = createPKCEVerifier(randomBytes(32));
  assert.match(verifier, /^[0-9a-f]{64}$/);
  const challenge = toBase64URLDigest(createHash('sha256').update(verifier).digest('base64'));
  const url = new URL(createGoogleAuthorizeURL('https://example.supabase.co', GOOGLE_OAUTH_REDIRECT, challenge));
  assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.href.includes(verifier), false);
  assert.throws(() => createGoogleAuthorizeURL('https://example.supabase.co', GOOGLE_OAUTH_REDIRECT, verifier));
});

test('SDK Supabase usa o verifier nativo persistido na troca e limpa após sucesso', async () => {
  const store = new Map();
  const verifier = createPKCEVerifier(randomBytes(32));
  const storageKey = 'sb-example-auth-token';
  store.set(`${storageKey}-code-verifier`, JSON.stringify(verifier));
  let requestedBody;
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) } },
    global: { fetch: async (url, options) => {
      assert.equal(String(url), 'https://example.supabase.co/auth/v1/token?grant_type=pkce');
      requestedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_in: 3600, token_type: 'bearer',
        user: { id: contentId, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const { data, error } = await client.auth.exchangeCodeForSession('one-time-code');
  assert.equal(error, null);
  assert.equal(data.session.user.id, contentId);
  assert.deepEqual(requestedBody, { auth_code: 'one-time-code', code_verifier: verifier });
  assert.equal(store.has(`${storageKey}-code-verifier`), false);
});
