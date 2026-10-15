import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MiniPlayerProvider, useMiniPlayer } from './MiniPlayerContext';

const mocks = vi.hoisted(() => ({
  user: { id: 'viewer' } as { id: string } | null,
  metadata: null as unknown,
  setMetadata: vi.fn(), setPlaybackState: vi.fn(), setPositionState: vi.fn(), clearSession: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/hooks/useMediaSession', () => ({ useMediaSession: () => mocks }));

let root: Root, host: HTMLDivElement, api: ReturnType<typeof useMiniPlayer>;
const content = { id: 'lesson', title: 'Uma aula', file_url: 'https://media.example/video.mp4', duration_seconds: 120,
  creator: { display_name: 'Criador' } };
function Consumer() { api = useMiniPlayer(); return <video ref={api.videoRef} />; }
function WatchOwner() {
  useEffect(() => {
    mocks.setMetadata({ title: 'Watch principal' });
    return mocks.clearSession;
  }, []);
  return <Consumer />;
}
async function render(watch = false) {
  await act(async () => root.render(<MiniPlayerProvider>{watch ? <WatchOwner /> : <Consumer />}</MiniPlayerProvider>));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.user = { id: 'viewer' }; mocks.metadata = null;
  vi.clearAllMocks();
  mocks.setMetadata.mockImplementation(value => { mocks.metadata = value; });
  mocks.clearSession.mockImplementation(() => { mocks.metadata = null; });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('handoff de playback e propriedade de MediaSession no MiniPlayer', () => {
  it('preserva pausa quando o player principal transfere o conteúdo com playing=false', async () => {
    await render();
    await act(async () => api.startMiniPlayer(content, 42, false));
    expect(api.state).toMatchObject({ content, isVisible: true, isPlaying: false, currentTime: 42, duration: 120 });
    expect(mocks.setPlaybackState).toHaveBeenLastCalledWith('paused');
    expect(mocks.setPositionState).toHaveBeenLastCalledWith({ duration: 120, position: 42 });
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('mantém playing=true como padrão dos chamadores existentes', async () => {
    await render(); await act(async () => api.startMiniPlayer(content, 18));
    expect(api.state.isPlaying).toBe(true); expect(api.state.currentTime).toBe(18);
    expect(mocks.setPlaybackState).toHaveBeenLastCalledWith('playing');
  });

  it('handoff mobile sem estado informado conserva reprodução pelo padrão de undefined', async () => {
    await render(); await act(async () => api.startMiniPlayer(content, 18, false));
    expect(api.state.isPlaying).toBe(false);
    await act(async () => api.startMiniPlayer(content, 20, undefined));
    expect(api.state.isPlaying).toBe(true); expect(api.state.currentTime).toBe(20);
    expect(mocks.setPlaybackState).toHaveBeenLastCalledWith('playing');
  });

  it('provider oculto não apaga metadados nem handlers pertencentes ao Watch', async () => {
    await render(true);
    expect(api.state.isVisible).toBe(false); expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.metadata).toEqual({ title: 'Watch principal' });
    await act(async () => api.setCurrentTime(5));
    expect(mocks.clearSession).not.toHaveBeenCalled(); expect(mocks.metadata).toEqual({ title: 'Watch principal' });
  });

  it('fechar um MiniPlayer ativo libera a sessão que ele configurou uma vez', async () => {
    await render(); expect(mocks.clearSession).not.toHaveBeenCalled();
    await act(async () => api.startMiniPlayer(content, 42, false));
    expect(mocks.setMetadata).toHaveBeenCalledOnce();
    await act(async () => api.closeMiniPlayer());
    expect(mocks.clearSession).toHaveBeenCalledOnce();
    expect(api.state).toMatchObject({ content: null, isVisible: false, isPlaying: false, currentTime: 0 });
    await act(async () => api.closeMiniPlayer()); expect(mocks.clearSession).toHaveBeenCalledOnce();
  });

  it('logout fecha a própria reprodução e limpa apenas a sessão ativa do MiniPlayer', async () => {
    await render(); await act(async () => api.startMiniPlayer(content, 28));
    mocks.user = null; await render();
    expect(api.state.content).toBeNull(); expect(api.state.isPlaying).toBe(false);
    expect(mocks.clearSession).toHaveBeenCalledOnce(); expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('troca direta de conta encerra a mídia anterior e não herda conteúdo ou posição', async () => {
    await render(); await act(async () => api.startMiniPlayer(content, 38));
    const media = api.videoRef.current;
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    mocks.user = { id: 'another-viewer' }; await render();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();
    expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.instances[0]).toBe(media);
    expect(mocks.clearSession).toHaveBeenCalledOnce();
    expect(api.state).toMatchObject({ content: null, isVisible: false, isPlaying: false, currentTime: 0, duration: 0 });
  });

  it('renovação de sessão na mesma conta mantém reprodução e posição sem limpar MediaSession', async () => {
    await render(); await act(async () => api.startMiniPlayer(content, 38));
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    mocks.user = { id: 'viewer' }; await render();
    expect(api.state).toMatchObject({ content, isVisible: true, isPlaying: true, currentTime: 38, duration: 120 });
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled(); expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.setMetadata).toHaveBeenCalledOnce();
  });

  it('logout com MiniPlayer oculto não reivindica a sessão de outro player', async () => {
    await render(true); mocks.user = null; await render(true);
    expect(mocks.clearSession).not.toHaveBeenCalled(); expect(mocks.metadata).toEqual({ title: 'Watch principal' });
  });
});
