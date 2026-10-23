import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStudioRecordingSelection, saveStudioRecordingSelection } from './recordingSetupPreferences';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('escolhas de preparação por conta', () => {
  it('restaura somente as escolhas da mesma conta, sem mídia ou ativação', () => {
    const selection = { kind: 'short' as const, mode: 'remote' as const, remoteScenes: true };
    saveStudioRecordingSelection('creator', selection);
    expect(readStudioRecordingSelection('creator', true)).toEqual(selection);
    expect(readStudioRecordingSelection('outro', true)).toBeNull();
    expect(JSON.parse(localStorage.getItem('classfy-studio-setup-v1:creator')!)).toEqual(selection);
  });

  it('revalida Premium e suporte sem apagar a escolha para quando estiver elegível', () => {
    saveStudioRecordingSelection('creator', { kind: 'aula', mode: 'remote', remoteScenes: true });
    expect(readStudioRecordingSelection('creator', false)).toEqual({ kind: 'aula', mode: 'camera', remoteScenes: false });
    expect(readStudioRecordingSelection('creator', true, false)).toEqual({ kind: 'aula', mode: 'remote', remoteScenes: false });
    expect(readStudioRecordingSelection('creator', true)).toEqual({ kind: 'aula', mode: 'remote', remoteScenes: true });
    saveStudioRecordingSelection('creator', { kind: 'aula', mode: 'scenes', remoteScenes: false });
    expect(readStudioRecordingSelection('creator', true, false)?.mode).toBe('camera');
  });
  it('projeto existente lê somente sua escolha explícita, sem herdar outro projeto ou a preferência global', () => {
    const remote = { kind: 'aula' as const, mode: 'remote' as const, remoteScenes: false };
    saveStudioRecordingSelection('creator', remote);
    expect(readStudioRecordingSelection('creator', true, true, 'project')).toBeNull();
    saveStudioRecordingSelection('creator', remote, 'project');
    expect(readStudioRecordingSelection('creator', true, true, 'project')).toEqual(remote);
    expect(readStudioRecordingSelection('creator', true, true, 'other-project')).toBeNull();
    expect(readStudioRecordingSelection('other-owner', true, true, 'project')).toBeNull();
    expect(readStudioRecordingSelection('creator', false, true, 'project')?.mode).toBe('camera');
  });

  it('rejeita dados inválidos e normaliza podcast para áudio', () => {
    for (const raw of ['{', 'null', '{"kind":"live","mode":"camera","remoteScenes":false}', '{"kind":"aula","mode":"camera","remoteScenes":"true"}']) {
      localStorage.setItem('classfy-studio-setup-v1:creator', raw);
      expect(readStudioRecordingSelection('creator', true)).toBeNull();
    }
    saveStudioRecordingSelection('creator', { kind: 'podcast', mode: 'remote', remoteScenes: true });
    expect(readStudioRecordingSelection('creator', true)).toEqual({ kind: 'podcast', mode: 'camera', remoteScenes: false });
  });

  it('armazenamento restrito não impede preparar ou gravar', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('restricted', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('restricted', 'SecurityError'); });
    expect(readStudioRecordingSelection('creator', true)).toBeNull();
    expect(() => saveStudioRecordingSelection('creator', { kind: 'aula', mode: 'camera', remoteScenes: false })).not.toThrow();
  });
});
