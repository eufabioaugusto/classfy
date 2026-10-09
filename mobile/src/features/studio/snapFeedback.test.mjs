import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

function load(relative, dependencies, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'globalThis', 'Date', code)(name => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, globals.globalThis ?? globalThis, globals.Date ?? Date);
  return module.exports;
}

function bridge(native) {
  return load('../../../modules/classfy-studio-media/index.ts', {
    'expo-modules-core': { requireOptionalNativeModule: () => native },
  });
}

function feedback(native) {
  const appState = { currentState: 'active' };
  let now = 0;
  const module = load('./snapFeedback.ts', {
    'react-native': { AppState: appState },
    '../../../modules/classfy-studio-media': bridge(native),
  }, { globalThis: { performance: { now: () => now } } });
  return { perform: module.performStudioSnapFeedback, appState, time: value => { now = value; } };
}

test('binário sem módulo ou sem método mantém feedback opcional, sem vibração substituta', async () => {
  for (const native of [null, {}]) {
    assert.equal(await bridge(native).performStudioSelectionFeedbackAsync(), false);
    const h = feedback(native);
    assert.equal(h.perform(), undefined);
    h.time(80);
    assert.doesNotThrow(h.perform);
  }
});

test('ponte mantém retorno nativo real e receiver, sem fabricar sucesso em app inativo', async () => {
  const native = { active: false, performStudioSelectionFeedbackAsync() { return Promise.resolve(this.active); } };
  const module = bridge(native);
  assert.equal(await module.performStudioSelectionFeedbackAsync(), false);
  native.active = true;
  assert.equal(await module.performStudioSelectionFeedbackAsync(), true);
  assert.equal(await bridge({ performStudioSelectionFeedbackAsync: async () => undefined }).performStudioSelectionFeedbackAsync(), false);
});

test('um orçamento compartilhado coalesce eixos no mesmo frame e admite novo snap após 70ms', () => {
  let calls = 0;
  const h = feedback({ performStudioSelectionFeedbackAsync: async () => { calls++; return true; } });
  h.perform(); h.perform(); // X and Y acquire together.
  h.time(69.999); h.perform();
  assert.equal(calls, 1);
  h.time(70); h.perform();
  h.time(139.999); h.perform();
  assert.equal(calls, 2);
  h.time(140); h.perform();
  assert.equal(calls, 3);
});

test('background e inactive não acionam o bridge nem consomem orçamento do próximo gesto', () => {
  let calls = 0;
  const h = feedback({ performStudioSelectionFeedbackAsync: async () => { calls++; return true; } });
  for (const state of ['background', 'inactive', null]) { h.appState.currentState = state; h.perform(); }
  assert.equal(calls, 0);
  h.appState.currentState = 'active'; h.perform();
  assert.equal(calls, 1);
  h.time(100); h.appState.currentState = 'background'; h.perform();
  h.appState.currentState = 'active'; h.perform();
  assert.equal(calls, 2);
});

test('falha ou exceção síncrona nativa não rejeita o gesto nem bloqueia o próximo snap', async () => {
  let calls = 0;
  const h = feedback({ performStudioSelectionFeedbackAsync() {
    calls++;
    if (calls === 1) return Promise.reject(new Error('Native unavailable'));
    if (calls === 2) throw new Error('Bridge disposed');
    return Promise.resolve(true);
  } });
  assert.equal(h.perform(), undefined);
  await new Promise(resolve => setImmediate(resolve));
  h.time(70); assert.doesNotThrow(h.perform);
  await new Promise(resolve => setImmediate(resolve));
  h.time(140); h.perform();
  assert.equal(calls, 3);
});

test('Promise de feedback pendente não enfileira eventos nem bloqueia controles', () => {
  let calls = 0;
  const h = feedback({ performStudioSelectionFeedbackAsync: () => { calls++; return new Promise(() => {}); } });
  assert.equal(h.perform(), undefined);
  h.time(70);
  assert.equal(h.perform(), undefined);
  assert.equal(calls, 2);
});

test('generator Swift real reutiliza instância e limita chamadas na main queue com app ativo', () => {
  const source = readFileSync(new URL('../../../modules/classfy-studio-media/ios/ClassfyStudioMediaModule.swift', import.meta.url), 'utf8');
  assert.match(source, /AsyncFunction\("performStudioSelectionFeedbackAsync"\)\s*\{\s*\(\)\s*->\s*Bool\s*in\s*self\.performSelectionFeedback\(\)\s*\}\.runOnQueue\(\.main\)/);
  const start = source.indexOf('  private func performSelectionFeedback() -> Bool {');
  assert.notEqual(start, -1);
  let depth = 0, end = start;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > start);
  const method = source.slice(start, end).replace('private func', 'func');
  // Execute the production Swift method with only UIKit/hardware and clock
  // boundaries replaced. It cannot claim physical Taptic Engine validation.
  const program = `
import Foundation
enum ApplicationState { case active, inactive, background }
final class UIApplication { static let shared = UIApplication(); var applicationState = ApplicationState.active }
final class UISelectionFeedbackGenerator {
  static var instances = 0; static var selections = 0; static var preparations = 0
  init() { Self.instances += 1 }
  func selectionChanged() { Self.selections += 1 }
  func prepare() { Self.preparations += 1 }
}
final class ControlledClock { var systemUptime: TimeInterval = 0 }
enum ProcessInfo { static let processInfo = ControlledClock() }
final class NativeHarness {
  private var selectionFeedback: UISelectionFeedbackGenerator?
  private var lastSelectionFeedbackAt: TimeInterval?
${method}
}
let h = NativeHarness()
precondition(h.performSelectionFeedback())
precondition(!h.performSelectionFeedback())
ProcessInfo.processInfo.systemUptime = 0.069
precondition(!h.performSelectionFeedback())
ProcessInfo.processInfo.systemUptime = 0.071
precondition(h.performSelectionFeedback())
precondition(UISelectionFeedbackGenerator.instances == 1)
precondition(UISelectionFeedbackGenerator.selections == 2)
precondition(UISelectionFeedbackGenerator.preparations == 2)
UIApplication.shared.applicationState = .inactive
ProcessInfo.processInfo.systemUptime = 1
precondition(!h.performSelectionFeedback())
UIApplication.shared.applicationState = .background
precondition(!h.performSelectionFeedback())
precondition(UISelectionFeedbackGenerator.selections == 2)
UIApplication.shared.applicationState = .active
precondition(h.performSelectionFeedback())
precondition(UISelectionFeedbackGenerator.instances == 2)
precondition(UISelectionFeedbackGenerator.selections == 3)
precondition(UISelectionFeedbackGenerator.preparations == 3)
print("native feedback checks passed")
`;
  const output = execFileSync('xcrun', ['swift', '-'], { input: program, encoding: 'utf8', timeout: 30000 });
  assert.match(output, /native feedback checks passed/);
});
