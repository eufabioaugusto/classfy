import test from 'node:test';
import assert from 'node:assert/strict';
import { compileStudioRecipe, emptyStudioEditing, migrateStudioProject, reconcileStudioTakes, studioEffectiveOutput,
  studioOutputLabel, studioOutputSupported, studioOutputWarnings, studioSourceSummary, studioTicks, timelineSignature,
  validateStudioEditing, validateStudioRecipe, withStudioOutputSelection, withStudioStandardOutput, withStudioTakes } from './model.ts';

const t = studioTicks;
const take = (id, width = 3840, height = 2160, frameRate = 60) => ({ id, uri: `file:///Documents/classfy-studio/owner/project/${id}.mp4`, name: id,
  duration: 4, start: 0, end: 4, width, height, frameRate });
const editing = (sources = [take('main')], kind = 'aula') => reconcileStudioTakes({ kind, editing: emptyStudioEditing(kind) }, sources);
const project = value => withStudioTakes({ id: 'project', ownerId: 'owner', version: 2, kind: 'aula', editing: value });
const capabilities = (patch = {}) => ({ version: 2, available: true, colorSpace: 'rec709', minimumDimension: 64, maximumDimension: 3840,
  maximumShortDimension: 2160, maximumPixels: 8294400, arbitraryEvenDimensions: true, supportsHEVC: true,
  resolutions: [{ id: 'hd', width: 1920, height: 1080, codec: 'h264' }, { id: '2k', width: 2560, height: 1440, codec: 'hevc' }, { id: '4k', width: 3840, height: 2160, codec: 'hevc' }],
  frameRates: [24,25,30,50,60].map(numerator => ({ numerator, denominator: 1 })).concat([24000,30000,60000].map(numerator => ({ numerator, denominator: 1001 }))), ...patch });

test('novos projetos preservam fontes 320p/720p/2K/4K e FPS real sem aumentar qualidade fictícia', () => {
  for (const [width, height] of [[320,180],[1280,720],[2560,1440],[3840,2160]]) for (const fps of [24,25,30,50,60]) {
    const value = editing([take('a', width, height, fps)]), output = studioEffectiveOutput(value);
    assert.deepEqual([output.width, output.height, output.frameRateNumerator, output.frameRateDenominator], [width,height,fps,1]);
    assert.deepEqual(validateStudioEditing(value, 'aula'), []);
    assert.deepEqual(studioOutputWarnings(value), []);
  }
});
test('escolhas explícitas HD/2K/4K × 24/30/60 mantêm canvas e originais imutáveis', () => {
  for (const [resolution, width, height] of [['hd',1920,1080],['2k',2560,1440],['4k',3840,2160]]) for (const frameRate of [24,30,60]) for (const aspectRatio of ['landscape','portrait','square']) {
    const initial = editing(), originals = structuredClone(initial.assets);
    const value = withStudioOutputSelection({ ...initial, canvas: { ...initial.canvas, aspectRatio } }, { resolution, frameRate });
    const output = studioEffectiveOutput(value);
    assert.deepEqual([output.width,output.height], aspectRatio === 'portrait' ? [height,width] : aspectRatio === 'square' ? [height,height] : [width,height]);
    assert.equal(output.frameRateNumerator, frameRate); assert.equal(output.frameRateDenominator, 1);
    assert.deepEqual(value.assets, originals); assert.deepEqual(validateStudioEditing(value,'aula'), []);
  }
});
test('Original preserva cadência fracionária e informa conversão quando o usuário escolhe 24/30/60', () => {
  for (const [numerator, fps] of [[24000,23.976024],[30000,29.97003],[60000,59.94006]]) {
    const initial = editing([take('a',1280,720,fps)]);
    const output = studioEffectiveOutput(initial);
    assert.equal(output.frameRateNumerator,numerator); assert.equal(output.frameRateDenominator,1001);
    assert.equal(studioOutputWarnings(initial).length,0);
    assert.ok(studioOutputWarnings(withStudioOutputSelection(initial,{ resolution:'original',frameRate:Math.round(fps) })).some(value=>value.code==='fps-conversion'));
  }
});
test('fontes mistas ou maiores que 4K/60 preservam o limite efetivo e expõem conversões', () => {
  const value = editing([take('a',1920,1080,24),take('b',7680,4320,120)]);
  const out = studioEffectiveOutput(value);
  assert.deepEqual([out.width,out.height,out.frameRateNumerator],[3840,2160,60]);
  const warnings = studioOutputWarnings(value), firstSource = value.main[0].assetId;
  assert.ok(warnings.some(value=>value.code==='upscale' && value.assetIds.includes(firstSource)));
  assert.ok(warnings.some(value=>value.code==='downscale'));
  assert.ok(warnings.some(value=>value.code==='fps-conversion' && value.assetIds.length===2));
  assert.deepEqual(studioSourceSummary(value).frameRates,[24,120]);
});
test('Original só usa fontes referenciadas, incluindo PiP/imagem; arquivo órfão 8K não muda a saída', () => {
  const base = editing([take('a',1280,720,24)]);
  const unused = { id:'unused',kind:'video',uri:'file:///unused.mp4',name:'unused',durationTicks:t(1),width:7680,height:4320,frameRate:120 };
  const orphan = { ...base, assets:[...base.assets,unused] };
  assert.deepEqual(studioEffectiveOutput(orphan),studioEffectiveOutput(base));
  assert.equal(timelineSignature(project(orphan)),timelineSignature(project(base)));
  const withLayer = { ...orphan, layers:[{ id:'overlay',kind:'video',items:[{ id:'pip',kind:'video',assetId:'unused',atTicks:0,durationTicks:t(1),sourceStartTicks:0,sourceEndTicks:t(1) }] }] };
  assert.equal(studioEffectiveOutput(withLayer).width,3840);
});
test('resolução é par, segue o aspecto do canvas e avisa conversão HDR ou metadados ausentes', () => {
  const value = editing([take('odd',1919,1079,0)]);
  value.assets[0].colorSpace='BT.2020 HLG';
  const output = studioEffectiveOutput(value);
  assert.equal(output.width%2,0); assert.equal(output.height%2,0);
  assert.ok(Math.abs(output.width-output.height*16/9)<=2);
  assert.ok(studioOutputWarnings(value).some(value=>value.code==='unknown-source'));
  assert.ok(studioOutputWarnings(value).some(value=>value.code==='sdr-conversion'));
});
test('migração v1 não recertifica outro perfil e schema2 existente sem selection não muda', () => {
  const legacy = { ...project(editing()), version:1, takes:[take('a')], editing:undefined };
  const migrated = migrateStudioProject(legacy);
  assert.equal(migrated.editing.output.profile,'legacy-source'); assert.equal(migrated.editing.output.selection,undefined);
  const standard = { ...editing(), output:{ profile:'standard',width:1920,height:1080,frameRateNumerator:30,frameRateDenominator:1,colorSpace:'rec709' } };
  const before = project(standard), signature = timelineSignature(before);
  const reopened = migrateStudioProject(JSON.parse(JSON.stringify(before)));
  assert.deepEqual(studioEffectiveOutput(reopened.editing),standard.output); assert.equal(timelineSignature(reopened),signature);
  assert.equal(withStudioStandardOutput(standard),standard);
  const converted = withStudioStandardOutput(migrated.editing);
  assert.deepEqual([studioEffectiveOutput(converted).width,studioEffectiveOutput(converted).frameRateNumerator],[3840,60]);
});
test('escolha nova é serializada e invalida a assinatura; título e container não', () => {
  const original = project(editing([take('a')]));
  const chosen = project(withStudioOutputSelection(original.editing,{ resolution:'2k',frameRate:24 }));
  assert.notEqual(timelineSignature(chosen),timelineSignature(original));
  assert.equal(timelineSignature({ ...chosen,title:'Novo' }),timelineSignature(chosen));
  const rebased = project({ ...chosen.editing,assets:chosen.editing.assets.map(asset=>({ ...asset,uri:asset.uri.replace('Documents','Another/Documents') })) });
  assert.equal(timelineSignature(rebased),timelineSignature(chosen));
  assert.deepEqual(migrateStudioProject(JSON.parse(JSON.stringify(chosen))).editing.output.selection,{ resolution:'2k',frameRate:24 });
});
test('binário antigo não sinaliza suporte a 4K/60/720; novo respeita as capacidades reais', () => {
  const old = capabilities({ version:1,arbitraryEvenDimensions:false,resolutions:[{ id:'hd',width:1920,height:1080,codec:'h264' }],frameRates:[{ numerator:30,denominator:1 }],maximumDimension:1920,maximumShortDimension:1080,maximumPixels:2073600 });
  const hd = studioEffectiveOutput(withStudioOutputSelection(editing(),{ resolution:'hd',frameRate:30 }));
  assert.equal(studioOutputSupported(hd,old),true);
  for (const value of [editing(),editing([take('a',1280,720,30)]),withStudioOutputSelection(editing(),{ resolution:'hd',frameRate:60 })]) assert.equal(studioOutputSupported(studioEffectiveOutput(value),old),false);
  assert.equal(studioOutputSupported(studioEffectiveOutput(editing()),capabilities()),true);
  assert.equal(studioOutputSupported(hd,capabilities({ available:false })),false);
  assert.equal(studioOutputSupported(hd,capabilities({ maximumPixels:1000 })),false);
});
test('receita inválida não certifica perfil fora dos limites de resolução, FPS e SDR', () => {
  const recipe = compileStudioRecipe(project(editing()));
  for (const patch of [{width:7680,height:4320},{width:1919,height:1080},{frameRateNumerator:120},{frameRateNumerator:48},{colorSpace:'source'},{selection:{resolution:'fake',frameRate:30}}]) {
    assert.ok(validateStudioRecipe({ ...recipe,output:{...recipe.output,...patch} }).some(issue=>issue.includes('saída')));
  }
  assert.throws(()=>withStudioOutputSelection(editing(),{resolution:'4k',frameRate:120}),/válidos/);
  assert.match(studioOutputLabel(editing([take('a',1280,720,24000/1001)])),/^720p · 23\.976 FPS · SDR$/);
});

test('Original ultrawide mantém detalhe da fonte com margens, em vez de baixar a largura', () => {
  const value = editing([take('wide',3840,1600,24)]);
  const output = studioEffectiveOutput(value);
  assert.deepEqual([output.width,output.height],[3840,2160]);
  assert.deepEqual(studioOutputWarnings(value),[]);
});
