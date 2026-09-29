import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { microphoneError, useClassyDictation } from "./useClassyDictation";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function renderHook(callback: () => ReturnType<typeof useClassyDictation>) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const result = { current: undefined as unknown as ReturnType<typeof useClassyDictation> };
  function Harness() { result.current = callback(); return null; }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() => root.render(createElement(Harness)));
  return { result, unmount: () => act(() => root.unmount()) };
}

describe("ditado da Classy", () => {
  it("diferencia permissão de dispositivo ausente ou ocupado", () => {
    expect(microphoneError(new DOMException("", "NotFoundError"))).toContain("Nenhum microfone");
    expect(microphoneError(new DOMException("", "NotReadableError"))).toContain("outro aplicativo");
    expect(microphoneError(new DOMException("", "NotAllowedError"))).toContain("configurações do sistema");
  });
  it("libera o microfone se o usuário cancelar enquanto a permissão está pendente", async () => {
    let resolve!: (stream: MediaStream) => void;
    const stop = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>(r => { resolve = r; })) } });
    vi.stubGlobal("MediaRecorder", class {});
    const { result } = renderHook(() => useClassyDictation(vi.fn()));
    let task!: Promise<void>;
    act(() => { task = result.current.toggle(); });
    act(() => result.current.cancel());
    await act(async () => { resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream); await task; });
    expect(stop).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("idle");
  });
  it("encerra a captura e não envia áudio ao desmontar o componente", async () => {
    const stop = vi.fn();
    const recorderStop = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
    vi.stubGlobal("MediaRecorder", class { static isTypeSupported() { return true; } state = "inactive"; start() { this.state = "recording"; } stop() { this.state = "inactive"; recorderStop(); } });
    const transcript = vi.fn();
    const { result, unmount } = renderHook(() => useClassyDictation(transcript));
    await act(async () => { await result.current.toggle(); });
    expect(result.current.status).toBe("recording");
    unmount();
    expect(stop).toHaveBeenCalledOnce();
    expect(recorderStop).toHaveBeenCalledOnce();
    expect(transcript).not.toHaveBeenCalled();
  });
});

it("transcreve ao terminar e entrega texto para revisão, sem enviar ao chat", async () => {
  const stop = vi.fn();
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { text: "Quero revisar esta aula." }, error: null, response: undefined });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported() { return true; }
    state = "inactive"; mimeType = "audio/webm";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["testaudio"], { type: "audio/webm" }) }); this.onstop?.(); }
  });
  const transcript = vi.fn();
  const { result, unmount } = renderHook(() => useClassyDictation(transcript));
  await act(async () => { await result.current.toggle(); });
  await act(async () => { await result.current.toggle(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(supabase.functions.invoke).toHaveBeenCalledWith("transcribe-audio", expect.objectContaining({ body: expect.objectContaining({ mimeType: "audio/webm", audioBase64: expect.any(String) }) }));
  expect(transcript).toHaveBeenCalledWith("Quero revisar esta aula.");
  expect(stop).toHaveBeenCalledOnce();
  expect(result.current.status).toBe("idle");
  unmount();
});

it.each([false, true])("ausência de áudio/fala volta ao estado normal sem alerta de erro, payload=%s", async hasPayload => {
  const stop = vi.fn();
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { text: "", noSpeech: true }, error: null, response: undefined });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported() { return true; }
    state = "inactive"; mimeType = "audio/webm";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; if (hasPayload) this.ondataavailable?.({ data: new Blob(["silence"], { type: "audio/webm" }) }); this.onstop?.(); }
  });
  const transcript = vi.fn();
  const { result, unmount } = renderHook(() => useClassyDictation(transcript));
  await act(async () => { await result.current.toggle(); });
  await act(async () => { await result.current.toggle(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(result.current.status).toBe("idle");
  expect(toast.info).toHaveBeenCalledWith("Nenhum áudio capturado. Tente novamente.");
  expect(toast.error).not.toHaveBeenCalled();
  expect(transcript).not.toHaveBeenCalled();
  if (!hasPayload) expect(supabase.functions.invoke).not.toHaveBeenCalled();
  unmount();
});
