import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioTeleprompterMatcher as matcher, tokenizeStudioTeleprompterScript as tokenize } from './StudioTeleprompterTracking.ts';

test('PT-BR conserva offsets UTF16, espaços e pontuação para pintar exatamente o trecho falado', () => {
  const script = '🎬 AÇÃO, café!\nD’água — vídeo 2026.', words = tokenize(script);
  assert.deepEqual(words.map(w => w.normalized), ['acao', 'cafe', 'dagua', 'video', '2026']);
  assert.equal(words[0].start, 3); assert.equal(words[1].punctuation, '!\n'); assert.equal(words[2].punctuation, ' — ');
  words.forEach((word, index) => { assert.equal(word.index, index); assert.equal(script.slice(word.start, word.end), word.text); });
  assert.equal(words.at(-1).punctuation, '.');
});
test('parcial cumulativa e revisão mantêm origem fixa, sem pintar duas vezes nem retroceder', () => {
  const m = matcher('A iluminação suave melhora muito a qualidade do vídeo. Depois cuidamos do áudio.');
  assert.equal(m.follow({ text: 'a iluminacao suave melhora', segmentId: 1 }).readWordCount, 4);
  assert.equal(m.follow({ text: 'a iluminação suave', segmentId: 1 }).readWordCount, 4);
  assert.equal(m.follow({ text: 'a iluminação suave melhora muito a qualidade do vídeo', final: true, segmentId: 1 }).readWordCount, 9);
  assert.equal(m.follow({ text: 'a iluminação suave melhora muito a qualidade do vídeo', final: true, segmentId: 1 }).matched, false);
  assert.equal(m.follow({ text: 'depois cuidamos do audio', final: true, segmentId: 2 }).readWordCount, 13);
});
test('silêncio, ruído, uma palavra comum e pauta distante não deslocam o texto', () => {
  const m = matcher('A primeira iluminação apresenta detalhes importantes da imagem antes de começarmos o roteiro completo para ensinar pessoas.');
  for (const text of ['', '...', 'o', 'para ensinar pessoas', 'a de o que vamos', 'telefone tocando qualquer assunto']) {
    const result = m.follow({ text, final: true }); assert.equal(result.readWordCount, 0); assert.equal(result.matched, false);
  }
  assert.equal(m.follow({ text: 'primeira iluminação', final: true, confidence: .1 }).readWordCount, 0);
});
test('pequenas omissões, repetição e inflexão reconhecida não exigem leitura mecânica', () => {
  const m = matcher('Iluminação bem suave melhora a qualidade de todas as gravações.');
  assert.equal(m.follow({ text: 'iluminacao iluminacao suave melhora qualidade em todas as gravacoes', final: true, segmentId: 1 }).readWordCount, 10);
  assert.equal(matcher('Planejamos conteúdos relevantes para ensinar conceitos profundos.').follow({ text: 'planejamos conteudos relevante para ensinar conceitos profundos', final: true }).readWordCount, 7);
});
test('frase repetida no roteiro não é confundida com repetição da parcial ou do final antigo', () => {
  const m = matcher('Iluminação suave melhora detalhes. Aprendemos áudio com cuidado. Iluminação suave melhora detalhes.');
  const first = { text: 'iluminação suave melhora detalhes', final: true, segmentId: 1 };
  assert.equal(m.follow(first).readWordCount, 4);
  assert.equal(m.follow({ text: 'aprendemos áudio com cuidado', final: true, segmentId: 2 }).readWordCount, 8);
  assert.equal(m.follow(first).readWordCount, 8);
  assert.equal(m.follow({ ...first, final: false }).matched, false);
  assert.equal(m.follow({ ...first, segmentId: 3 }).readWordCount, 12);
  m.reset(); assert.equal(m.follow(first).readWordCount, 4);
});
test('frase comum exata só avança alinhada à âncora atual', () => {
  assert.equal(matcher('Eu estou aqui com você. Agora vamos estudar iluminação.').follow({ text: 'eu estou aqui com voce', final: false }).readWordCount, 5);
  assert.equal(matcher('Iluminação mostra detalhes antes de aprender. Eu estou aqui com você.').follow({ text: 'eu estou aqui com voce', final: true }).readWordCount, 0);
  assert.equal(matcher('Hoje vamos aprender. Iluminação suave destaca detalhes.').follow({ text: 'hoje vamos aprender', final: true }).readWordCount, 3);
});
test('finais com confiança explicitamente baixa são rejeitados, mesmo com palavras do roteiro', () => {
  for (const confidence of [.1, .3]) assert.equal(matcher('Hoje vamos aprender.').follow({ text: 'hoje vamos aprender', final: true, confidence }).readWordCount, 0);
});
test('cumulativa longa mantém leitura contínua em janelas locais e não salta ao fim distante', () => {
  const words = Array.from({ length: 180 }, (_, i) => `conceito${i}`), m = matcher(words.join(' '));
  for (const count of [30, 63, 100, 150, 180]) assert.equal(m.follow({ text: words.slice(0, count).join(' '), segmentId: 1 }).readWordCount, count);
  assert.equal(m.follow({ text: words.join(' '), segmentId: 1 }).matched, false);
  const long = matcher(Array.from({ length: 2000 }, (_, i) => `trecho${i} conceito${i}`).join(' '));
  assert.equal(long.follow({ text: 'trecho1999 conceito1999', final: true }).readWordCount, 0);
  long.reset(2000); assert.equal(long.follow({ text: 'trecho1000 conceito1000', final: true }).readWordCount, 2002);
});
test('reset explícito, script vazio e índice inválido conservam cursor seguro', () => {
  const m = matcher('Iluminação suave melhora detalhes.', NaN);
  assert.equal(m.follow({ text: 'iluminacao suave melhora detalhes', final: true }).readWordCount, 4);
  assert.equal(m.reset().readWordCount, 0); assert.equal(m.reset(-20).offset, 0);
  assert.equal(m.reset(100).offset, 'Iluminação suave melhora detalhes.'.length);
  assert.deepEqual(matcher('').follow({ text: 'qualquer fala' }), { readWordCount: 0, offset: 0, matched: false, confidence: 0 });
});
