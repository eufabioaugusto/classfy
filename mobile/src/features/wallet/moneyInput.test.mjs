import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyInput } from './moneyInput.ts';

test('lê reais com vírgula e mantém os centavos do saque', () => {
  assert.equal(parseMoneyInput('12,50'), 12.5);
  assert.equal(parseMoneyInput('10,05'), 10.05);
  assert.equal(parseMoneyInput(' 0,29 '), 0.29);
  assert.equal(parseMoneyInput('12,5'), 12.5);
});

test('lê agrupamento brasileiro completo e decimal com ponto simples', () => {
  assert.equal(parseMoneyInput('1.234,56'), 1234.56);
  assert.equal(parseMoneyInput('12.345.678,90'), 12345678.9);
  assert.equal(parseMoneyInput('12.50'), 12.5);
  assert.equal(parseMoneyInput('0.01'), 0.01);
});

test('inteiros e zero mantêm o valor para as validações existentes', () => {
  assert.equal(parseMoneyInput('120'), 120);
  assert.equal(parseMoneyInput('0'), 0);
  assert.equal(parseMoneyInput('0,00'), 0);
});

test('rejeita negativos, vazio e sinais sem fazer conversão parcial', () => {
  for (const input of ['', '  ', '-12,50', '-12.50', '+12,50', '--1']) {
    assert.equal(parseMoneyInput(input), null, input);
  }
});

test('rejeita múltiplos separadores e agrupamentos ambíguos', () => {
  for (const input of ['1.234', '1,234.56', '1,2,3', '12.34,56', '1..234,56', '1.234.56', '12,,50']) {
    assert.equal(parseMoneyInput(input), null, input);
  }
});

test('não trunca precisão maior que centavos nem entradas incompletas', () => {
  for (const input of ['12,345', '12.3456', '12,', '12.', ',50', '.50']) {
    assert.equal(parseMoneyInput(input), null, input);
  }
});

test('não aceita texto, notação exponencial ou símbolos de moeda', () => {
  for (const input of ['12,50abc', '12abc', '1e3', 'Infinity', 'NaN', 'R$ 12,50', '1 234,56']) {
    assert.equal(parseMoneyInput(input), null, input);
  }
});

test('rejeita quantias cuja representação em centavos perde precisão', () => {
  assert.equal(parseMoneyInput('9007199254740991,00'), null);
});
