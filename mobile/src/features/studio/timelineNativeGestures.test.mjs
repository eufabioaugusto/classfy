import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformFileSync } from '@babel/core';

const require = createRequire(import.meta.url);
const expoPreset = require.resolve('babel-preset-expo', { paths: [dirname(require.resolve('expo/package.json'))] });
function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const item of node) visit(item, callback); return; }
  if (!node.type) return;
  callback(node);
  for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value, callback);
}

test('Babel Expo real transforma TODOS os callbacks da fábrica condicional de camadas em worklets', () => {
  // The JS component harness cannot prove execution on the native UI runtime.
  // Compile through the same Expo preset and installed Worklets plugin as Metro.
  const { ast } = transformFileSync(fileURLToPath(new URL('./StudioTimeline.tsx', import.meta.url)), {
    presets: [expoPreset], ast: true,
    caller: { name: 'metro', supportsStaticESM: true, isDev: true, platform: 'ios' },
  });
  let factory;
  visit(ast, node => { if (node.type === 'VariableDeclarator' && node.id.name === 'makePan') factory = node.init; });
  assert.ok(factory, 'actual gesture factory compiled');
  const callbacks = new Map();
  visit(factory, node => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return;
    const name = node.callee.property.name;
    if (!['onStart', 'onUpdate', 'onEnd', 'onFinalize'].includes(name)) return;
    let worklet = false;
    visit(node.arguments[0], child => {
      if (child.type === 'AssignmentExpression' && child.left.type === 'MemberExpression' && child.left.property.name === '__workletHash') worklet = true;
    });
    callbacks.set(name, worklet);
  });
  assert.deepEqual([...callbacks.keys()].sort(), ['onEnd', 'onFinalize', 'onStart', 'onUpdate']);
  for (const [name, worklet] of callbacks) assert.equal(worklet, true, `${name} must execute on UI, not mix JS and UI handlers`);
});

test('helpers de snap e geometria de arraste são worklets no preset real do Metro', () => {
  for (const [file, names] of [
    ['./timelineSnap.ts', ['studioTimelineSnapTargets', 'snapStudioTimelineRange']],
    ['./StudioTimeline.tsx', ['applyLayerRange', 'updateLayerDrag', 'applyMainSnap']],
  ]) {
    const { ast } = transformFileSync(fileURLToPath(new URL(file, import.meta.url)), {
      presets: [expoPreset], ast: true,
      caller: { name: 'metro', supportsStaticESM: true, isDev: true, platform: 'ios' },
    });
    for (const name of names) {
      const callbacks = [];
      visit(ast, node => {
        if (node.type === 'VariableDeclarator' && node.id.name === name) callbacks.push(node.init);
      });
      assert.ok(callbacks.length, `${name} compiled through Expo`);
      let worklet = false;
      visit(callbacks, node => {
        if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && node.left.property.name === '__workletHash') worklet = true;
      });
      assert.equal(worklet, true, `${name} must remain callable from the native UI runtime`);
    }
  }
});
