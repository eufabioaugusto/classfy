import { describe, expect, it } from 'vitest';
import { parseDesktopCaptions } from './captionImport';
import { snapStudioTime, webStudioTrim } from './timelineGeometry';

describe('timeline desktop: intervalo real e alinhamento', () => {
  it('corta uma origem com velocidade sem alterar a outra borda nem ultrapassar a fonte', () => {
    expect(webStudioTrim(2, 7, 10, 'start', 144, 72, 2)).toEqual({ start: 6, end: 7 });
    expect(webStudioTrim(2, 7, 10, 'start', 1000, 72, 2)).toEqual({ start: 6.8, end: 7 });
    expect(webStudioTrim(2, 7, 10, 'end', 1000, 72)).toEqual({ start: 2, end: 10 });
    expect(webStudioTrim(2, 7, 10, 'start', -1000, 72)).toEqual({ start: 0, end: 7 });
  });
  it('alinha por distância visível, mas conserva posição livre quando desligado', () => {
    expect(snapStudioTime(1.05, [0, 1, 5], 72, true)).toBe(1);
    expect(snapStudioTime(1.05, [0, 1, 5], 240, true)).toBe(1.05);
    expect(snapStudioTime(1.05, [0, 1, 5], 72, false)).toBe(1.05);
  });
});
describe('importação de legendas reais', () => {
  it('preserva acentos, linhas e milissegundos sem permitir HTML do arquivo', () => {
    expect(parseDesktopCaptions('\uFEFF1\r\n00:00:01,125 --> 00:00:03,250\r\nAção e educação\r\n<b>Com qualidade</b>\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nPróximo assunto')).toEqual([
      { start: 1.125, end: 3.25, text: 'Ação e educação\nCom qualidade' }, { start: 4, end: 5, text: 'Próximo assunto' },
    ]);
  });
  it('recusa arquivo malformado e intervalos impossíveis em vez de importar parcialmente', () => {
    expect(() => parseDesktopCaptions('texto sem tempos')).toThrow('SRT');
    expect(() => parseDesktopCaptions('1\n00:61:00,000 --> 00:62:00,000\nAula')).toThrow('tempo inválido');
    expect(() => parseDesktopCaptions('1\n00:00:02,000 --> 00:00:01,000\nAula')).toThrow('duração');
  });
});
