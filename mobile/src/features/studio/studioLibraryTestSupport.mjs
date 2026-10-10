import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
export function filterCatalogHarness() {
  const source = ts.transpileModule(readFileSync(new URL('./filterCatalog.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('require', 'module', 'exports', source)(() => model, module, module.exports); return module.exports;
}
export function libraryHarness(storage = new Map(), overrides = {}) {
  const source = ts.transpileModule(readFileSync(new URL('./textLibrary.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(() => ({ getItem: async key => storage.get(key), setItem: async (key, value) => { storage.set(key, value); }, ...overrides }), module, module.exports);
  return module.exports;
}
