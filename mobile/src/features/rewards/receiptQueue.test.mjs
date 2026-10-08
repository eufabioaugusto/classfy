import test from 'node:test';
import assert from 'node:assert/strict';
import { ReceiptQueue } from './receiptQueue.ts';
const receipt = { id: 'reward-1', user_id: 'user-1', points: 5, action_key: 'DAILY_LOGIN' };
test('login antes da montagem preserva apenas recibos confirmados da conta correta', () => {
  const queue = new ReceiptQueue();
  queue.add(receipt, 0);
  assert.deepEqual(queue.take('user-2', 100), []);
  assert.deepEqual(queue.take('user-1', 200), [receipt]);
  assert.deepEqual(queue.take('user-1', 300), []);
});
test('o mesmo ID não cria dois recibos e uma entrega ativa remove a pendência', () => {
  const queue = new ReceiptQueue();
  queue.add(receipt, 0); queue.add(receipt, 1);
  assert.equal(queue.take('user-1', 2).length, 1);
  queue.add(receipt, 3); queue.delivered(receipt.id);
  assert.deepEqual(queue.take('user-1', 4), []);
});
test('recibos antigos não voltam a animar ao entrar em outra sessão', () => {
  const queue = new ReceiptQueue(); queue.add(receipt, 0);
  assert.deepEqual(queue.take('user-1', 60001), []);
});
