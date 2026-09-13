import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Cloud,
  CloudOff,
  Eye,
  FileAudio,
  FileVideo,
  ImagePlus,
  LoaderCircle,
  Lock,
  RotateCcw,
  Save,
  Scissors,
  Send,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/layout";
import { CreatorTemplate } from "@/components/templates";
import {
  V2Badge,
  V2Button,
  V2Card,
  V2CardContent,
  V2CardHeader,
  V2ConfirmDialog,
  V2Input,
  V2Textarea,
} from "@/components/v2";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TagsInput } from "@/components/TagsInput";
import { StandaloneCoverSelector } from "@/components/StandaloneCoverSelector";
import { CoverImageCropper } from "@/components/CoverImageCropper";
import { VideoTrimBar } from "@/components/video-lobby/VideoTrimBar";
import {
  dataURLtoFile,
  seekAndCaptureCover,
} from "@/components/video-lobby/seekAndCapture";
import { useVideoCompression } from "@/hooks/useVideoCompression";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { usePublicationDraft } from "@/hooks/usePublicationDraft";
import { compressImage } from "@/utils/imageCompression";
import { coverTargetSize } from "@/lib/media/coverCrop";
import { videoService } from "@/lib/video/service";
import {
  beginBackgroundUpload,
  updateBackgroundUpload,
} from "@/lib/studio/backgroundUploads";
import {
  createNewPublicationDraftKey,
  getStandaloneDraftIssues,
  isPersistedPublicationDraft,
  isNewPublicationDraftKey,
  publicationDraftService,
  publicationRules,
  visibilityOptions,
  type PublicationKind,
  type PublicationDraftRecord,
  type PublicationVisibility,
  type StandalonePublicationDraft,
} from "@/lib/studio/publication";
import { toast } from "sonner";
import "@/styles/studio-v2.css";
import "@/styles/studio-publish-v2.css";

type StandaloneKind = Exclude<PublicationKind, "curso">;

function requestedKind(params: URLSearchParams): StandaloneKind {
  const value = params.get("type");
  return value === "podcast" || value === "short" ? value : "aula";
}

function mediaStatusCopy(
  state: ReturnType<typeof useMediaUpload>["state"],
  progress: number,
) {
  if (state === "preparing") return "Preparando o arquivo...";
  if (state === "uploading") return `Enviando ${progress}%`;
  if (state === "processing") return "Processando para reprodução...";
  if (state === "ready") return "Mídia pronta";
  if (state === "failed") return "O envio precisa de atenção";
  if (state === "cancelled") return "Envio cancelado";
  return "Nenhum arquivo enviado";
}

function StudioUpload() {
  const { user, role, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const [contentType, setContentType] = useState<StandaloneKind>(() =>
    requestedKind(searchParams),
  );
  const [sourceLoaded, setSourceLoaded] = useState(!editId);
  const [isResolvingResume, setIsResolvingResume] = useState(() =>
    Boolean(searchParams.get("draft")),
  );
  const [isEditMode, setIsEditMode] = useState(Boolean(editId));
  const [originalStatus, setOriginalStatus] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<PublicationVisibility>("free");
  const [price, setPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [tags, setTags] = useState<string[]>([]);
  const [fileUrl, setFileUrl] = useState("");
  const [filePreview, setFilePreview] = useState("");
  const [fileName, setFileName] = useState("");
  const [duration, setDuration] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [mediaAssetId, setMediaAssetId] = useState<string | null>(null);
  const [videoProvider, setVideoProvider] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [galleryCoverFile, setGalleryCoverFile] = useState<File | null>(null);
  const [coverEditorOpen, setCoverEditorOpen] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [captureReady, setCaptureReady] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const pendingFileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const visibleVideoRef = useRef<HTMLVideoElement>(null);
  const captureVideoRef = useRef<HTMLVideoElement>(null);
  const mediaUpload = useMediaUpload({ keepTransferOnUnmount: true });
  const compression = useVideoCompression();
  const hasSelectedMedia = Boolean(
    filePreview ||
    fileUrl ||
    mediaAssetId ||
    fileName ||
    mediaUpload.state !== "idle",
  );
  const [rules, setRules] = useState(publicationRules[contentType]);
  const newPublicationLabel =
    contentType === "aula"
      ? "uma nova aula"
      : contentType === "podcast"
        ? "um novo podcast"
        : "um novo short";
  const shellTitle =
    contentType === "aula"
      ? "Nova Aula"
      : contentType === "podcast"
        ? "Novo Podcast"
        : "Novo Short";

  useEffect(() => {
    const fallback = publicationRules[contentType];
    setRules(fallback);
    void supabase
      .from("publication_format_rules")
      .select(
        "media_type, allowed_mime_types, max_duration_seconds, cover_ratio",
      )
      .eq("kind", contentType)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setRules({
          ...fallback,
          accept: data.allowed_mime_types.join(","),
          mediaType: data.media_type === "audio" ? "audio" : "video",
          maxDurationSeconds: data.max_duration_seconds,
          coverRatio: data.cover_ratio,
        });
      });
  }, [contentType]);

  useEffect(() => {
    const type = searchParams.get("type");
    if (type === "curso") navigate("/studio/upload/curso", { replace: true });
    if (type === "live") navigate("/studio/live", { replace: true });
  }, [navigate, searchParams]);

  useEffect(() => {
    if (!editId || !user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("contents")
        .select("*")
        .eq("id", editId)
        .eq("creator_id", user.id)
        .single();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Não foi possível abrir este conteúdo para edição.");
        navigate("/studio/contents", { replace: true });
        return;
      }
      const type = data.content_type as StandaloneKind;
      setContentType(type);
      setIsEditMode(true);
      setOriginalStatus(data.status);
      setTitle(data.title);
      setDescription(data.description ?? "");
      setVisibility((data.visibility ?? "free") as PublicationVisibility);
      setPrice(String(data.price ?? 0));
      setDiscount(String(data.discount ?? 0));
      setTags(data.tags ?? []);
      setFileName("");
      setFileUrl(data.file_url ?? "");
      setMediaAssetId(data.media_asset_id ?? null);
      setVideoProvider(data.video_provider ?? null);
      setDuration(data.duration_seconds ?? 0);
      setThumbnailUrl(data.thumbnail_url ?? "");
      setThumbnailPreview(data.thumbnail_url ?? "");
      if (data.media_asset_id) {
        setWizardStep(2);
        const { data: asset } = await (supabase as any)
          .from("media_assets")
          .select("status")
          .eq("id", data.media_asset_id)
          .maybeSingle();
        if (asset?.status === "ready") mediaUpload.setState("ready");
        else mediaUpload.resumeProcessing(data.media_asset_id);
      }
      setSourceLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [editId, navigate, user]);

  const payload = useMemo<StandalonePublicationDraft>(
    () => ({
      title,
      description,
      visibility,
      price,
      discount,
      tags,
      fileName,
      fileUrl,
      thumbnailUrl,
      duration,
      mediaAssetId,
      videoProvider,
      uploadState: mediaUpload.state,
    }),
    [
      description,
      discount,
      duration,
      fileName,
      fileUrl,
      mediaAssetId,
      mediaUpload.state,
      price,
      tags,
      thumbnailUrl,
      title,
      videoProvider,
      visibility,
    ],
  );
  const latestPayloadRef = useRef(payload);
  latestPayloadRef.current = payload;

  const restoreDraft = useCallback(
    (
      restored: StandalonePublicationDraft,
      record: PublicationDraftRecord<StandalonePublicationDraft>,
    ) => {
      setTitle(restored.title ?? "");
      setDescription(restored.description ?? "");
      setVisibility(restored.visibility ?? "free");
      setPrice(restored.price ?? "0");
      setDiscount(restored.discount ?? "0");
      setTags(restored.tags ?? []);
      setFileName(
        restored.mediaAssetId || restored.fileUrl
          ? (restored.fileName ?? "")
          : "",
      );
      setFileUrl(restored.fileUrl ?? "");
      setThumbnailUrl(restored.thumbnailUrl ?? "");
      setThumbnailPreview(restored.thumbnailUrl ?? "");
      setDuration(restored.duration ?? 0);
      setMediaAssetId(restored.mediaAssetId ?? null);
      setVideoProvider(restored.videoProvider ?? null);
      if (restored.mediaAssetId) {
        setWizardStep(2);
        if (restored.uploadState === "ready") mediaUpload.setState("ready");
        else mediaUpload.resumeProcessing(restored.mediaAssetId);
        setIsResolvingResume(false);
        return;
      }
      void (async () => {
        try {
          let { data: linkedAsset } = await (supabase as any)
            .from("media_assets")
            .select("id, status, duration_seconds")
            .eq("publication_draft_id", record.id)
            .is("abandoned_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!linkedAsset) {
            const { data: draftAsset } = await (supabase as any)
              .from("publication_draft_assets")
              .select("media_asset_id")
              .eq("draft_id", record.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (draftAsset?.media_asset_id) {
              const result = await (supabase as any)
                .from("media_assets")
                .select("id, status, duration_seconds")
                .eq("id", draftAsset.media_asset_id)
                .maybeSingle();
              linkedAsset = result.data;
            }
          }
          if (!linkedAsset?.id) return;
          setFileUrl(`media:${linkedAsset.id}`);
          setMediaAssetId(linkedAsset.id);
          if (linkedAsset.duration_seconds)
            setDuration(linkedAsset.duration_seconds);
          setWizardStep(2);
          if (linkedAsset.status === "ready") mediaUpload.setState("ready");
          else if (linkedAsset.status === "failed")
            mediaUpload.setState("failed");
          else mediaUpload.resumeProcessing(linkedAsset.id);
        } finally {
          setIsResolvingResume(false);
        }
      })();
    },
    [mediaUpload.resumeProcessing, mediaUpload.setState],
  );

  const requestedDraftKey = searchParams.get("draft");
  const canResumeRequestedDraft =
    !editId && isNewPublicationDraftKey(contentType, requestedDraftKey);
  const [generatedDraftKey] = useState(() =>
    createNewPublicationDraftKey(contentType),
  );

  const draftKey = editId
    ? `${contentType}:edit:${editId}`
    : canResumeRequestedDraft
      ? requestedDraftKey!
      : generatedDraftKey;

  useEffect(() => {
    if (editId || canResumeRequestedDraft) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("draft", generatedDraftKey);
    setSearchParams(nextParams, { replace: true });
  }, [
    canResumeRequestedDraft,
    editId,
    generatedDraftKey,
    searchParams,
    setSearchParams,
  ]);

  const draft = usePublicationDraft({
    userId: user?.id,
    draftKey,
    kind: contentType,
    sourceType: editId ? "content" : null,
    sourceId: editId,
    payload,
    enabled: sourceLoaded,
    onRestore: restoreDraft,
  });

  useEffect(() => {
    if (draft.state !== "loading" && !draft.draftId)
      setIsResolvingResume(false);
  }, [draft.draftId, draft.state]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        ["preparing", "uploading"].includes(mediaUpload.state) ||
        compression.isCompressing ||
        ["loading", "analyzing", "finalizing"].includes(compression.stage)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [compression.isCompressing, compression.stage, mediaUpload.state]);

  useEffect(() => {
    if (hasSelectedMedia && wizardStep === 0) setWizardStep(1);
  }, [hasSelectedMedia, wizardStep]);

  const uploadCover = async (file: File) => {
    if (!user) return;
    const previousPreview = thumbnailPreview;
    const localPreview = URL.createObjectURL(file);
    setThumbnailUploading(true);
    setThumbnailPreview(localPreview);
    try {
      const isShort = contentType === "short";
      const compressed = await compressImage(
        file,
        isShort ? 1080 : 1920,
        isShort ? 1920 : 1080,
        0.9,
      );
      const extension = compressed.name.split(".").pop() || "jpg";
      const path = `thumbnails/${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage
        .from("contents")
        .upload(path, compressed, { cacheControl: "31536000", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("contents").getPublicUrl(path);
      setThumbnailUrl(data.publicUrl);
      setThumbnailPreview(data.publicUrl);
      setCoverEditorOpen(false);
      setGalleryCoverFile(null);
      toast.success("Capa pronta.");
    } catch (coverError) {
      setThumbnailPreview(previousPreview);
      toast.error(
        coverError instanceof Error
          ? coverError.message
          : "Não foi possível enviar a capa.",
      );
    } finally {
      URL.revokeObjectURL(localPreview);
      setThumbnailUploading(false);
      if (coverFileInputRef.current) coverFileInputRef.current.value = "";
    }
  };

  const removeCover = () => {
    setThumbnailUrl("");
    setThumbnailPreview("");
    setCoverEditorOpen(false);
    setGalleryCoverFile(null);
    if (coverFileInputRef.current) coverFileInputRef.current.value = "";
    toast.success("Capa removida do rascunho.");
  };

  const invalidateCoverPreview = () => {
    setThumbnailUrl("");
    setThumbnailPreview("");
    toast.info("Escolha outro frame ou uma imagem da galeria para a capa.");
  };

  const validateCoverPreview = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let minimum = 255;
      let maximum = 0;
      let total = 0;
      let samples = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const value = pixels[index + channel];
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
          total += value;
          samples += 1;
        }
      }
      const average = total / samples;
      if (maximum - minimum <= 8 && average >= 25 && average <= 45)
        invalidateCoverPreview();
    } catch {
      // A imagem continua válida quando o provedor não permite leitura via canvas.
    }
  };

  const startUpload = async (
    file: File,
    trimStart?: number,
    trimEnd?: number,
  ) => {
    let backgroundTaskId: string | null = null;
    try {
      const savedDraft = await draft.saveNow();
      if (!isPersistedPublicationDraft(savedDraft))
        throw new Error(
          "Conecte-se à internet para iniciar o envio. Seus dados continuam salvos neste dispositivo.",
        );
      backgroundTaskId = beginBackgroundUpload({
        draftId: savedDraft.id,
        title: file.name,
      });
      const target = await videoService.createUpload(title || file.name, {
        mediaType: rules.mediaType,
        draftId: savedDraft.id,
        slotKey: `${contentType}:primary`,
      });
      const preparedTarget = {
        ...target,
        fileUrl: `media:${target.mediaAssetId}`,
      };
      setFileUrl(preparedTarget.fileUrl);
      setMediaAssetId(target.mediaAssetId);
      setVideoProvider(target.provider);
      updateBackgroundUpload(backgroundTaskId, {
        mediaAssetId: target.mediaAssetId,
        state: "preparing",
      });
      await draft.savePayload({
        ...latestPayloadRef.current,
        fileUrl: preparedTarget.fileUrl,
        mediaAssetId: target.mediaAssetId,
        videoProvider: target.provider,
        uploadState: "preparing",
      });
      let prepared = file;
      if (contentType !== "podcast") {
        const requiresTrim =
          (trimStart !== undefined && trimStart > 0.5) ||
          (trimEnd !== undefined &&
            sourceDuration > 0 &&
            trimEnd < sourceDuration - 0.5);
        try {
          prepared = await compression.compressVideo(file, {
            quality: "balanced",
            maxWidth: contentType === "short" ? 1080 : 1920,
            maxHeight: contentType === "short" ? 1920 : 1080,
            trimStart,
            trimEnd,
          });
          if (requiresTrim && prepared === file) {
            throw new Error(
              "Não conseguimos aplicar o corte. Revise o arquivo ou tente novamente.",
            );
          }
          if (prepared !== file) setFilePreview(URL.createObjectURL(prepared));
        } catch (preparationError) {
          if (requiresTrim) throw preparationError;
          prepared = file;
        }
      }
      const result = await mediaUpload.upload({
        file: prepared,
        title: title || prepared.name,
        mediaType: rules.mediaType,
        draftId: savedDraft?.id ?? draft.draftId,
        slotKey: `${contentType}:primary`,
        backgroundTaskId,
        preparedTarget,
      });
      setFileUrl(result.fileUrl);
      setMediaAssetId(result.mediaAssetId);
      setVideoProvider(result.provider);
      toast.success(
        contentType === "podcast"
          ? "Áudio enviado. Agora estamos preparando a reprodução."
          : "Vídeo enviado. Agora estamos preparando a reprodução.",
      );
      return true;
    } catch (uploadError) {
      if (backgroundTaskId)
        updateBackgroundUpload(backgroundTaskId, { state: "failed" });
      if (!(
        uploadError instanceof DOMException && uploadError.name === "AbortError"
      ))
        toast.error(
          uploadError instanceof Error
            ? uploadError.message
            : "Não foi possível enviar o arquivo.",
        );
      return false;
    }
  };

  const handleFileSelect = async (file?: File) => {
    if (!file) return;
    const isAudio = file.type.startsWith("audio/");
    const isVideo = file.type.startsWith("video/");
    if (
      (contentType === "podcast" && !isAudio) ||
      (contentType !== "podcast" && !isVideo)
    ) {
      toast.error(
        contentType === "podcast"
          ? "Escolha um arquivo de áudio válido."
          : "Escolha um arquivo de vídeo válido.",
      );
      return;
    }
    const url = URL.createObjectURL(file);
    setCaptureReady(false);
    setFileName(file.name);
    setFilePreview(url);
    setCoverEditorOpen(false);
    mediaUpload.reset();
    if (!title.trim()) {
      setTitle(
        file.name
          .replace(/\.[^/.]+$/, "")
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
    pendingFileRef.current = file;
    if (contentType === "podcast") {
      setWizardStep(1);
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.src = url;
      audio.onloadedmetadata = () => {
        setDuration(audio.duration || 0);
        setSourceDuration(audio.duration || 0);
      };
    } else {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = url;
      video.onloadedmetadata = () => {
        const selectedDuration = video.duration || 0;
        setDuration(selectedDuration);
        setSourceDuration(selectedDuration);
        setTrimStart(0);
        setTrimEnd(
          contentType === "short"
            ? Math.min(selectedDuration, 180)
            : selectedDuration,
        );
        setWizardStep(1);
      };
      video.onerror = () => {
        setWizardStep(1);
        toast.error(
          "Não conseguimos abrir a prévia. Você pode trocar o arquivo e tentar novamente.",
        );
      };
    }
  };

  const confirmMediaPreparation = async () => {
    const file = pendingFileRef.current;
    if (!file) {
      if (mediaAssetId) setWizardStep(2);
      else toast.error("Selecione o arquivo novamente para continuar.");
      return;
    }
    if (contentType !== "podcast") {
      setDuration(Math.max(0, trimEnd - trimStart));
    }
    const defaultCoverVideo =
      visibleVideoRef.current ?? captureVideoRef.current;
    setWizardStep(2);
    if (
      contentType !== "podcast" &&
      !thumbnailPreview &&
      defaultCoverVideo &&
      defaultCoverVideo.readyState >= 2
    ) {
      const targetAspect = contentType === "short" ? 9 / 16 : 16 / 9;
      const target = coverTargetSize(targetAspect);
      const playbackTime = defaultCoverVideo.currentTime || trimStart;
      const lastFrame = Math.max(trimStart, trimEnd - 0.1);
      const defaultTime = trimStart + Math.max(0, trimEnd - trimStart) * 0.25;
      const currentTime =
        playbackTime > trimStart + 0.1 ? playbackTime : defaultTime;
      const selectedTime = Math.min(
        Math.max(currentTime, trimStart),
        lastFrame,
      );
      setThumbnailUploading(true);
      void (async () => {
        try {
          const dataUrl = await seekAndCaptureCover(
            defaultCoverVideo,
            selectedTime,
            target.width,
            target.height,
            { x: 50, y: 50 },
            0.92,
          );
          const cover = dataURLtoFile(
            dataUrl,
            `capa_${contentType}_${Date.now()}.jpg`,
          );
          await uploadCover(cover);
        } catch {
          setThumbnailUploading(false);
          toast.info(
            "Não conseguimos gerar a capa automática. Escolha outro frame ou uma imagem da galeria.",
          );
        }
      })();
    }
    const started = await startUpload(
      file,
      contentType === "podcast" ? undefined : trimStart,
      contentType === "podcast" ? undefined : trimEnd,
    );
    if (!started) setWizardStep(1);
  };

  const removeMedia = () => {
    if (mediaAssetId)
      void (supabase as any).rpc("abandon_media_asset", {
        p_media_asset_id: mediaAssetId,
      });
    mediaUpload.reset();
    compression.abort();
    compression.reset();
    setFileUrl("");
    setFilePreview("");
    setFileName("");
    setDuration(0);
    setSourceDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setCaptureReady(false);
    setMediaAssetId(null);
    setVideoProvider(null);
    pendingFileRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
    setWizardStep(0);
  };

  const discardDraft = async () => {
    if (mediaAssetId)
      void (supabase as any).rpc("abandon_media_asset", {
        p_media_asset_id: mediaAssetId,
      });
    await draft.discard();
    setDiscardOpen(false);
    navigate("/studio/contents");
  };

  const generateTags = async () => {
    if (!title.trim()) {
      toast.error("Escreva o título antes de gerar tags.");
      return;
    }
    setIsGeneratingTags(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-tags", {
        body: {
          title: title.trim(),
          description: description.trim(),
          contentType,
        },
      });
      if (error) throw error;
      setTags(data?.tags ?? []);
    } catch {
      toast.error("Não foi possível sugerir tags agora.");
    } finally {
      setIsGeneratingTags(false);
    }
  };

  const issues = useMemo(
    () => getStandaloneDraftIssues(contentType, payload),
    [contentType, payload],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (issues.length) {
      toast.error(issues[0]);
      return;
    }
    setSubmitting(true);
    try {
      const saved = await draft.saveNow();
      const activeDraftId = isPersistedPublicationDraft(saved)
        ? saved!.id
        : null;
      if (!activeDraftId)
        throw new Error(
          "Conecte-se à internet para enviar o conteúdo para análise.",
        );
      const { data, error } = await (supabase as any).rpc(
        "submit_standalone_publication",
        { p_draft_id: activeDraftId },
      );
      if (error) throw error;
      draft.clearLocal();
      toast.success(
        data?.isRevision
          ? "Revisão enviada. A versão atual continua publicada."
          : "Conteúdo enviado para análise.",
      );
      navigate("/studio/contents");
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : "Não foi possível enviar para análise.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !sourceLoaded)
    return (
      <div className="cf-v2 studio-publish-loading">
        <LoaderCircle className="animate-spin" />
        <strong>Preparando seu editor...</strong>
      </div>
    );
  if (!user || (role !== "creator" && role !== "admin"))
    return <Navigate to="/" replace />;
  if (profile?.creator_status !== "approved" && role !== "admin")
    return (
      <AppShell
        variant="studio"
        title="Publicação"
        contentClassName="studio-page-shell"
      >
        <div className="studio-access-state">
          <Lock />
          <h1>Seu Studio ainda não está liberado</h1>
          <p>
            Quando seu perfil de creator for aprovado, você poderá publicar
            materiais por aqui.
          </p>
        </div>
      </AppShell>
    );

  const MediaIcon = contentType === "podcast" ? FileAudio : FileVideo;
  const saveIcon =
    draft.state === "offline" ? (
      <CloudOff />
    ) : draft.state === "saving" ? (
      <LoaderCircle className="animate-spin" />
    ) : (
      <Cloud />
    );
  const hasPlayablePreview =
    filePreview.startsWith("blob:") || filePreview.startsWith("http");
  const isPreparingLocally =
    compression.isCompressing ||
    ["loading", "analyzing", "compressing", "finalizing"].includes(
      compression.stage,
    );
  const mediaStatus = isPreparingLocally
    ? "Processando"
    : mediaUpload.state === "idle"
      ? hasSelectedMedia
        ? "Aguardando envio"
        : "Aguardando arquivo"
      : mediaStatusCopy(mediaUpload.state, mediaUpload.progress);
  const closeWizard = async () => {
    if (title || description || hasSelectedMedia) await draft.saveNow();
    navigate("/studio/contents");
    if (
      ["preparing", "uploading"].includes(mediaUpload.state) ||
      isPreparingLocally
    )
      toast.success(
        "O envio continuará em segundo plano. Você pode acompanhar pelo rascunho.",
      );
  };
  const wizardSteps = [
    "Arquivo",
    contentType === "podcast" ? "Revisar áudio" : "Ajustar vídeo",
    "Detalhes",
    "Publicação",
  ];
  const mediaAlreadySent = Boolean(mediaAssetId || fileUrl);
  const coverAspect = contentType === "short" ? 9 / 16 : 16 / 9;
  const draftIsHydrating = draft.state === "loading" || isResolvingResume;

  return (
    <AppShell
      variant="studio"
      title={isEditMode ? `Editar ${rules.label}` : shellTitle}
      contentClassName="studio-page-shell"
    >
      <CreatorTemplate
        className="studio-template studio-publish-template"
        data-restoring={draftIsHydrating || undefined}
        width="wide"
        density="comfortable"
        header={
          <PageHeader
            title={
              title ||
              (isEditMode
                ? `Editar ${rules.label.toLowerCase()}`
                : `Publique ${newPublicationLabel}.`)
            }
            description={
              isEditMode && originalStatus === "approved"
                ? "A versão publicada continua no ar enquanto esta revisão é analisada."
                : rules.description
            }
            action={
              <div className="studio-wizard-header-actions">
                <span className="studio-draft-state" data-state={draft.state}>
                  {saveIcon}
                  {draft.label}
                </span>
                <button
                  type="button"
                  className="studio-wizard-close studio-wizard-discard"
                  aria-label="Descartar rascunho"
                  onClick={() => setDiscardOpen(true)}
                >
                  <Trash2 />
                </button>
                <button
                  type="button"
                  className="studio-wizard-close"
                  aria-label="Fechar publicação"
                  onClick={() => void closeWizard()}
                >
                  <X />
                </button>
              </div>
            }
          />
        }
      >
        {draftIsHydrating && (
          <div className="studio-draft-loading" role="status">
            <LoaderCircle className="animate-spin" />
            <div>
              <strong>Carregando seu rascunho</strong>
              <span>Retomando do ponto em que você parou.</span>
            </div>
          </div>
        )}
        <nav className="studio-wizard-steps" aria-label="Etapas da publicação">
          <ol>
            {wizardSteps.map((step, index) => (
              <li
                key={step}
                data-active={index === wizardStep || undefined}
                data-complete={index < wizardStep || undefined}
              >
                <span>{index < wizardStep ? <Check /> : index + 1}</span>
                <strong>{step}</strong>
              </li>
            ))}
          </ol>
        </nav>
        <form
          className="studio-publish-layout"
          data-step={wizardStep}
          onSubmit={submit}
        >
          <div className="studio-publish-main">
            <V2Card
              className={`studio-publish-card studio-media-card ${wizardStep > 1 ? "studio-wizard-hidden" : ""}`}
              elevation="panel"
            >
              <V2CardHeader>
                <div className="studio-adjustment-header">
                  <div className="studio-publish-heading">
                    <span className="studio-icon" data-tone="accent">
                      {wizardStep === 1 && contentType !== "podcast" ? (
                        <Scissors />
                      ) : (
                        <MediaIcon />
                      )}
                    </span>
                    <div>
                      <h2>
                        {wizardStep === 1
                          ? contentType === "podcast"
                            ? "Confira seu episódio"
                            : "Ajuste seu vídeo"
                          : contentType === "podcast"
                            ? "Áudio do episódio"
                            : "Vídeo do conteúdo"}
                      </h2>
                      <p>
                        {wizardStep === 1
                          ? contentType === "podcast"
                            ? "Ouça o arquivo e avance quando estiver tudo certo."
                            : "Reproduza o vídeo e corte apenas se precisar."
                          : contentType === "short"
                            ? "Vídeo vertical com até 3 minutos."
                            : contentType === "podcast"
                              ? "MP3, M4A, WAV ou OGG."
                              : "MP4, WebM ou MOV."}
                      </p>
                    </div>
                  </div>
                </div>
              </V2CardHeader>
              <V2CardContent>
                {!hasSelectedMedia ? (
                  <div
                    className="studio-upload-dropzone"
                    data-dragging={isDraggingFile || undefined}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setIsDraggingFile(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node,
                        )
                      )
                        setIsDraggingFile(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsDraggingFile(false);
                      void handleFileSelect(event.dataTransfer.files?.[0]);
                    }}
                  >
                    <span className="studio-upload-dropzone__icon">
                      <UploadCloud />
                    </span>
                    <h1>
                      {contentType === "podcast"
                        ? "Envie o áudio do episódio"
                        : "Envie seu vídeo"}
                    </h1>
                    <p>
                      Arraste o arquivo para cá ou selecione no dispositivo.
                    </p>
                    <V2Button
                      size="lg"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Selecionar arquivo
                    </V2Button>
                    <small>
                      {contentType === "short"
                        ? "Vídeo vertical de até 3 minutos · MP4, WebM ou MOV"
                        : contentType === "podcast"
                          ? "MP3, M4A, WAV ou OGG"
                          : "MP4, WebM ou MOV"}
                    </small>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={rules.accept}
                      onChange={(event) =>
                        void handleFileSelect(event.target.files?.[0])
                      }
                    />
                  </div>
                ) : (
                  <div className="studio-media-progress">
                    <div className="studio-media-progress__copy">
                      <div>
                        <strong>Arquivo selecionado</strong>
                        <span>{fileName || title || rules.label}</span>
                      </div>
                      <div className="studio-media-progress__actions">
                        <V2Button
                          variant="quiet"
                          size="sm"
                          leadingIcon={<Trash2 />}
                          onClick={removeMedia}
                        >
                          Remover
                        </V2Button>
                      </div>
                    </div>
                    {(mediaUpload.state === "uploading" ||
                      isPreparingLocally) && (
                      <div
                        className="studio-upload-progress"
                        aria-label={`Preparação ${isPreparingLocally ? compression.progress : mediaUpload.progress}%`}
                      >
                        <span
                          style={{
                            width: `${isPreparingLocally ? compression.progress : mediaUpload.progress}%`,
                          }}
                        />
                      </div>
                    )}
                    {mediaUpload.error && (
                      <p className="studio-inline-error">
                        <CircleAlert />
                        {mediaUpload.error}
                        <V2Button
                          variant="quiet"
                          size="sm"
                          leadingIcon={<RotateCcw />}
                          onClick={removeMedia}
                        >
                          Tentar novamente
                        </V2Button>
                      </p>
                    )}

                    {wizardStep === 1 && (
                      <>
                        <div
                          className={`studio-media-preview studio-media-preview--${contentType}`}
                        >
                          {hasPlayablePreview &&
                          filePreview &&
                          contentType === "podcast" ? (
                            <audio src={filePreview} controls />
                          ) : hasPlayablePreview && filePreview ? (
                            <video
                              ref={visibleVideoRef}
                              src={filePreview}
                              controls
                              preload="metadata"
                            />
                          ) : (
                            <MediaIcon />
                          )}
                        </div>
                        {contentType !== "podcast" &&
                          pendingFileRef.current &&
                          sourceDuration > 0 && (
                            <div
                              className="studio-media-editor"
                              data-locked={mediaAlreadySent || undefined}
                            >
                              <div className="studio-media-editor__heading">
                                <div>
                                  <strong>
                                    <Scissors /> Defina o trecho do vídeo
                                  </strong>
                                  <span>
                                    Arraste as alças para escolher exatamente o
                                    que será enviado.
                                  </span>
                                </div>
                                {mediaAlreadySent && (
                                  <small>
                                    Para mudar o corte, substitua o arquivo.
                                  </small>
                                )}
                              </div>
                              <video
                                ref={captureVideoRef}
                                src={filePreview}
                                muted
                                playsInline
                                preload="auto"
                                className="studio-media-editor__capture"
                                onLoadedData={() => setCaptureReady(true)}
                              />
                              <div className="studio-media-editor__timeline">
                                <VideoTrimBar
                                  key={filePreview}
                                  captureVideoRef={captureVideoRef}
                                  captureReady={captureReady}
                                  duration={sourceDuration}
                                  trimStart={trimStart}
                                  trimEnd={trimEnd || sourceDuration}
                                  maxDuration={
                                    contentType === "short" ? 180 : undefined
                                  }
                                  onTrimChange={(start, end) => {
                                    if (mediaAlreadySent) return;
                                    setTrimStart(start);
                                    setTrimEnd(end);
                                  }}
                                  onTrimCommit={(start) => {
                                    if (visibleVideoRef.current)
                                      visibleVideoRef.current.currentTime =
                                        start;
                                  }}
                                />
                              </div>
                            </div>
                          )}
                      </>
                    )}
                  </div>
                )}
              </V2CardContent>
            </V2Card>

            <V2Card
              className={`studio-publish-card studio-cover-stage ${wizardStep !== 2 || !coverEditorOpen ? "studio-wizard-hidden" : ""}`}
              elevation="panel"
            >
              <V2CardHeader>
                <div className="studio-cover-stage__header">
                  <div className="studio-publish-heading">
                    <span className="studio-icon">
                      <ImagePlus />
                    </span>
                    <div>
                      <h2>Editar capa</h2>
                      <p>
                        Escolha um frame do vídeo ou envie uma imagem da sua
                        galeria.
                      </p>
                    </div>
                  </div>
                  <div className="studio-cover-stage__actions">
                    <V2Button
                      type="button"
                      size="sm"
                      leadingIcon={<ImagePlus />}
                      onClick={() => coverFileInputRef.current?.click()}
                      disabled={thumbnailUploading}
                    >
                      Inserir da galeria
                    </V2Button>
                    <button
                      type="button"
                      className="studio-wizard-close"
                      aria-label="Fechar editor de capa"
                      onClick={() => {
                        setGalleryCoverFile(null);
                        setCoverEditorOpen(false);
                      }}
                    >
                      <X />
                    </button>
                  </div>
                </div>
              </V2CardHeader>
              <V2CardContent>
                <div
                  className="studio-cover-editor"
                  data-format={contentType}
                  aria-busy={thumbnailUploading}
                >
                  {galleryCoverFile ? (
                    <CoverImageCropper
                      file={galleryCoverFile}
                      targetAspect={coverAspect}
                      onConfirm={(file) => uploadCover(file)}
                      onCancel={() => setGalleryCoverFile(null)}
                    />
                  ) : filePreview && contentType !== "podcast" ? (
                    <StandaloneCoverSelector
                      key={filePreview}
                      videoSrc={filePreview}
                      targetAspect={coverAspect}
                      selectionMode="confirm"
                      confirmLabel="Confirmar capa"
                      onFrameSelect={(file) => void uploadCover(file)}
                      className="studio-cover-selector"
                    />
                  ) : (
                    <div className="studio-cover-editor__empty">
                      <span className="studio-cover-editor__empty-icon">
                        <ImagePlus />
                      </span>
                      <div>
                        <strong>Escolha uma imagem para a capa</strong>
                        <span>Use uma imagem JPG, PNG ou WebP.</span>
                      </div>
                      <V2Button
                        type="button"
                        leadingIcon={<ImagePlus />}
                        onClick={() => coverFileInputRef.current?.click()}
                      >
                        Abrir galeria
                      </V2Button>
                    </div>
                  )}
                  {thumbnailUploading && (
                    <span className="studio-cover-editor__loading">
                      <LoaderCircle className="animate-spin" />
                      Preparando capa em alta qualidade...
                    </span>
                  )}
                  <input
                    ref={coverFileInputRef}
                    className="studio-cover-editor__input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="Escolher imagem da galeria"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setGalleryCoverFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
              </V2CardContent>
            </V2Card>

            <V2Card
              className={`studio-publish-card studio-details-card ${wizardStep !== 2 || coverEditorOpen ? "studio-wizard-hidden" : ""}`}
              elevation="panel"
            >
              <V2CardHeader>
                <div className="studio-publish-heading">
                  <span className="studio-icon">
                    <Save />
                  </span>
                  <div>
                    <h2>Informações</h2>
                    <p>Explique com clareza o que a pessoa encontrará.</p>
                  </div>
                </div>
              </V2CardHeader>
              <V2CardContent className="studio-publish-fields">
                <section
                  className="studio-details-cover"
                  data-format={contentType}
                >
                  <div
                    className="studio-details-cover__preview"
                    style={{ aspectRatio: coverAspect }}
                  >
                    {thumbnailPreview ? (
                      <img
                        src={thumbnailPreview}
                        alt="Capa selecionada"
                        crossOrigin="anonymous"
                        onLoad={validateCoverPreview}
                        onError={invalidateCoverPreview}
                      />
                    ) : thumbnailUploading ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <ImagePlus />
                    )}
                  </div>
                  <div className="studio-details-cover__copy">
                    <span>Capa do conteúdo</span>
                    <h3>
                      {thumbnailUploading
                        ? "Preparando a capa..."
                        : thumbnailPreview
                          ? "Sua capa está pronta"
                          : "Escolha uma capa"}
                    </h3>
                    <p>
                      {thumbnailPreview
                        ? "Ela será usada no catálogo e na página do conteúdo."
                        : contentType === "podcast"
                          ? "Adicione uma imagem que represente o episódio."
                          : "Escolha um frame do vídeo ou envie uma imagem da galeria."}
                    </p>
                    <div>
                      <V2Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        leadingIcon={<ImagePlus />}
                        onClick={() => {
                          setGalleryCoverFile(null);
                          setCoverEditorOpen(true);
                        }}
                        disabled={thumbnailUploading}
                      >
                        {thumbnailPreview ? "Alterar capa" : "Escolher capa"}
                      </V2Button>
                      {thumbnailPreview && (
                        <V2Button
                          type="button"
                          variant="quiet"
                          size="sm"
                          leadingIcon={<Trash2 />}
                          onClick={removeCover}
                          disabled={thumbnailUploading}
                        >
                          Remover
                        </V2Button>
                      )}
                    </div>
                  </div>
                </section>
                <V2Input
                  label="Título"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  placeholder="Um título direto e fácil de entender"
                />
                {contentType !== "short" && (
                  <V2Textarea
                    label="Descrição"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={5}
                    placeholder="Conte o que será aprendido e para quem este material é indicado"
                  />
                )}
                <div className="cf2-field">
                  <span className="cf2-field__label">Tags</span>
                  <TagsInput
                    tags={tags}
                    onChange={setTags}
                    onGenerateTags={generateTags}
                    isGenerating={isGeneratingTags}
                    placeholder="Ex.: produtividade, carreira, design"
                  />
                </div>
              </V2CardContent>
            </V2Card>

            <V2Card
              className={`studio-publish-card ${wizardStep !== 3 ? "studio-wizard-hidden" : ""}`}
              elevation="panel"
            >
              <V2CardHeader>
                <div className="studio-publish-heading">
                  <span className="studio-icon">
                    <Eye />
                  </span>
                  <div>
                    <h2>Acesso</h2>
                    <p>Defina quem poderá consumir este material.</p>
                  </div>
                </div>
              </V2CardHeader>
              <V2CardContent className="studio-access-options">
                {visibilityOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    data-selected={visibility === option.id || undefined}
                    onClick={() => setVisibility(option.id)}
                  >
                    <span>{visibility === option.id && <Check />}</span>
                    <div>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </div>
                  </button>
                ))}
                {visibility === "paid" && (
                  <div className="studio-price-fields">
                    <V2Input
                      label="Preço em reais"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                    />
                    <V2Input
                      label="Desconto (%)"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={discount}
                      onChange={(event) => setDiscount(event.target.value)}
                    />
                  </div>
                )}
              </V2CardContent>
            </V2Card>
          </div>

          <aside
            className={`studio-publish-review ${wizardStep !== 3 ? "studio-wizard-hidden" : ""}`}
          >
            <V2Card elevation="raised">
              <V2CardHeader>
                <div>
                  <h2>Antes de enviar</h2>
                  <p>Confira o que ainda precisa de atenção.</p>
                </div>
              </V2CardHeader>
              <V2CardContent>
                <div
                  className="studio-review-status"
                  data-complete={!issues.length || undefined}
                >
                  {issues.length ? <CircleAlert /> : <Check />}
                  <strong>
                    {issues.length
                      ? `${issues.length} ${issues.length === 1 ? "pendência" : "pendências"}`
                      : "Tudo pronto"}
                  </strong>
                </div>
                <ul className="studio-review-list">
                  {issues.length ? (
                    issues.map((issue) => (
                      <li key={issue}>
                        <span />
                        {issue}
                      </li>
                    ))
                  ) : (
                    <li>
                      <Check />
                      Seu material pode ser enviado para análise.
                    </li>
                  )}
                </ul>
                <dl className="studio-review-summary">
                  <div>
                    <dt>Formato</dt>
                    <dd>{rules.label}</dd>
                  </div>
                  <div>
                    <dt>Acesso</dt>
                    <dd>
                      {
                        visibilityOptions.find((item) => item.id === visibility)
                          ?.label
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Revisão</dt>
                    <dd>
                      {originalStatus === "approved"
                        ? "Nova versão"
                        : "Primeiro envio"}
                    </dd>
                  </div>
                </dl>
              </V2CardContent>
            </V2Card>
          </aside>
          <footer className="studio-wizard-footer">
            <div className="studio-wizard-footer__status">
              <UploadCloud />
              <div>
                <strong>{mediaStatus}</strong>
                <span>
                  {mediaUpload.state === "uploading"
                    ? `${mediaUpload.progress}% concluído`
                    : isPreparingLocally
                      ? `${compression.progress}% preparado`
                      : draft.label}
                </span>
              </div>
            </div>
            <div className="studio-wizard-footer__actions">
              {wizardStep > 1 && !coverEditorOpen && (
                <V2Button
                  variant="secondary"
                  leadingIcon={<ChevronLeft />}
                  onClick={() => setWizardStep((step) => Math.max(1, step - 1))}
                >
                  Voltar
                </V2Button>
              )}
              {wizardStep === 1 && (
                <V2Button
                  trailingIcon={<ChevronRight />}
                  onClick={() => void confirmMediaPreparation()}
                  disabled={
                    !hasSelectedMedia ||
                    thumbnailUploading ||
                    isPreparingLocally ||
                    mediaUpload.state === "uploading"
                  }
                >
                  {mediaAlreadySent ? "Ir para detalhes" : "Avançar"}
                </V2Button>
              )}
              {wizardStep === 2 && !coverEditorOpen && (
                <V2Button
                  trailingIcon={<ChevronRight />}
                  onClick={() => setWizardStep(3)}
                  disabled={!hasSelectedMedia}
                >
                  Avançar
                </V2Button>
              )}
              {wizardStep === 3 && (
                <>
                  <V2Button
                    variant="secondary"
                    leadingIcon={<Eye />}
                    onClick={() => setPreviewOpen(true)}
                    disabled={!title && !thumbnailPreview}
                  >
                    Pré-visualizar
                  </V2Button>
                  <V2Button
                    type="submit"
                    leadingIcon={
                      submitting ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Send />
                      )
                    }
                    disabled={submitting || issues.length > 0}
                  >
                    {submitting ? "Enviando..." : "Enviar para análise"}
                  </V2Button>
                </>
              )}
            </div>
          </footer>
        </form>
      </CreatorTemplate>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="studio-preview-dialog z-[91]"
          overlayClassName="z-[90]"
        >
          <DialogHeader>
            <DialogTitle>Prévia da publicação</DialogTitle>
            <DialogDescription>
              Esta é a apresentação básica que sua audiência verá.
            </DialogDescription>
          </DialogHeader>
          <div
            className={`studio-preview-card studio-preview-card--${contentType}`}
          >
            {thumbnailPreview ? (
              <img src={thumbnailPreview} alt="" />
            ) : (
              <div className="studio-preview-placeholder">
                <ImagePlus />
              </div>
            )}
            <div>
              <V2Badge>{rules.label}</V2Badge>
              <h2>{title || "Título do conteúdo"}</h2>
              <p>{description || "Sua descrição aparecerá aqui."}</p>
              <span>
                {
                  visibilityOptions.find((item) => item.id === visibility)
                    ?.label
                }
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <V2ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Descartar este rascunho?"
        description="As informações ainda não enviadas para análise serão removidas. A mídia temporária vinculada também será descartada."
        confirmLabel="Descartar rascunho"
        cancelLabel="Continuar editando"
        layer="nested"
        onConfirm={discardDraft}
      />
    </AppShell>
  );
}

export default function StudioUploadRoute() {
  const location = useLocation();
  return <StudioUpload key={`${location.pathname}${location.search}`} />;
}
