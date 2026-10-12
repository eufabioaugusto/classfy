import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { mergeStudioCameraProSettings } from './cameraProSettings.ts';

const source = ts.transpileModule(readFileSync(new URL('./StudioCaptureProControls.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX },
}).outputText;
const state = { version:1, supportsExposure:true, autoExposure:false, minISO:32, maxISO:1600, iso:100,
  minShutterSeconds:1/10000, maxShutterSeconds:1/60, shutterSeconds:1/120, supportsWhiteBalance:true,
  autoWhiteBalance:false, minWhiteBalanceGain:1, maxWhiteBalanceGain:4, redGain:2, greenGain:1, blueGain:2,
  supportsTemperatureAndTint:true, temperatureKelvin:5400, whiteBalanceTint:12,
  supportsFocus:true, autoFocus:false, lensPosition:.5 };
function panel(patch = {}) {
  const slots = [], changes = []; let cursor=0, tree, props={ state:{ ...state,...patch }, disabled:false, pending:false, confirmation:1, onChange:value=>changes.push(value) };
  const jsx=(type,props)=>({ type,props:props||{} });
  const dependencies={ react:{ useState:initial=>{ const index=cursor++; slots[index] ??= { value:initial }; return [slots[index].value,next=>{ slots[index].value=typeof next==='function'?next(slots[index].value):next; render(); }]; } },
    'react/jsx-runtime':{ jsx,jsxs:jsx,Fragment:'fragment' },
    'react-native':{ Pressable:'button',Text:'text',View:'view',StyleSheet:{ create:value=>value } },
    '@/theme/colors':{ colors:{} }, './StudioCaptureZoom':{ StudioCaptureZoom:'wheel' } };
  const module={ exports:{} }; new Function('require','module','exports',source)(name=>{ assert.ok(Object.hasOwn(dependencies,name)); return dependencies[name]; },module,module.exports);
  function render() { cursor=0; tree=module.exports.StudioCaptureProControls(props); }
  function nodes(predicate) { const values=[]; const visit=node=>{ if(Array.isArray(node)) { node.forEach(visit); return; } if(!node||typeof node!=='object') return; if(predicate(node)) values.push(node); visit(node.props?.children); }; visit(tree); return values; }
  render(); return { changes,nodes,update:patch=>{ props={...props,...patch};render(); },
    wheel:name=>{ const value=nodes(node=>node.type==='wheel'&&node.props.controlName===name)[0]; assert.ok(value,`Missing ${name}`); return value.props; },
    button:label=>{ const value=nodes(node=>node.type==='button'&&node.props.accessibilityLabel===label)[0]; assert.ok(value,`Missing ${label}`); return value.props; } };
}

test('PRO aplica ISO, obturador e foco usando ranges reais; mostra ACK em vez do alvo',()=>{
  const h=panel(); h.wheel('iso').onChange(1); assert.deepEqual(h.changes.at(-1),{ autoExposure:false,iso:1600 });
  assert.equal(h.wheel('iso').label,'100'); assert.ok(h.wheel('iso').value<1);
  h.wheel('obturador').onChange(1); assert.equal(h.changes.at(-1).shutterSeconds,1/60,'Manual exposure cannot invent a shutter longer than selected FPS permits');
  h.wheel('posição da lente').onChange(.9); assert.deepEqual(h.changes.at(-1),{ autoFocus:false,lensPosition:.9 });
  h.update({ pending:true,confirmation:2,state:{...state,iso:390} });
  assert.equal(h.wheel('iso').label,'390'); assert.equal(h.wheel('iso').pending,true); assert.equal(h.wheel('iso').confirmation,2);
  assert.equal(h.wheel('iso').confirmedValue,h.wheel('iso').value);
});
test('Kelvin e matiz são principais; RGB é avançado e comandos não misturam espaços',()=>{
  const h=panel(); assert.equal(h.nodes(node=>node.type==='wheel'&&node.props.controlName==='vermelho').length,0);
  h.wheel('temperatura').onChange(.75); assert.deepEqual(h.changes.at(-1),{ autoWhiteBalance:false,temperatureKelvin:8000 });
  assert.equal(h.wheel('temperatura').label,'5400 K'); h.wheel('matiz').onChange(0); assert.deepEqual(h.changes.at(-1),{ autoWhiteBalance:false,whiteBalanceTint:-150 });
  h.button('Mostrar ganhos RGB avançados').onPress(); h.wheel('vermelho').onChange(1); assert.deepEqual(h.changes.at(-1),{ autoWhiteBalance:false,redGain:4 });
  h.button('Balanço de branco automático').onPress(); assert.deepEqual(h.changes.at(-1),{ autoWhiteBalance:true });
});
test('capability ausente preserva RGB; formato sem manual não fabrica ajustes físicos',()=>{
  const legacy=panel({ supportsTemperatureAndTint:undefined,temperatureKelvin:undefined,whiteBalanceTint:undefined });
  assert.equal(legacy.nodes(node=>node.type==='wheel'&&node.props.controlName==='temperatura').length,0); assert.equal(legacy.wheel('azul').label,'2.00×');
  const unsupported=panel({ supportsExposure:false,supportsWhiteBalance:false,supportsFocus:false }); assert.equal(unsupported.nodes(node=>node.type==='wheel').length,0);
  assert.equal(unsupported.nodes(node=>node.type==='button').length,0);
});
test('coalescing mantém só intenção WB atual sem apagar controles independentes',()=>{
  const initial={ iso:400,redGain:3,blueGain:2,lensPosition:.8 };
  const kelvin=mergeStudioCameraProSettings(initial,{ temperatureKelvin:7200 });
  assert.deepEqual(kelvin,{ iso:400,lensPosition:.8,temperatureKelvin:7200 });
  const tint=mergeStudioCameraProSettings(kelvin,{ whiteBalanceTint:30 }); assert.deepEqual(tint,{...kelvin,whiteBalanceTint:30});
  const rgb=mergeStudioCameraProSettings(tint,{ greenGain:1.5 }); assert.deepEqual(rgb,{ iso:400,lensPosition:.8,greenGain:1.5 });
  assert.deepEqual(mergeStudioCameraProSettings(tint,{ autoWhiteBalance:true }),{ iso:400,lensPosition:.8,autoWhiteBalance:true });
});
