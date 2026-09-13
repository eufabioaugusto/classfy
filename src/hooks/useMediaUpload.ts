import { useCallback, useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { videoService } from "@/lib/video/service";
import type { VideoUploadTarget } from "@/lib/video/types";
import type { MediaUploadState } from "@/lib/studio/publication";
import {
  beginBackgroundUpload,
  updateBackgroundUpload,
  updateBackgroundUploadByMediaAsset,
} from "@/lib/studio/backgroundUploads";

type UploadResult = VideoUploadTarget & { fileUrl: string };

export function useMediaUpload({
  keepTransferOnUnmount = false,
}: { keepTransferOnUnmount?: boolean } = {}) {
  const [state, setState] = useState<MediaUploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const tusRef = useRef<tus.Upload | null>(null);
  const pollRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  const watchUntilReady = useCallback(
    async (mediaAssetId: string) => {
      stopPolling();
      setState("processing");
      const poll = async () => {
        const { data, error: queryError } = await (supabase as any)
          .from("media_assets")
          .select("status")
          .eq("id", mediaAssetId)
          .maybeSingle();
        if (queryError) {
          pollRef.current = window.setTimeout(poll, 2500);
          return;
        }
        if (data?.status === "ready") {
          setState("ready");
          updateBackgroundUploadByMediaAsset(mediaAssetId, {
            state: "ready",
            progress: 100,
          });
          stopPolling();
          return;
        }
        if (["failed", "deleted", "missing"].includes(data?.status)) {
          setState("failed");
          updateBackgroundUploadByMediaAsset(mediaAssetId, { state: "failed" });
          setError(
            "A mídia não pôde ser processada. Substitua o arquivo e tente novamente.",
          );
          stopPolling();
          return;
        }
        pollRef.current = window.setTimeout(poll, 2500);
      };
      await poll();
    },
    [stopPolling],
  );

  const upload = useCallback(
    async ({
      file,
      title,
      mediaType,
      draftId,
      slotKey,
      backgroundTaskId,
      onTargetCreated,
    }: {
      file: File;
      title: string;
      mediaType: "video" | "audio";
      draftId?: string | null;
      slotKey?: string | null;
      backgroundTaskId?: string | null;
      onTargetCreated?: (target: UploadResult) => void | Promise<void>;
    }): Promise<UploadResult> => {
      const taskId =
        backgroundTaskId ||
        beginBackgroundUpload({ draftId, title: file.name });
      setError(null);
      setProgress(0);
      setState("preparing");
      let target: VideoUploadTarget;
      let result: UploadResult;
      try {
        target = await videoService.createUpload(title || file.name, {
          mediaType,
          draftId,
          slotKey,
        });
        result = { ...target, fileUrl: `media:${target.mediaAssetId}` };
        updateBackgroundUpload(taskId, {
          draftId: draftId ?? null,
          mediaAssetId: target.mediaAssetId,
          title: title || file.name,
          state: "uploading",
          progress: 0,
        });
        await onTargetCreated?.(result);
        setState("uploading");
      } catch (uploadError) {
        setState("failed");
        updateBackgroundUpload(taskId, { state: "failed" });
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Não foi possível preparar o envio.",
        );
        throw uploadError;
      }

      try {
        if (target.method === "TUS") {
          await new Promise<void>((resolve, reject) => {
            const request = new tus.Upload(file, {
              endpoint: target.uploadUrl,
              retryDelays: [0, 2000, 5000, 10000],
              headers: target.headers,
              metadata: {
                filename: file.name,
                filetype: file.type,
                title: title || file.name,
              },
              onProgress: (sent, total) => {
                const nextProgress =
                  total > 0 ? Math.round((sent / total) * 100) : 0;
                setProgress(nextProgress);
                updateBackgroundUpload(taskId, {
                  state: "uploading",
                  progress: nextProgress,
                });
              },
              onSuccess: resolve,
              onError: reject,
            });
            tusRef.current = request;
            request.start();
          });
        } else if (target.method === "PUT") {
          await new Promise<void>((resolve, reject) => {
            const request = new XMLHttpRequest();
            xhrRef.current = request;
            request.upload.onprogress = (event) => {
              if (!event.lengthComputable) return;
              const nextProgress = Math.round(
                (event.loaded / event.total) * 100,
              );
              setProgress(nextProgress);
              updateBackgroundUpload(taskId, {
                state: "uploading",
                progress: nextProgress,
              });
            };
            request.onload = () =>
              request.status >= 200 && request.status < 300
                ? resolve()
                : reject(new Error("O servidor recusou o arquivo."));
            request.onerror = () =>
              reject(new Error("A conexão foi interrompida durante o upload."));
            request.onabort = () =>
              reject(new DOMException("Upload cancelado", "AbortError"));
            request.open("PUT", target.uploadUrl);
            Object.entries(target.headers ?? {}).forEach(([name, value]) =>
              request.setRequestHeader(name, value),
            );
            request.setRequestHeader(
              "Content-Type",
              file.type || "application/octet-stream",
            );
            request.send(file);
          });
        } else if (target.method !== "MOCK") {
          throw new Error("Método de upload não suportado.");
        }

        setProgress(100);
        updateBackgroundUpload(taskId, {
          state: "processing",
          progress: 100,
        });
        if (mountedRef.current) void watchUntilReady(target.mediaAssetId);
        return result;
      } catch (uploadError) {
        if (
          uploadError instanceof DOMException &&
          uploadError.name === "AbortError"
        ) {
          setState("cancelled");
        } else {
          setState("failed");
          updateBackgroundUpload(taskId, { state: "failed" });
          setError(
            uploadError instanceof Error
              ? uploadError.message
              : "Não foi possível enviar o arquivo.",
          );
        }
        throw uploadError;
      } finally {
        xhrRef.current = null;
        tusRef.current = null;
      }
    },
    [watchUntilReady],
  );

  const cancel = useCallback(() => {
    xhrRef.current?.abort();
    tusRef.current?.abort(true).catch(() => undefined);
    stopPolling();
    setState("cancelled");
  }, [stopPolling]);

  const resumeProcessing = useCallback(
    (mediaAssetId: string) => {
      void watchUntilReady(mediaAssetId);
    },
    [watchUntilReady],
  );
  const reset = useCallback(() => {
    cancel();
    setProgress(0);
    setError(null);
    setState("idle");
  }, [cancel]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
      if (keepTransferOnUnmount) return;
      xhrRef.current?.abort();
      tusRef.current?.abort();
    };
  }, [keepTransferOnUnmount, stopPolling]);

  return {
    state,
    progress,
    error,
    upload,
    cancel,
    reset,
    resumeProcessing,
    setState,
  };
}
