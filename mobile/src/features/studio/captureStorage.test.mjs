import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { studioCaptureStorage, studioLowStorageBytes } from './captureStorage.ts';

const jsx = (type, props) => ({ type, props });
const code = ts.transpileModule(readFileSync(new URL('./StudioCaptureStorageMonitor.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const module = { exports: {} };
const dependencies = {
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'view', Text: 'text', StyleSheet: { create: value => value } },
  'lucide-react-native': { HardDrive: 'disk-icon' }, './captureStorage': { studioCaptureStorage },
};
new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
const render = module.exports.StudioCaptureStorageMonitor;
function nodes(tree, predicate) {
  const found = [];
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') { if (predicate(value)) found.push(value); visit(value.props?.children); }
  };
  visit(tree); return found;
}
const fill = tree => nodes(tree, value => value.props?.testID === 'studio-capture-storage-fill')[0];
const label = tree => nodes(tree, value => value.type === 'text')[0];

test('alerta estritamente abaixo de 5 GB decimais; zero real continua leitura válida', () => {
  assert.equal(studioLowStorageBytes, 5_000_000_000);
  for (const [bytes, low] of [[0, true], [4_999_999_999, true], [5_000_000_000, false], [5_000_000_001, false], [6_300_000_000, false]]) {
    const value = studioCaptureStorage(bytes, 128_000_000_000);
    assert.equal(value.availableBytes, bytes); assert.equal(value.low, low);
  }
  assert.equal(studioCaptureStorage(0, 128_000_000_000).label, '0,0 GB livres');
  assert.equal(studioCaptureStorage(4_999_999_999).label, '4,9 GB livres', 'Não arredonda o limiar de aviso para cima');
  assert.equal(studioCaptureStorage(6_399_999_999).label, '6,3 GB livres');
});

test('ausente, negativo ou inválido fica indisponível; capacidade desconhecida não inventa percentual', () => {
  for (const invalid of [undefined, null, NaN, Infinity, -Infinity, -1, '0', false, .5, Number.MAX_SAFE_INTEGER + 1]) {
    const value = studioCaptureStorage(invalid, 128_000_000_000);
    assert.equal(value.availableBytes, null); assert.equal(value.low, false); assert.equal(value.freeFraction, null);
    assert.equal(value.label, '— GB livres'); assert.match(value.accessibilityLabel, /indisponível/);
  }
  for (const total of [undefined, null, 0, -1, NaN, Infinity, 4_000_000_000]) {
    const value = studioCaptureStorage(6_300_000_000, total);
    assert.equal(value.label, '6,3 GB livres'); assert.equal(value.totalBytes, null); assert.equal(value.freeFraction, null);
  }
  assert.equal(studioCaptureStorage(32_000_000_000, 128_000_000_000).freeFraction, .25);
  assert.equal(studioCaptureStorage(128_000_000_000, 128_000_000_000).freeFraction, 1);
});

test('chip compacto usa ícone e barra de espaço livre real, com alerta acessível e sem capturar foco', () => {
  const regular = render({ availableBytes: 6_300_000_000, totalBytes: 128_000_000_000 });
  assert.equal(nodes(regular, value => value.type === 'disk-icon').length, 1);
  assert.equal(label(regular).props.children, '6,3 GB livres');
  assert.equal(fill(regular).props.style[1].width, '4.921875%');
  assert.equal(regular.props.pointerEvents, 'none'); assert.equal(regular.props.accessibilityLiveRegion, 'none');
  assert.equal(regular.props.style[0].width, '100%'); assert.equal(regular.props.style[0].maxWidth, 180);
  assert.equal(label(regular).props.numberOfLines, 1); assert.equal(label(regular).props.adjustsFontSizeToFit, true);
  assert.ok(label(regular).props.minimumFontScale >= .8);
  const low = render({ availableBytes: 0, totalBytes: 128_000_000_000 });
  assert.equal(label(low).props.children, '0,0 GB livres'); assert.equal(label(low).props.style[1].color, '#FF7078');
  assert.equal(fill(low).props.style[1].width, '0%'); assert.match(low.props.accessibilityLabel, /Pouco espaço/);
  const boundary = render({ availableBytes: 5_000_000_000 });
  assert.notEqual(label(boundary).props.style[1].color, '#FF7078');
});

test('chip desconhecido conserva barra sem leitura e não recebe aparência de armazenamento cheio', () => {
  const unknown = render({});
  assert.equal(label(unknown).props.children, '— GB livres'); assert.equal(fill(unknown), undefined);
  assert.notEqual(label(unknown).props.style[1].color, '#FF7078'); assert.match(unknown.props.accessibilityLabel, /indisponível/);
  const noCapacity = render({ availableBytes: 6_300_000_000 });
  assert.equal(label(noCapacity).props.children, '6,3 GB livres'); assert.equal(fill(noCapacity), undefined);
});
