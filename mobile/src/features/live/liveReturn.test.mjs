import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const liveId = '73a42a03-611e-46bd-945e-8e2b1253ba32', contentId = '7fa1ca66-adc8-40d2-a2da-6747f6e125a8';
function signIn(params, error = null) {
  const source = ts.transpileModule(readFileSync(new URL('../../../app/auth/sign-in.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let cursor = 0, tree; const state = [], replacements = [], alerts = [], credentials = [];
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: { useState(value) { const i = cursor++; if (!(i in state)) state[i] = value; return [state[i], value => { state[i] = value; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { View: 'view', Text: 'text', TextInput: 'input', Pressable: 'button', Alert: { alert: (...args) => alerts.push(args) }, StyleSheet: { create: value => value } },
    'expo-router': { useLocalSearchParams: () => params, router: { replace: value => replacements.push(value), push() {} } },
    '@/components/AppScreen': { AppScreen: 'screen' }, '@/components/NavigationHeader': { NavigationHeader: 'header' }, '@/theme/controls': { controls: {} }, '@/theme/tokens': { colors: {}, radius: {}, spacing: {}, type: {} },
    '@/lib/supabase': { isSupabaseConfigured: true, supabase: { auth: { signInWithPassword: async input => { credentials.push(input); return { error }; } } } },
  };
  const module = { exports: {} }; new Function('require', 'module', 'exports', source)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const render = () => { cursor = 0; tree = module.exports.default(); };
  const find = predicate => { const walk = node => { if (Array.isArray(node)) { for (const child of node) { const found = walk(child); if (found) return found; } } else if (node && typeof node === 'object') { if (predicate(node)) return node; return walk(node.props?.children); } }; return walk(tree); };
  render();
  return { replacements, alerts, credentials, async submit() { find(node => node.props?.placeholder === 'Seu e-mail').props.onChangeText('aluno@example.test'); find(node => node.props?.placeholder === 'Sua senha').props.onChangeText('fixture-only'); render(); await find(node => node.type === 'button' && node.props?.children?.props?.children === 'Entrar').props.onPress(); } };
}
test('successful login returns to the exact native live and preserves recorded-content fallback', async () => {
  const live = signIn({ liveId, contentId }); await live.submit(); assert.deepEqual(live.replacements, [{ pathname: '/live/[id]', params: { id: liveId } }]);
  const content = signIn({ contentId }); await content.submit(); assert.deepEqual(content.replacements, [{ pathname: '/watch/[id]', params: { id: contentId } }]);
});
test('a live return id cannot be a route, invalid UUID or parameter array', async () => {
  for (const liveId of ['/studio/live/new', 'https://example.test', '../admin', '------------------------------------', ['73a42a03-611e-46bd-945e-8e2b1253ba32']]) {
    const h = signIn({ liveId }); await h.submit(); assert.deepEqual(h.replacements, ['/(tabs)']);
  }
});
test('failed authentication never opens the live', async () => {
  const h = signIn({ liveId }, { message: 'Credenciais inválidas' }); await h.submit(); assert.equal(h.replacements.length, 0); assert.deepEqual(h.alerts, [['Erro ao entrar', 'Credenciais inválidas']]);
});
