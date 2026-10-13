import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteCameraAudioInputSelected, remoteCameraAudioInputState, remoteCameraAudioPortLabel } from './remoteCameraAudioPicker.ts';

const builtIn = { id: 'builtin', name: 'Microfone do iPhone', type: 'MicrophoneBuiltIn' };
const usb = { id: 'usb', name: 'USB Audio', type: 'USBAudio' };
const state = { version: 1, available: [builtIn, usb], preferredId: null, current: builtIn, confirmed: true, selecting: false, warning: null };
test('ports são observados do sistema, sem inventar lista ou entrada ativa para payload ausente/inválido', () => {
  assert.equal(remoteCameraAudioInputState(state), state);
  const empty = remoteCameraAudioInputState({ ...state, available: [], current: null, confirmed: false }); assert.deepEqual(empty.available, []); assert.equal(empty.current, null);
});
test('snapshot inválido é rejeitado sem transformar preferência em microfone ativo', () => {
  for (const patch of [null, { ...state, version: 2 }, { ...state, available: [usb, usb] }, { ...state, available: [{ ...usb, name: '' }] },
    { ...state, available: [{ ...usb, id: '' }] }, { ...state, current: { ...usb, type: '' } }, { ...state, preferredId: '' },
    { ...state, confirmed: 'yes' }, { ...state, selecting: undefined }, { ...state, warning: 123 }]) assert.equal(remoteCameraAudioInputState(patch), null);
});
test('Automático é modo confirmado; port manual exige preferredId e currentRoute iguais', () => {
  assert.equal(remoteCameraAudioInputSelected(state, null), true); assert.equal(remoteCameraAudioInputSelected(state, builtIn.id), false);
  const request = { ...state, preferredId: usb.id, current: builtIn, confirmed: false, selecting: true };
  assert.equal(remoteCameraAudioInputSelected(request, usb.id), false); assert.equal(remoteCameraAudioInputSelected({ ...request, confirmed: true }, usb.id), false);
  assert.equal(remoteCameraAudioInputSelected({ ...request, current: usb, confirmed: true, selecting: false }, usb.id), true);
  assert.equal(remoteCameraAudioInputSelected({ ...state, current: null }, null), false);
});
test('tipo do sistema dá contexto genérico e conserva o nome informado sem inferir marca', () => {
  assert.equal(remoteCameraAudioPortLabel('USBAudio'), 'USB'); assert.equal(remoteCameraAudioPortLabel('BluetoothHFP'), 'Bluetooth');
  assert.equal(remoteCameraAudioPortLabel('HeadsetMic'), 'Conectado por cabo'); assert.equal(remoteCameraAudioPortLabel('MicrophoneBuiltIn'), 'Integrado');
  assert.equal(remoteCameraAudioPortLabel('unknown'), 'Entrada disponível');
});
