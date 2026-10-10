import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const jsx = (type, props) => ({ type, props });
const code = ts.transpileModule(readFileSync(new URL('./StudioCaptureAudioMonitor.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const module = { exports: {} };
const dependencies = {
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'view', Text: 'text', StyleSheet: { create: value => value } },
  'lucide-react-native': { Mic: 'mic' },
};
new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
const { StudioCaptureAudioMonitor: render, studioAudioMeterPosition: position } = module.exports;
function all(tree, predicate) {
  const result = [];
  const visit = node => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') { if (predicate(node)) result.push(node); visit(node.props?.children); }
  };
  visit(tree); return result;
}
const rows = tree => all(tree, node => Array.isArray(node.props?.children) && node.props.children.length === 3 && node.props.children[0]?.type === 'text' && node.props.children[2]?.type === 'text');
const fills = tree => all(tree, node => Array.isArray(node.props?.style) && node.props.style[1]?.width?.endsWith?.('%'));
const peaks = tree => all(tree, node => Array.isArray(node.props?.style) && node.props.style[0]?.width === 2);
const input = { name: 'USB Audio', type: 'USBAudio' };
test('escala dBFS é linear e limitada, sem inventar leitura de amostra inválida', () => {
  assert.deepEqual([-100, -48, -36, -24, -12, -6, 0, 3].map(position), [0, 0, .25, .5, .75, .875, 1, 1]);
  assert.equal(position(NaN), null); assert.equal(position(Infinity), null); assert.equal(position(-Infinity), null);
  const silence = render({ input: null, status: 'live', channels: [{ averageDb: -160, peakDb: -160 }] });
  assert.equal(fills(silence).length, 0); assert.equal(rows(silence)[0].props.children[2].props.children, -160);
});
test('dois canais reais têm RMS independente, segmentos de aviso e pico separado', () => {
  const channels = [{ averageDb: -24, peakDb: -6 }, { averageDb: -3, peakDb: -.5 }], original = JSON.stringify(channels);
  const tree = render({ input, channels, status: 'live' });
  assert.equal(rows(tree).length, 2);
  assert.deepEqual(fills(tree).map(node => node.props.style[1].width), ['50%', '75%', '12.5%', '6.25%']);
  assert.deepEqual(peaks(tree).map(node => node.props.style[1].left), ['87.5%', `${position(-.5) * 100}%`]);
  assert.ok(tree.props.accessibilityLabel.includes('USB Audio')); assert.ok(tree.props.accessibilityLabel.includes('2 canais'));
  assert.equal(JSON.stringify(channels), original);
});
for (const status of ['waiting', 'unavailable', 'interrupted']) test(`${status} oculta até níveis antigos recebidos`, () => {
  const tree = render({ input, channels: [{ averageDb: -3, peakDb: 0 }], status, message: 'A entrada não confirmou novas amostras.' });
  assert.equal(rows(tree).length, 0); assert.equal(fills(tree).length, 0); assert.equal(peaks(tree).length, 0);
  assert.ok(all(tree, node => node.props?.children === 'A entrada não confirmou novas amostras.').length);
});
test('entrada vazia ou inválida aguarda sem barras; canais inválidos não ganham nível fictício', () => {
  for (const channels of [[], [{ averageDb: NaN, peakDb: 0 }]]) {
    const tree = render({ input: null, channels, status: 'live' });
    assert.ok(tree.props.accessibilityLabel.includes('Entrada de áudio')); assert.ok(tree.props.accessibilityLabel.includes('Aguardando'));
    assert.equal(fills(tree).length, 0); assert.equal(peaks(tree).length, 0);
  }
  const tree = render({ input, status: 'live', channels: [{ averageDb: -48, peakDb: -48 }, { averageDb: NaN, peakDb: 0 }] });
  assert.equal(rows(tree).length, 2); assert.equal(fills(tree).length, 0); assert.equal(peaks(tree).length, 1);
  assert.equal(rows(tree)[1].props.children[2].props.children, '—');
});
test('limita oito canais, conserva nome completo acessível e não anuncia cada oscilação', () => {
  const source = Array.from({ length: 9 }, (_, index) => ({ averageDb: -48 + index, peakDb: -24 + index }));
  const first = render({ input: { name: 'Microfone sem fio com nome do sistema', type: 'BluetoothHFP' }, channels: source, status: 'live', compact: true });
  const second = render({ input: { name: 'Microfone sem fio com nome do sistema', type: 'BluetoothHFP' }, channels: source.map(sample => ({ averageDb: sample.averageDb + 3, peakDb: sample.peakDb + 3 })), status: 'live', compact: true });
  assert.equal(rows(first).length, 8); assert.equal(first.props.pointerEvents, 'none');
  assert.equal(first.props.accessibilityLiveRegion, 'none'); assert.equal(first.props.accessibilityLabel, second.props.accessibilityLabel);
  assert.ok(first.props.accessibilityLabel.includes('Microfone sem fio com nome do sistema'));
});
test('aviso de entrada perdida permanece visível e acessível enquanto a nova entrada recebe áudio', () => {
  const props = { input: { name: 'Microfone do iPhone', type: 'BuiltInMic' }, channels: [{ averageDb: -24, peakDb: -12 }], status: 'live' };
  const normal = render(props);
  const warning = 'Microfone externo desconectado. Usando o microfone do iPhone.';
  const updated = render({ ...props, message: `  ${warning}  ` });
  assert.equal(rows(updated).length, 1); assert.equal(peaks(updated).length, 1);
  assert.equal(all(normal, node => node.props?.children === warning).length, 0);
  assert.equal(all(updated, node => node.props?.children === warning).length, 1);
  assert.ok(updated.props.accessibilityLabel.includes(warning)); assert.equal(updated.props.accessibilityLiveRegion, 'none');
  const newSample = render({ ...props, channels: [{ averageDb: -6, peakDb: -1 }], message: warning });
  assert.equal(updated.props.accessibilityLabel, newSample.props.accessibilityLabel, 'aviso estável sem valores por amostra');
});
