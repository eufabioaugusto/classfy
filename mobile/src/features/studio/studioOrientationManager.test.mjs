import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioOrientationManager } from './studioOrientationManager.ts';

test('cleanup do editor não restaura retrato por cima da câmera focada', async () => {
  const applied = [];
  const manager = createStudioOrientationManager(async mode => { applied.push(mode); });
  const editor = Symbol('editor'); const camera = Symbol('camera');
  await manager.request(editor, 'landscape');
  const focusedCamera = manager.request(camera, 'landscape');
  const blurredEditor = manager.release(editor);
  await Promise.all([focusedCamera, blurredEditor]);
  assert.deepEqual(applied, ['landscape']);
  await manager.release(camera);
  assert.deepEqual(applied, ['landscape', 'portrait']);
});
test('último foco vence e requests antigos não reaplicam orientação obsoleta', async () => {
  const applied = [];
  const manager = createStudioOrientationManager(async mode => { applied.push(mode); });
  const editor = Symbol('editor'); const short = Symbol('short');
  await Promise.all([manager.request(editor, 'landscape'), manager.request(short, 'portrait')]);
  assert.deepEqual(applied, ['portrait']);
  await manager.release(short);
  assert.deepEqual(applied, ['portrait', 'landscape']);
  await manager.release(editor);
  assert.deepEqual(applied, ['portrait', 'landscape', 'portrait']);
});
test('locks nativos são serializados mesmo se a navegação ocorrer durante o lock', async () => {
  const applied = [];
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let concurrent = 0;
  const manager = createStudioOrientationManager(async mode => {
    concurrent++;
    assert.equal(concurrent, 1);
    applied.push(mode);
    if (applied.length === 1) await blocked;
    concurrent--;
  });
  const editor = Symbol('editor');
  const enter = manager.request(editor, 'landscape');
  await new Promise(resolve => setImmediate(resolve));
  const exit = manager.release(editor);
  release();
  await Promise.all([enter, exit]);
  assert.deepEqual(applied, ['landscape', 'portrait']);
});
test('erro de lock não bloqueia futuras mudanças nem deixa o app preso em paisagem', async () => {
  const applied = [];
  let fail = true;
  const manager = createStudioOrientationManager(async mode => {
    applied.push(mode);
    if (fail) { fail = false; throw new Error('native failure'); }
  });
  const editor = Symbol('editor');
  await assert.rejects(manager.request(editor, 'landscape'));
  await manager.release(editor);
  assert.deepEqual(applied, ['landscape', 'portrait']);
  assert.equal(manager.target(), 'portrait');
});
