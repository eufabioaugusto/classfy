import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';

const dependenciesEqual = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
function harness(file, exportName, initialProps) {
  const slots = [], pendingEffects = [], frames = new Map(), timers = new Map();
  let cursor = 0, dirty = false, tree, props = initialProps, frameId = 0, timerId = 0, focusCount = 0, now = 1000, refs = new Set();
  const hooks = {
    useRef: initial => { const index = cursor++; return slots[index] ||= { current: initial }; },
    useState: initial => {
      const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }];
    },
    useEffect: (callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !dependenciesEqual(slots[index].dependencies, dependencies)) pendingEffects.push({ index, callback, dependencies });
    },
  };
  const jsx = (type, nodeProps) => {
    if (type === 'input' && nodeProps.ref) { refs.add(nodeProps.ref); nodeProps.ref.current = { focus: () => { focusCount++; } }; }
    return { type, props: nodeProps };
  };
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'button', ScrollView: 'scroll', Text: 'text', TextInput: 'input', View: 'view', ActivityIndicator: 'spinner', StyleSheet: { create: value => value } },
    'lucide-react-native': new Proxy({}, { get: (_, key) => `icon:${String(key)}` }),
    '@/theme/colors': { colors: { surface: '#141414', surfaceAlt: '#1F1F1F', surfaceMuted: '#262626', text: '#FAFAFA', muted: '#A3A3A3', accent: '#E11D48' } },
    './model': model, './StudioControlSlider': { StudioControlSlider: 'slider' },
  };
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'Date', compiled)(
    name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, module, module.exports,
    callback => { frames.set(++frameId, callback); return frameId; }, id => frames.delete(id),
    callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id), { now: () => now });
  const Component = module.exports[exportName];
  const expand = node => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  };
  const draw = () => {
    let count = 0;
    do {
      assert.ok(++count < 15, 'bounded render loop'); dirty = false; cursor = 0; const previousRefs = refs; refs = new Set();
      tree = expand(Component(props)); for (const ref of previousRefs) if (!refs.has(ref)) ref.current = null;
      for (const effect of pendingEffects.splice(0)) { slots[effect.index]?.cleanup?.(); slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() }; }
    } while (dirty);
    return tree;
  };
  const findAll = predicate => {
    const matches = []; const walk = node => { if (Array.isArray(node)) { node.forEach(walk); return; } if (!node || typeof node !== 'object') return; if (predicate(node)) matches.push(node); walk(node.props?.children); }; walk(tree); return matches;
  };
  draw();
  return { exports: module.exports, draw,
    update: patch => { props = { ...props, ...patch }; draw(); },
    button: label => { const button = findAll(node => node.type === 'button' && node.props.accessibilityLabel === label)[0]; assert.ok(button, `button ${label}`); return button.props; },
    hasButton: label => findAll(node => node.type === 'button' && node.props.accessibilityLabel === label).length > 0,
    press: label => { const button = findAll(node => node.type === 'button' && node.props.accessibilityLabel === label)[0]; assert.ok(button, `button ${label}`); if (!button.props.disabled) button.props.onPress?.(); draw(); },
    input: () => findAll(node => node.type === 'input')[0]?.props,
    slider: label => findAll(node => node.type === 'slider' && (!label || node.props.label === label))[0]?.props,
    adjustable: () => findAll(node => node.props.accessibilityRole === 'adjustable')[0]?.props,
    labels: () => findAll(node => node.type === 'text').map(node => node.props.children),
    flushFrames: () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } draw(); },
    flushTimers: () => { now += 100; for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } draw(); },
    focusCount: () => focusCount, pendingFrames: () => frames.size, pendingTimers: () => timers.size,
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); for (const ref of refs) ref.current = null; },
    pump: async () => { await new Promise(resolve => setImmediate(resolve)); draw(); },
  };
}
function editingFixture(kind = 'text') {
  let editing = model.emptyStudioEditing('aula');
  editing.assets.push({ id: 'video-source', kind: 'video', uri: 'file:///video.mov', name: 'Video', durationTicks: model.studioTicks(8) });
  editing.main.push({ id: 'main', assetId: 'video-source', sourceStartTicks: 0, sourceEndTicks: model.studioTicks(8) });
  let item = model.createStudioTextItem({ id: 'title', content: 'Original', durationTicks: model.studioTicks(3) });
  if (kind !== 'text') {
    editing.assets.push({ id: 'overlay-source', kind, uri: 'file:///overlay', name: 'Overlay', durationTicks: kind === 'image' ? 0 : model.studioTicks(3) });
    item = { ...item, kind, text: undefined, assetId: 'overlay-source', ...(kind === 'image' ? {} : { sourceStartTicks: 0, sourceEndTicks: model.studioTicks(3) }) };
  }
  editing = model.addStudioLayerItem(editing, item); return { editing, item };
}
function layer(options = {}) {
  const fixture = editingFixture(options.kind), previews = [], applied = [], removed = [], closed = [], consumed = [];
  const view = harness('./StudioLayerPanel.tsx', 'StudioLayerPanel', { ...fixture, onPreview: value => previews.push(value), onApply: async value => { applied.push(value); }, onClose: () => closed.push(true), onRemove: () => removed.push(true), onTextEditConsumed: value => consumed.push(value), ...options.props });
  const latestItem = () => previews.at(-1)?.layers.flatMap(value => value.items).find(value => value.id === fixture.item.id);
  return { view, ...fixture, previews, applied, removed, closed, consumed, latestItem };
}
function treatment(options = {}) {
  const { editing } = editingFixture(), previews = [], applied = [], before = [], closed = [];
  const view = harness('./StudioTreatmentPanel.tsx', 'StudioTreatmentPanel', { editing, targetId: 'main', onPreview: value => previews.push(value), onApply: async value => { applied.push(value); }, onClose: () => closed.push(true), onBefore: value => before.push(value), ...options });
  return { view, editing, previews, applied, before, closed, grade: () => previews.at(-1)?.main[0].grade };
}

// These exercise the actual components and their callbacks, not a mirrored UI model.
test('ordinary layer selection starts with tools, no keyboard, position or duration controls', () => {
  const { view } = layer(); assert.equal(view.input(), undefined); assert.equal(view.focusCount(), 0);
  assert.equal(view.hasButton('Editar texto'), true); assert.equal(view.hasButton('Duplicar'), false); assert.equal(view.hasButton('Dividir'), false);
  assert.equal(view.labels().includes('Posição'), false); assert.equal(view.labels().includes('Duração'), false);
});
test('explicit double tap mounts and focuses text once; returning to tools does not consume again', () => {
  const request = { id: 'title', sequence: 8 }; const { view, consumed } = layer({ props: { editTextRequest: request } });
  assert.ok(view.input()); assert.equal(view.pendingFrames(), 1); view.flushFrames(); view.draw(); view.flushFrames();
  assert.equal(view.focusCount(), 1); assert.deepEqual(consumed, [request]);
  view.press('Voltar às ferramentas da camada'); assert.equal(view.input(), undefined); view.draw(); view.flushFrames(); assert.equal(view.focusCount(), 1);
});
test('foreign and disabled text requests never focus; a cancelled scheduled request cannot revive on blur', () => {
  const { view } = layer({ props: { editTextRequest: { id: 'other', sequence: 1 } } }); view.flushFrames(); assert.equal(view.focusCount(), 0);
  view.update({ editTextRequest: { id: 'title', sequence: 2 } }); assert.equal(view.pendingFrames(), 1);
  view.update({ disabled: true, editTextRequest: undefined }); view.flushFrames(); view.update({ disabled: false }); view.flushFrames(); assert.equal(view.focusCount(), 0);
});
test('consecutive text changes before React render preserve the latest content', async () => {
  const { view, latestItem, applied } = layer(); view.press('Editar texto');
  const input = view.input(); input.onChangeText('Primeiro'); input.onChangeText('Segundo'); view.draw();
  assert.equal(latestItem().text.content, 'Segundo'); view.press('Aplicar edição da camada'); await view.pump(); assert.equal(applied[0].layers[0].items[0].text.content, 'Segundo');
});
test('canvas geometry echo and text draft share the same latest Apply snapshot', async () => {
  const { view, editing, latestItem, applied } = layer(); view.press('Editar texto'); view.input().onChangeText('Texto preservado'); view.draw();
  const item = { ...latestItem(), rect: { x: -.1, y: .2, width: .7, height: .3 } }; const next = model.patchStudioLayerItem(editing, item.id, item);
  view.update({ item, editing: next }); view.press('Aplicar edição da camada'); await view.pump();
  assert.equal(applied[0].layers[0].items[0].text.content, 'Texto preservado'); assert.deepEqual(applied[0].layers[0].items[0].rect, item.rect);
});
test('font, text color, alignment, background, bold and italic use real model fields', () => {
  const { view, latestItem } = layer(); view.press('Editar texto'); view.press('Fontes do texto'); view.press('Fonte Avenir'); assert.equal(latestItem().text.fontFamily, 'AvenirNext-Regular');
  view.press('Cor do texto'); view.press('Cor #38BDF8'); assert.equal(latestItem().text.color, '#38BDF8');
  view.press('Estilo do texto'); view.press('Alinhar texto à esquerda'); view.press('Negrito'); view.press('Itálico'); view.press('Fundo do texto');
  assert.equal(latestItem().text.alignment, 'left'); assert.equal(latestItem().text.fontFamily, 'AvenirNext-DemiBoldItalic'); assert.equal(latestItem().text.backgroundColor, '#000000AA');
});
test('split and duplicate are optional real callbacks; split respects its guard', async () => {
  const events = []; const { view } = layer({ props: { onSplit: () => events.push('split'), onDuplicate: () => events.push('duplicate'), canSplit: false } });
  view.press('Dividir'); assert.deepEqual(events, []); view.update({ canSplit: true }); view.press('Dividir'); await view.pump(); view.press('Duplicar'); await view.pump(); assert.deepEqual(events, ['split', 'duplicate']);
});
test('image toolbar offers real opacity and treatment, no audio controls', () => {
  const adjusted = []; const { view, latestItem } = layer({ kind: 'image', props: { onTreatment: () => adjusted.push(true) } });
  assert.equal(view.hasButton('Volume'), false); view.press('Ajustar'); assert.deepEqual(adjusted, [true]); view.press('Opacidade'); view.slider().onChange(.35); view.draw(); assert.equal(latestItem().opacity, .35);
});
test('audio fades remain within the source presentation and no visual tools are displayed', () => {
  const { view, latestItem } = layer({ kind: 'audio' }); assert.equal(view.hasButton('Opacidade'), false); assert.equal(view.hasButton('Ajustar'), false);
  view.press('Editar camada'); view.slider().onChange(1.4); view.draw(); assert.equal(latestItem().gain, 1.4);
  view.press('Entrada suave do áudio'); const fadeIn = view.slider('Entrada suave'); assert.equal(fadeIn.max, 1.5); fadeIn.onChange(1.5); view.draw(); view.press('Saída suave do áudio'); view.slider('Saída suave').onChange(1.5); view.draw();
  assert.equal(latestItem().fadeInTicks + latestItem().fadeOutTicks, latestItem().durationTicks);
});
test('Apply failure keeps the text draft and allows retry; close never persists', async () => {
  let attempts = 0; const { view, closed } = layer({ props: { onApply: async () => { if (++attempts === 1) throw new Error('Falha de disco'); } } });
  view.press('Editar texto'); view.input().onChangeText('Rascunho'); view.draw(); view.press('Aplicar edição da camada'); await view.pump(); assert.equal(view.input().value, 'Rascunho'); assert.ok(view.labels().includes('Falha de disco'));
  view.press('Aplicar edição da camada'); await view.pump(); assert.equal(attempts, 2); view.press('Voltar às ferramentas da camada'); view.press('Cancelar edição da camada'); assert.equal(attempts, 2); assert.deepEqual(closed, [true]);
});
test('late slider callback from a previous selected item does not mutate the next item', () => {
  const { view, editing, previews } = layer(); view.press('Opacidade'); const old = view.slider().onChange;
  const second = model.createStudioTextItem({ id: 'second', content: 'Outro', durationTicks: model.studioTicks(2) }); view.update({ editing: model.addStudioLayerItem(editing, second), item: second }); const count = previews.length; old(.4); assert.equal(previews.length, count);
});
test('treatment opens requested tab and changing a real parameter previews the selected field', () => {
  const { view, grade } = treatment({ initialTab: 'adjust' }); assert.equal(view.slider().label, 'Exposição'); view.press('Ajustar Temperatura'); view.slider().onChange(.45); view.slider().onInteractionEnd(false); view.draw(); assert.equal(grade().temperature, .45); assert.equal(grade().exposure, 0);
});
test('filter controls preserve manual adjustments and Apply flushes the latest draft once', async () => {
  const { view, applied, grade } = treatment(); view.press('Filtro Studio'); view.slider().onChange(.55); view.draw(); view.press('Ajustes'); view.slider().onChange(.7); view.draw(); view.press('Aplicar tratamento'); await view.pump();
  assert.equal(applied.length, 1); assert.deepEqual(applied[0].main[0].grade, { preset: 'studio', intensity: .55, exposure: .7, contrast: 0, saturation: 0, temperature: 0 }); assert.equal(view.pendingTimers(), 0); assert.equal(grade().preset, 'studio');
});
test('compare hold releases on disabling, and no queued preview survives a target change', () => {
  const { view, before, previews, editing } = treatment(); const compare = view.button('Segure para comparar com o original'); compare.onPressIn(); assert.equal(before.at(-1), true); view.update({ disabled: true }); assert.equal(before.at(-1), false);
  view.update({ disabled: false }); view.slider().onChange(.2); view.slider().onChange(.3); assert.ok(view.pendingTimers() > 0);
  const changed = { ...editing, main: [...editing.main, { ...editing.main[0], id: 'other' }] }; view.update({ editing: changed, targetId: 'other' }); const count = previews.length; view.flushTimers(); assert.equal(previews.length, count);
});
test('treatment cancel and unmount clear previews without Apply; stale control cannot edit a new target', () => {
  const { view, editing, applied, previews, closed } = treatment(); const old = view.slider().onChange;
  const changed = { ...editing, main: [...editing.main, { ...editing.main[0], id: 'other' }] }; view.update({ editing: changed, targetId: 'other' }); const count = previews.length; old(.2); assert.equal(previews.length, count);
  view.press('Fechar tratamento'); view.unmount(); assert.equal(previews.at(-1), undefined); assert.deepEqual(applied, []); assert.deepEqual(closed, [true]);
});

function slider(options = {}) {
  const changes = [], ends = [], starts = [];
  const view = harness('./StudioControlSlider.tsx', 'StudioControlSlider', { label: 'Exposição', value: .2, min: -2, max: 2, step: .1, onChange: value => changes.push(value), onInteractionStart: () => starts.push(true), onInteractionEnd: value => ends.push(value), ...options });
  view.adjustable().onLayout({ nativeEvent: { layout: { width: 220 } } }); view.draw(); return { view, changes, ends, starts };
}
const touch = locationX => ({ nativeEvent: { locationX } });
test('slider mapping quantizes from a nonzero minimum, clamps bounds, and ignores invalid coordinates', () => {
  const { view } = slider(), { studioSliderPosition, studioSliderValue } = view.exports;
  assert.equal(studioSliderValue(.26, -2, 2, .1), .3); assert.equal(studioSliderValue(40, -2, 2, .1), 2); assert.equal(studioSliderValue(NaN, -2, 2, .1), -2);
  assert.equal(studioSliderPosition(50, 100, -2, 2, .1), 0); assert.equal(studioSliderPosition(NaN, 100, -2, 2, .1), undefined); assert.equal(studioSliderPosition(1, 0, -2, 2, .1), undefined);
});
test('finger slider follows its track endpoints and releases the latest value with one completion', () => {
  const { view, changes, ends, starts } = slider(); let responder = view.adjustable(); responder.onResponderGrant(touch(10)); responder.onResponderMove(touch(110)); responder.onResponderRelease(touch(210)); responder.onResponderRelease(touch(210));
  assert.deepEqual(changes, [-2, 0, 2]); assert.deepEqual(starts, [true]); assert.deepEqual(ends, [false]);
});
test('cancelled drag restores its starting value without an extra commit or late movement', () => {
  const { view, changes, ends } = slider(); const responder = view.adjustable(); responder.onResponderGrant(touch(210)); responder.onResponderTerminate(); responder.onResponderMove(touch(10)); responder.onResponderRelease(touch(10));
  assert.deepEqual(changes, [2, .2]); assert.deepEqual(ends, [true]);
});
test('slider parameter switch restores only its frozen old callback, not the newly selected field', () => {
  const { view, changes, ends } = slider(), next = []; view.adjustable().onResponderGrant(touch(210)); view.update({ label: 'Saturação', value: 0, min: -1, max: 1, step: .05, onChange: value => next.push(value) });
  assert.deepEqual(changes, [2, .2]); assert.deepEqual(next, []); assert.deepEqual(ends, [true]);
});
test('slider unmount cancels once and disabled controls reject responder and accessible changes', () => {
  const { view, changes, ends } = slider(); view.adjustable().onResponderGrant(touch(210)); view.unmount(); assert.deepEqual(changes, [2, .2]); assert.deepEqual(ends, [true]);
  const blocked = slider({ disabled: true }); assert.equal(blocked.view.adjustable().onStartShouldSetResponder(), false); blocked.view.adjustable().onResponderGrant(touch(210)); blocked.view.adjustable().onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); assert.deepEqual(blocked.changes, []);
});
test('accessible slider increment is bounded and unsupported action does nothing', () => {
  const { view, changes, ends } = slider({ value: 2 }); view.adjustable().onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); view.adjustable().onAccessibilityAction({ nativeEvent: { actionName: 'unknown' } }); assert.deepEqual(changes, [2]); assert.deepEqual(ends, [false]);
});

test('expanded text panel reports its reserved layout and clears it on close/unmount', () => {
  const changes = []; const { view } = layer({ props: { onEditingChange: expanded => changes.push(expanded) } }); assert.deepEqual(changes, [false]);
  view.press('Editar texto'); assert.equal(changes.at(-1), true); view.press('Voltar às ferramentas da camada'); assert.equal(changes.at(-1), false); view.press('Opacidade'); assert.equal(changes.at(-1), true); view.unmount(); assert.equal(changes.at(-1), false);
});
