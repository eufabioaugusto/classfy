import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCreatorRole } from './primaryAction.ts';
test('publicação segue papéis do web, inclusive contas com múltiplos papéis', () => {
  assert.equal(resolveCreatorRole(['user', 'creator']), 'creator');
  assert.equal(resolveCreatorRole(['creator', 'admin', 'user']), 'admin');
  assert.equal(resolveCreatorRole(['user']), 'user');
});
test('ausência de papel e status de candidatura não concedem publicação', () => {
  for (const roles of [
    [],
    ['pending'],
    ['approved'],
    ['rejected'],
    ['unknown'],
  ])
    assert.equal(resolveCreatorRole(roles), 'user');
});

// Uses the installed SDK: duplicate topics return the same channel even before
// cleanup finishes. Separate screen mounts must own independent subscriptions.
import { createClient } from '@supabase/supabase-js';
import { nextRealtimeTopic } from '../../lib/realtimeTopic.ts';
test('cabeçalhos simultâneos e remontagens recebem canais independentes', async () => {
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assert.equal(client.channel('shared'), client.channel('shared'));
  for (const scope of [
    'mobile-header-test',
    'mobile-unread-test',
    'mobile-primary-role-test',
  ]) {
    const first = client.channel(nextRealtimeTopic(scope));
    const second = client.channel(nextRealtimeTopic(scope));
    assert.notEqual(first, second);
    first.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications' },
      () => {},
    );
    second.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications' },
      () => {},
    );
  }
  await client.removeAllChannels();
});
