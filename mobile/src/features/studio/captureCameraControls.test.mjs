import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('./StudioCaptureCamera.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function harness({ available = true, native = true } = {}) {
  const slots = [], calls = [], timers = new Map(); let cursor = 0, effects = [], dirty = true, output, timerId = 0, enabled = true, facing = 'front', tag = 73, manualConfigure = false;
  let device = { deviceId: 'front', position: 'front', quality: '1080p', fps: 30, width: 1920, height: 1080, minZoom: 1, maxZoom: 6, zoom: 1, generation: 1, revision: 1,
    qualities: ['720p', '1080p', '2160p'].map(quality => ({ quality, fps: [24, 30, 60] })), orientation: 'portrait', supportsExposure: true, supportsFocus: true, supportsFocusLock: true, supportsTorch: true, minExposure: -2, maxExposure: 2, exposure: 0 };
  const equal = (a, b) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useRef: value => { const i = cursor++; return slots[i] ||= { current: value }; },
    useState: value => { const i = cursor++; if (!slots[i]) slots[i] = { value }; return [slots[i].value, next => { slots[i].value = next; dirty = true; }]; },
    useEffect: (callback, deps) => { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) effects.push({ i, callback, deps }); },
  };
  const capabilities = async target => { calls.push({ kind: 'capabilities', target }); return { ...device }; };
  const configure = (target, options) => {
    calls.push({ kind: 'configure', target, options });
    const result = { ...device, ...options, generation: device.generation + 1, revision: device.revision + 1, maxZoom: device.maxZoom === device.minZoom ? device.maxZoom : options.quality === '2160p' ? 2 : 6,
      width: options.quality === '2160p' ? 3840 : options.quality === '720p' ? 1280 : 1920, height: options.quality === '2160p' ? 2160 : options.quality === '720p' ? 720 : 1080 };
    result.zoom = Math.min(result.maxZoom, result.zoom);
    if (manualConfigure) return new Promise(resolve => { calls.at(-1).resolve = patch => { device = { ...result, ...patch }; resolve({ ...device }); }; });
    device = result; return Promise.resolve({ ...device });
  };
  const zoom = (target, factor) => new Promise((resolve, reject) => calls.push({ kind: 'zoom', target, factor, profile: { ...device }, resolve, reject }));
  const deps = { react: hooks, 'react-native': { findNodeHandle: () => tag }, 'expo-screen-orientation': { getOrientationAsync: async () => 1, Orientation: { LANDSCAPE_LEFT: 3 } },
    './StudioNativeCamera': { isStudioNativeCameraHandle: value => !!value?.studioNative },
    '../../../modules/classfy-studio-media': {
      isStudioCameraControlsAvailable: () => available, isStudioNativeCameraAvailable: () => available,
      getStudioCameraCapabilitiesAsync: capabilities, getStudioNativeCameraCapabilitiesAsync: capabilities,
      configureStudioCameraAsync: configure, configureStudioNativeCameraAsync: configure,
      setStudioCameraZoomAsync: zoom, setStudioNativeCameraZoomAsync: zoom,
      setStudioCameraExposureAsync: async () => device, setStudioNativeCameraExposureAsync: async () => device,
      setStudioCameraFocusAsync: async () => device, setStudioNativeCameraFocusAsync: async () => device, setStudioNativeCameraTorchAsync: async () => device,
    } };
  const module = { exports: {} }; new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(name => deps[name], module, module.exports, callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
  const camera = { current: native ? { studioNative: true, getNativeTag: () => tag } : {} };
  const render = () => { cursor = 0; effects = []; dirty = false; output = module.exports.useStudioCaptureCamera(camera, facing, enabled, { native, orientation: 'portrait' }); for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }; } };
  const pump = async () => { for (let i = 0; i < 20; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) return; } throw new Error('Hook did not settle'); };
  render();
  return { ...module.exports, calls, pump, output: () => output, initialize: async () => { const result = await output.initialize(); await pump(); return result; },
    zoom: value => output.setZoom(value), flush: async () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } await pump(); },
    ack: (call, patch = {}) => { call.resolve({ ...call.profile, ...patch }); },
    manualConfigure: () => { manualConfigure = true; },
    device: patch => { device = { ...device, ...patch }; },
    update: patch => { if ('enabled' in patch) enabled = patch.enabled; if ('facing' in patch) facing = patch.facing; if ('tag' in patch) tag = patch.tag; dirty = true; },
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); } };
}
test('zoom usa todo o limite real, inclusive 100×, sem teto artificial ou NaN', () => {
  const h = harness(); near(h.studioZoomFactor(.5, { minZoom: 1, maxZoom: 100 }), 10); near(h.studioNormalizedZoom(10, { minZoom: 1, maxZoom: 100 }), .5);
  assert.equal(h.studioZoomFactor(2, { minZoom: 1, maxZoom: 100 }), 100); assert.equal(h.studioZoomFactor(-1, { minZoom: 1, maxZoom: 100 }), 1);
  assert.equal(h.studioZoomFactor(NaN, { minZoom: 1, maxZoom: 100 }), 1); assert.equal(h.studioZoomFactor(1, { minZoom: NaN, maxZoom: Infinity }), 1);
  assert.equal(h.studioNormalizedZoom(Infinity, { minZoom: 1, maxZoom: 6 }), 0); h.unmount();
});
for (const native of [true, false]) test(`zoom confirmado não é otimista; coalescing entrega só último alvo (${native ? 'native' : 'Expo bridge'})`, async () => {
  const h = harness({ native }); try { await h.initialize(); h.zoom(.1); h.zoom(.5); h.zoom(1); await h.pump();
    const receipt = h.output().zoomConfirmation; assert.equal(h.output().zoomPending, true);
    assert.equal(h.output().state.zoom, 1); await h.flush(); const call = h.calls.filter(call => call.kind === 'zoom').at(-1); assert.equal(call.factor, 6); assert.equal(h.calls.filter(call => call.kind === 'zoom').length, 1);
    h.ack(call, { zoom: 5.9 }); await h.pump(); assert.equal(h.output().state.zoom, 5.9); assert.equal(h.output().zoomPending, false); assert.equal(h.output().zoomConfirmation, receipt + 1);
  } finally { h.unmount(); }
});
test('HD→4K reduz limite real e ignora ACK antigo mesmo quando o tag é o mesmo', async () => {
  const h = harness(); try { await h.initialize(); h.zoom(1); await h.flush(); const old = h.calls.filter(call => call.kind === 'zoom').at(-1);
    await h.output().configure('2160p'); await h.pump(); assert.equal(h.output().state.maxZoom, 2);
    h.ack(old, { zoom: 99, maxZoom: 100 }); await h.pump(); assert.equal(h.output().state.quality, '2160p'); assert.equal(h.output().state.maxZoom, 2); assert.equal(h.output().state.zoom, 1);
    h.zoom(1); await h.flush(); const latest = h.calls.filter(call => call.kind === 'zoom').at(-1); assert.equal(latest.factor, 2); h.ack(latest, { zoom: 2 }); await h.pump(); assert.equal(h.output().state.zoom, 2);
  } finally { h.unmount(); }
});
test('não envia zoom enquanto configure está pendente e cancela alvo ainda não enviado', async () => {
  const h = harness(); try { await h.initialize(); h.zoom(.7); h.manualConfigure(); const configure = h.output().configure('2160p'); await h.pump();
    h.zoom(1); await h.flush(); assert.equal(h.calls.some(call => call.kind === 'zoom'), false); const call = h.calls.filter(call => call.kind === 'configure').at(-1); call.resolve({}); await configure; await h.pump();
    assert.equal(h.output().busy, false); assert.equal(h.output().state.maxZoom, 2);
  } finally { h.unmount(); }
});
test('ACK de geração/perfil diferente não altera zoom da sessão montada', async () => {
  const h = harness(); try { await h.initialize(); const before = h.output().state; h.zoom(1); await h.flush(); const call = h.calls.filter(call => call.kind === 'zoom').at(-1);
    h.ack(call, { generation: before.generation + 1, zoom: 6 }); await h.pump(); assert.equal(h.output().state.zoom, 1);
  } finally { h.unmount(); }
});
test('erro do hardware não modifica o zoom confirmado ou inventa imagem ampliada', async () => {
  const h = harness(); try { await h.initialize(); const receipt = h.output().zoomConfirmation; h.zoom(1); await h.flush(); h.calls.filter(call => call.kind === 'zoom').at(-1).reject(new Error('Câmera indisponível'));
    await h.pump(); assert.equal(h.output().state.zoom, 1); assert.match(h.output().error, /indisponível/); assert.equal(h.output().zoomPending, false); assert.equal(h.output().zoomConfirmation, receipt + 1);
  } finally { h.unmount(); }
});
test('ACK repetido publica receipt e ACK antigo não libera o alvo mais recente pendente', async () => {
  const h = harness(); try { await h.initialize(); h.zoom(.4); await h.flush(); const first = h.calls.filter(call => call.kind === 'zoom').at(-1);
    h.ack(first, { zoom: 1.5 }); await h.pump(); const receipt = h.output().zoomConfirmation;
    h.zoom(.45); await h.flush(); const old = h.calls.filter(call => call.kind === 'zoom').at(-1); h.zoom(.5); await h.flush(); const latest = h.calls.filter(call => call.kind === 'zoom').at(-1);
    h.ack(old, { zoom: 4 }); await h.pump(); assert.equal(h.output().zoomPending, true); assert.equal(h.output().zoomConfirmation, receipt); assert.equal(h.output().state.zoom, 1.5);
    h.ack(latest, { zoom: 1.5 }); await h.pump(); assert.equal(h.output().zoomPending, false); assert.equal(h.output().zoomConfirmation, receipt + 1); assert.equal(h.output().state.zoom, 1.5);
  } finally { h.unmount(); }
});
test('disabled/troca de perfil cancela pending e receipt obsoleto não invade a nova sessão', async () => {
  const h = harness(); try { await h.initialize(); h.zoom(.4); await h.flush(); const old = h.calls.filter(call => call.kind === 'zoom').at(-1); const receipt = h.output().zoomConfirmation;
    h.update({ enabled: false }); await h.pump(); assert.equal(h.output().zoomPending, false); assert.equal(h.output().zoomConfirmation, receipt + 1); const resetReceipt = h.output().zoomConfirmation;
    h.ack(old, { zoom: 6 }); await h.pump(); assert.equal(h.output().state, null); assert.equal(h.output().zoomPending, false); assert.equal(h.output().zoomConfirmation, resetReceipt);
  } finally { h.unmount(); }
});
test('troca de câmera invalida comandos, timers e ACK da câmera anterior', async () => {
  const h = harness(); try { await h.initialize(); h.zoom(1); await h.flush(); const old = h.calls.filter(call => call.kind === 'zoom').at(-1);
    h.update({ facing: 'back', tag: 99 }); h.device({ deviceId: 'back', position: 'back', zoom: 1 }); await h.pump(); await h.initialize(); h.ack(old, { zoom: 6 }); await h.pump();
    assert.equal(h.output().state.deviceId, 'back'); assert.equal(h.output().state.zoom, 1); assert.equal(await h.output().prepareRecording(), true);
  } finally { h.unmount(); }
});
test('REC aguarda última roda confirmar e não inicia ramp posterior ao prepare', async () => {
  const h = harness(); try { await h.initialize(); h.zoom(.5); const prepare = h.output().prepareRecording(); await h.pump();
    assert.equal(h.output().busy, true); const call = h.calls.filter(call => call.kind === 'zoom').at(-1); near(call.factor, Math.sqrt(6));
    h.zoom(1); h.ack(call, { zoom: Math.sqrt(6) }); assert.equal(await prepare, true); await h.flush(); assert.equal(h.calls.filter(call => call.kind === 'zoom').length, 1);
    assert.equal(h.output().state.zoom, Math.sqrt(6));
  } finally { h.unmount(); }
});
test('câmera sem zoom ou sem ponte não recebe comando falso', async () => {
  const h = harness(); try { h.device({ minZoom: 1, maxZoom: 1 }); await h.initialize(); assert.equal(h.output().zoomAvailable, false); h.zoom(1); await h.flush(); assert.equal(h.calls.some(call => call.kind === 'zoom'), false);
  } finally { h.unmount(); }
  const fallback = harness({ available: false, native: false }); try { assert.equal(await fallback.initialize(), true); fallback.zoom(1); await fallback.flush(); assert.equal(fallback.output().state, null); assert.equal(fallback.output().zoomAvailable, false); assert.equal(fallback.calls.length, 0); }
  finally { fallback.unmount(); }
});
