import test from 'node:test';
import assert from 'node:assert/strict';
import { compileStudioRecipe, emptyStudioEditing, addStudioLayerItem, createStudioTextItem, studioTicks } from './model.ts';
import { studioCanvasFrame, studioCanvasHitTest, studioCanvasContains, studioCanvasMove, studioCanvasScale, studioCanvasResize,
  studioVisibleCanvasLayers, studioCanvasTransformChanged } from './canvasGeometry.ts';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function fixture() {
  let editing = emptyStudioEditing('aula');
  editing.assets.push({ id: 'source', kind: 'video', uri: 'file:///source.mov', name: 'Original', durationTicks: studioTicks(4), width: 1920, height: 1080 });
  editing.main.push({ id: 'main', assetId: 'source', sourceStartTicks: 0, sourceEndTicks: studioTicks(4) });
  editing = addStudioLayerItem(editing, { ...createStudioTextItem({ id: 'title', content: 'Título', atTicks: 0, durationTicks: studioTicks(2) }), rect: { x: 0.2, y: 0.2, width: 0.6, height: 0.3 } });
  editing = addStudioLayerItem(editing, { ...createStudioTextItem({ id: 'later', content: 'Depois', atTicks: studioTicks(2), durationTicks: studioTicks(2) }), rect: { x: 0.3, y: 0.3, width: 0.4, height: 0.2 } }, 'upper');
  return { editing, recipe: compileStudioRecipe({ kind: 'aula', takes: [], editing }) };
}

test('canvas contain respeita barras pretas e converte os três formatos', () => {
  assert.deepEqual(studioCanvasFrame(320, 568, 'landscape'), { x: 0, y: 194, width: 320, height: 180 });
  assert.deepEqual(studioCanvasFrame(320, 180, 'portrait'), { x: 109.375, y: 0, width: 101.25, height: 180 });
  assert.deepEqual(studioCanvasFrame(320, 180, 'square'), { x: 70, y: 0, width: 180, height: 180 });
  const frame = studioCanvasFrame(320, 568, 'landscape');
  const clip = { rect: { x: 0, y: 0, width: 1, height: 1 }, rotationDegrees: 0 };
  assert.equal(studioCanvasContains(clip, 160, 100, frame), false);
  assert.equal(studioCanvasContains(clip, 160, 284, frame), true);
  assert.deepEqual(studioCanvasFrame(NaN, 20, 'portrait'), { x: 0, y: 0, width: 0, height: 0 });
});

test('seleção respeita tempo compilado, transparência, camada superior e EOF', () => {
  const { editing, recipe } = fixture();
  assert.deepEqual(studioVisibleCanvasLayers(editing, recipe, 1).map(item => item.id), ['title']);
  assert.deepEqual(studioVisibleCanvasLayers(editing, recipe, 2).map(item => item.id), ['later']);
  assert.deepEqual(studioVisibleCanvasLayers(editing, recipe, 4).map(item => item.id), ['later']);
  assert.deepEqual(studioVisibleCanvasLayers(editing, recipe, 4.01), []);
  assert.deepEqual(studioVisibleCanvasLayers(editing, recipe, NaN), []);
  assert.deepEqual(studioVisibleCanvasLayers(editing, recipe, 1, true).map(item => item.id), ['title', 'main']);
  recipe.clips.find(item => item.id === 'later').startTicks = 0;
  const layers = studioVisibleCanvasLayers(editing, recipe, 1, true);
  assert.deepEqual(layers.map(item => item.id), ['later', 'title', 'main']);
  assert.equal(studioCanvasHitTest(layers, 160, 90, studioCanvasFrame(320, 180, 'landscape')), 'later');
  recipe.clips.find(item => item.id === 'later').opacity = 0;
  assert.deepEqual(studioVisibleCanvasLayers(editing, recipe, 1).map(item => item.id), ['title']);
});

test('hit-test de camada rotacionada usa pixels do canvas, sem deformar por proporção', () => {
  const frame = { x: 0, y: 0, width: 200, height: 100 };
  const clip = { rect: { x: 0.25, y: 0.4, width: 0.5, height: 0.2 }, rotationDegrees: 90 };
  assert.equal(studioCanvasContains(clip, 100, 95, frame), true);
  assert.equal(studioCanvasContains(clip, 140, 50, frame), false);
});

test('movimento usa dimensão do canvas e mantém o frame alcançável ao recortar', () => {
  const rect = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 };
  const next = studioCanvasMove(rect, 32, 18, 320, 180);
  near(next.x, 0.3); near(next.y, 0.4);
  assert.equal(next.width, 0.5); assert.equal(next.height, 0.4);
  near(studioCanvasMove(rect, -10000, -10000, 320, 180).x, -0.46);
  near(studioCanvasMove(rect, 10000, 10000, 320, 180).x, 0.96);
  assert.deepEqual(studioCanvasMove(rect, NaN, 0, 320, 180), rect);
});

test('pinch preserva centro, aspect ratio e escala letras junto do frame', () => {
  const original = { rect: { x: 0.3, y: 0.2, width: 0.4, height: 0.2 }, textFontSize: 0.04 };
  const next = studioCanvasScale(original, 2, 320, 180);
  near(next.rect.x + next.rect.width / 2, 0.5);
  near(next.rect.y + next.rect.height / 2, 0.3);
  near(next.rect.width / next.rect.height, original.rect.width / original.rect.height);
  near(next.textFontSize, 0.08);
  assert.equal(studioCanvasTransformChanged(original, next), true);
  assert.equal(studioCanvasTransformChanged(original, { ...original, rect: { ...original.rect } }), false);
  const image = studioCanvasScale({ rect: original.rect }, 2, 320, 180);
  assert.equal(Object.hasOwn(image, 'textFontSize'), false);
});

test('as quatro alças redimensionam uniformemente mantendo o canto oposto', () => {
  const transform = { rect: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, textFontSize: 0.03 };
  for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
    const left = corner.endsWith('Left'), top = corner.startsWith('top');
    const next = studioCanvasResize(transform, corner, left ? -100 : 100, top ? -50 : 50, 1000, 500);
    near(next.rect.width, 0.3); near(next.rect.height, 0.3); near(next.textFontSize, 0.045);
    near(next.rect.x + (left ? next.rect.width : 0), transform.rect.x + (left ? transform.rect.width : 0));
    near(next.rect.y + (top ? next.rect.height : 0), transform.rect.y + (top ? transform.rect.height : 0));
  }
});

test('resize de frame rotacionado mantém o ponto físico do canto oposto', () => {
  const transform = { rect: { x: 0.4, y: 0.3, width: 0.2, height: 0.4 } };
  const next = studioCanvasResize(transform, 'bottomRight', -50, 100, 1000, 500, 90);
  near(next.rect.width, 0.275); near(next.rect.height, 0.55);
  const fixedCorner = rect => ({ x: (rect.x + rect.width / 2) * 1000 + rect.height * 500 / 2,
    y: (rect.y + rect.height / 2) * 500 - rect.width * 1000 / 2 });
  near(fixedCorner(next.rect).x, fixedCorner(transform.rect).x);
  near(fixedCorner(next.rect).y, fixedCorner(transform.rect).y);
});

test('limites do motor e do texto permanecem válidos para pinches extremos', () => {
  const main = { rect: { x: 0, y: 0, width: 1, height: 1 } };
  const small = studioCanvasScale(main, 0.00001, 320, 180, undefined, 0, 0.1);
  near(small.rect.width, 0.1); near(small.rect.height, 0.1);
  const large = studioCanvasScale(main, 10000, 320, 180);
  near(large.rect.width, 3); near(large.rect.height, 3);
  const cropped = studioCanvasMove(large.rect, -10000, -10000, 320, 180);
  assert.equal(cropped.x, -2); assert.equal(cropped.y, -2);
  const text = studioCanvasScale({ rect: { x: 0.4, y: 0.4, width: 0.1, height: 0.1 }, textFontSize: 0.7 }, 1000, 320, 180);
  assert.equal(text.textFontSize, 1); near(text.rect.width, 1 / 7);
  assert.deepEqual(studioCanvasScale(main, Infinity, 320, 180), main);
  assert.deepEqual(studioCanvasResize(main, 'bottomRight', NaN, 10, 320, 180), main);
});
