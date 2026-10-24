import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('./WatchCoursePlaylist.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props) => ({ type, props });
const dependencies = {
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { ActivityIndicator: 'spinner', Pressable: 'button', Text: 'text', View: 'view', StyleSheet: { create: value => value } },
  '@expo/vector-icons': { Ionicons: 'icon' },
  '@/theme/colors': { colors: {} }, '@/theme/radius': { radius: {} },
};
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
const lesson = (id, title = `Aula ${id}`) => ({ id, title, module_id: 'module', course_id: 'course', content_id: null, description: null, video_url: 'https://private.example/lesson.m3u8', duration_seconds: 60, order_index: 0, is_preview: false, created_at: '', updated_at: '' });
const first = lesson('first', 'Comece por aqui'), second = lesson('second', 'Uma prática guiada'), third = lesson('third', 'Aplicando o aprendizado');
const modules = [{ id: 'module-a', lessons: [first, second] }, { id: 'empty-module', lessons: [] }, { id: 'module-b', lessons: [third] }];
const text = node => Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? text(node.props?.children) : '';
const has = (node, type) => Array.isArray(node) ? node.some(child => has(child, type)) : !!node && typeof node === 'object' && (node.type === type || has(node.props?.children, type));
function render(props = {}) {
  let presses = 0;
  const tree = module.exports.WatchCoursePlaylist({ modules, currentLesson: first, loading: false, onPress: () => presses++, ...props });
  return { tree, text: text(tree), press: () => tree.props.onPress(), presses: () => presses };
}

test('posição atravessa módulos e tocar o card abre a playlist uma vez, sem alterar o catálogo', () => {
  const before = JSON.stringify(modules), h = render({ currentLesson: third });
  assert.match(h.text, /Aulas do curso/); assert.match(h.text, /Aula 3 de 3/); assert.match(h.text, /Aplicando o aprendizado/);
  assert.equal(h.tree.props.accessibilityRole, 'button'); assert.match(h.tree.props.accessibilityLabel, /Aula 3 de 3.*Aplicando o aprendizado/);
  h.press(); assert.equal(h.presses(), 1); assert.equal(JSON.stringify(modules), before);
});
test('trocar de aula atual atualiza posição e título sem usar a ordem individual dentro do módulo', () => {
  const firstView = render(), nextView = render({ currentLesson: second });
  assert.match(firstView.text, /Aula 1 de 3/); assert.match(nextView.text, /Aula 2 de 3/); assert.match(nextView.text, /Uma prática guiada/); assert.doesNotMatch(nextView.text, /Comece por aqui/);
});
test('carregamento não apresenta contagem ou título antigos e ainda permite abrir a lista', () => {
  const h = render({ loading: true, currentLesson: third });
  assert.match(h.text, /Carregando aulas/); assert.doesNotMatch(h.text, /Aula 3 de 3|Aplicando o aprendizado/); assert.equal(has(h.tree, 'spinner'), true);
  assert.deepEqual(h.tree.props.accessibilityState, { disabled: false, busy: true }); h.press(); assert.equal(h.presses(), 1);
});
test('erro usa mensagem pública sem números ou diagnóstico bruto e conserva a entrada do sheet', () => {
  const h = render({ error: 'Internal transport diagnostic', currentLesson: third });
  assert.match(h.text, /Não foi possível carregar as aulas/); assert.doesNotMatch(h.text, /Internal|Aula 3 de 3|Aplicando o aprendizado/); assert.equal(has(h.tree, 'spinner'), false);
  h.press(); assert.equal(h.presses(), 1);
});
test('curso vazio não inventa Aula 0 de 0 nem Aula 1 de 0', () => {
  const h = render({ modules: [{ id: 'empty', lessons: [] }], currentLesson: null });
  assert.match(h.text, /Nenhuma aula disponível/); assert.doesNotMatch(h.text, /\d/); assert.doesNotMatch(h.tree.props.accessibilityLabel, /\d/);
});
test('sem aula atual apresenta somente total confirmado; aula de outro catálogo não ganha posição falsa', () => {
  for (const currentLesson of [null, lesson('other-course', 'Título de outro curso')]) {
    const h = render({ currentLesson });
    assert.match(h.text, /3 aulas/); assert.match(h.text, /Escolha uma aula para começar/); assert.doesNotMatch(h.text, /Aula 0|Aula 1 de|Título de outro curso/);
  }
  assert.match(render({ modules: [{ id: 'single', lessons: [first] }], currentLesson: null }).text, /1 aula\b/);
});
test('disabled mantém a ação bloqueada também na fronteira do callback', () => {
  const h = render({ disabled: true }); assert.equal(h.tree.props.disabled, true); assert.equal(h.tree.props.accessibilityState.disabled, true);
  h.press(); assert.equal(h.presses(), 0);
});
test('rótulo acessível conserva título completo e posição, com fallback honesto para título vazio', () => {
  const title = 'Uma aula extensa sobre como organizar o próprio processo de criação sem perder o contexto';
  const current = lesson('long', title), h = render({ modules: [{ id: 'one', lessons: [current] }], currentLesson: current });
  assert.equal(h.tree.props.accessibilityLabel, `Aulas do curso. Aula 1 de 1. ${title}`);
  const untitled = lesson('untitled', '  '); assert.match(render({ modules: [{ id: 'one', lessons: [untitled] }], currentLesson: untitled }).text, /Aula sem título/);
});
