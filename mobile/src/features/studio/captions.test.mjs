import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudioCaptions, addStudioCaptionCues } from './captions.ts';
import { emptyStudioEditing, compileStudioRecipe, withStudioTakes } from './model.ts';
test('SRT e VTT preservam tempos, português e multiline', () => {
  assert.deepEqual(parseStudioCaptions('1\n00:00:01,250 --> 00:00:02,750\nUma ação\ncom qualidade\n', 3), [{ start:1.25, end:2.75, text:'Uma ação\ncom qualidade' }]);
  assert.equal(parseStudioCaptions('WEBVTT\n\n00:01.250 --> 00:02.750 align:center\n<b>Olá!</b>',3)[0].text, 'Olá!');
  assert.throws(() => parseStudioCaptions('00:00:01,000 --> 00:00:04,000\nOi',3));
});
test('legendas ancoradas no original respeitam corte e restauração', () => {
  const editing = emptyStudioEditing('aula'); editing.assets.push({id:'original',kind:'video',uri:'file:///original.mp4',name:'A',durationTicks:1200000}); editing.main.push({id:'take',assetId:'original',sourceStartTicks:240000,sourceEndTicks:960000});
  const next = addStudioCaptionCues(editing,'take',[{start:1,end:3,text:'Começo'},{start:7,end:9,text:'Final'}],(() => {let n=0;return()=>`cue${++n}`;})());
  const recipe = compileStudioRecipe(withStudioTakes({kind:'aula',editing:next}));
  assert.deepEqual(recipe.clips.filter(c=>c.kind==='caption').map(c=>[c.startTicks,c.durationTicks]),[[0,120000],[600000,120000]]);
});

test('transcrição cria grupos legíveis com tempos reais das palavras', async () => {
  const { studioTranscriptCues } = await import('./captions.ts');
  const words = 'Aprender com qualidade exige clareza e um bom exemplo para praticar agora'.split(' ').map((text,index)=>({text,startSeconds:index*.3,endSeconds:index*.3+.2}));
  const cues = studioTranscriptCues([{text:'',startSeconds:0,endSeconds:4,words}],4);
  assert.ok(cues.length > 1); assert.equal(cues[0].start,0);
  assert.ok(cues.every(cue=>cue.text.length<=42 && cue.end>cue.start));
  assert.equal(cues.at(-1).end, words.at(-1).endSeconds);
});
