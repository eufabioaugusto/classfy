import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function microphoneError(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "O acesso ao microfone foi bloqueado. Confira a permissão do site e do aplicativo nas configurações do sistema.";
  if (name === "TimeoutError" || name === "AbortError") return "A transcrição demorou para responder. Tente novamente.";
  if (name === "NotFoundError") return "Nenhum microfone foi encontrado. Conecte ou selecione um microfone.";
  if (name === "NotReadableError") return "Não foi possível abrir o microfone. Confira se ele está disponível ou sendo usado por outro aplicativo.";
  return error instanceof Error ? error.message : "Não foi possível iniciar a gravação. Tente novamente.";
}
function encodeAudio(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível preparar o áudio."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
}
export function useClassyDictation(onTranscript: (text: string) => void) {
  const [status, setStatus] = useState<"idle" | "starting" | "recording" | "transcribing">("idle");
  const statusRef = useRef(status);
  const session = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const callback = useRef(onTranscript);
  callback.current = onTranscript;
  const update = useCallback((value: typeof status) => { statusRef.current = value; setStatus(value); }, []);
  const release = useCallback(() => {
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  }, []);
  const cancel = useCallback(() => {
    session.current++;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    release();
    update("idle");
  }, [release, update]);
  useEffect(() => () => { session.current++; if (recorder.current?.state === "recording") recorder.current.stop(); release(); }, [release]);
  const toggle = useCallback(async () => {
    if (statusRef.current === "recording") { if (recorder.current?.state === "recording") recorder.current.stop(); return; }
    if (statusRef.current !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Este navegador não oferece gravação de áudio. Abra a Classfy em um navegador atualizado."); return;
    }
    const token = ++session.current;
    update("starting");
    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (token !== session.current) { audio.getTracks().forEach(track => track.stop()); return; }
      stream.current = audio;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(audio, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      recorder.current = capture;
      const chunks: Blob[] = [];
      let bytes = 0;
      capture.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); bytes += event.data.size; if (bytes > 2 * 1024 * 1024 && capture.state === "recording") capture.stop(); } };
      capture.onerror = () => { if (token === session.current) { cancel(); toast.error("A gravação foi interrompida. Tente novamente."); } };
      capture.onstop = async () => {
        if (token !== session.current) return;
        release();
        recorder.current = null;
        if (!bytes || bytes > 2 * 1024 * 1024) { update("idle"); toast.info("Grave uma mensagem de até um minuto e tente novamente."); return; }
        update("transcribing");
        try {
          const blob = new Blob(chunks, { type: capture.mimeType || "audio/webm" });
          const audioBase64 = await encodeAudio(blob);
          if (token !== session.current) return;
          const { data, error } = await supabase.functions.invoke("transcribe-audio", { body: { audioBase64, mimeType: blob.type }, signal: AbortSignal.timeout(60000) });
          if (token !== session.current) return;
          if (error || data?.error) throw new Error(data?.error || "Não foi possível transcrever o áudio. Tente novamente.");
          if (!data?.text?.trim()) { toast.info("Não identifiquei fala no áudio. Tente falar novamente."); return; }
          callback.current(data.text.trim());
        } catch (error) { if (token === session.current) toast.error(microphoneError(error)); }
        finally { if (token === session.current) update("idle"); }
      };
      capture.start(1000);
      update("recording");
      timer.current = setTimeout(() => { if (capture.state === "recording") capture.stop(); }, 60000);
    } catch (error) {
      if (token === session.current) { release(); update("idle"); toast.error(microphoneError(error)); }
    }
  }, [cancel, release, update]);
  return { status, toggle, cancel };
}
