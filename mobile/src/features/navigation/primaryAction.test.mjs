import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCreatorRole } from './primaryAction.ts';
test('publicação segue papéis do web, inclusive contas com múltiplos papéis', () => {
  assert.equal(resolveCreatorRole(['user', 'creator']), 'creator');
  assert.equal(resolveCreatorRole(['creator', 'admin', 'user']), 'admin');
  assert.equal(resolveCreatorRole(['user']), 'user');
});
test('ausência de papel e status de candidatura não concedem publicação', () => {
  for (const roles of [[], ['pending'], ['approved'], ['rejected'], ['unknown']]) assert.equal(resolveCreatorRole(roles), 'user');
});
