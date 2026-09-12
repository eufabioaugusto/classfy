import { useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, Loader2, CheckCircle2, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import * as tus from "tus-js-client";
import { videoService } from "@/lib/video/service";

const emptyForm = {
  title: "",
  description: "",
  source_url: "",
  license_type: "CC-BY",
  attribution_text: "",
  tags: "",
};

export default function AdminCuration() {
  const { user, role } = useAuth();
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [mediaAssetId, setMediaAssetId] = useState<string | null>(null);
  const [videoProvider, setVideoProvider] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState("");
  const [duration, setDuration] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "done">("idle");
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (role !== "admin") return <Navigate to="/" replace />;

  async function handleVideoSelect(file: File) {
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setUploadState("uploading");
    setUploadProgress(0);

    try {
      const target = await videoService.createUpload(form.title || file.name);
      await new Promise<void>((resolve, reject) => {
        if (target.method === "TUS") {
          const upload = new tus.Upload(file, {
            endpoint: target.uploadUrl,
            retryDelays: [0, 3000, 5000, 10000],
            headers: target.headers,
            metadata: { filename: file.name, filetype: file.type, title: form.title || file.name },
            onProgress: (sent, total) => setUploadProgress(Math.round((sent / total) * 100)),
            onSuccess: resolve,
            onError: reject,
          });
          upload.start();
          return;
        }

        if (target.method !== "PUT") {
          reject(new Error("Método de upload não suportado"));
          return;
        }
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        });
        xhr.addEventListener("load", () => xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Status ${xhr.status}`)));
        xhr.addEventListener("error", () => reject(new Error("Upload falhou")));
        xhr.open("PUT", target.uploadUrl);
        Object.entries(target.headers ?? {}).forEach(([name, value]) => xhr.setRequestHeader(name, value));
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.send(file);
      });

      setMediaAssetId(target.mediaAssetId);
      setVideoProvider(target.provider);
      setVideoUrl(`media:${target.mediaAssetId}`);
      setUploadState("done");
      toast.success("Vídeo enviado!");
    } catch (error) {
      setUploadState("idle");
      setUploadProgress(0);
      toast.error(`Erro no upload: ${error instanceof Error ? error.message : "falha desconhecida"}`);
    } finally {
      xhrRef.current = null;
    }
  }

  async function handleThumbnailSelect(file: File) {
    setThumbnailFile(file);
    setThumbnailPreview(URL.createObjectURL(file));

    const fileName = `curated/${user!.id}/thumb_${Date.now()}.jpg`;
    const { error } = await supabase.storage.from("contents").upload(fileName, file, {
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "31536000"
    });
    if (error) { toast.error("Erro ao enviar thumbnail"); return; }
    const { data: { publicUrl } } = supabase.storage.from("contents").getPublicUrl(fileName);
    setThumbnailUrl(publicUrl);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!videoUrl) { toast.error("Faça o upload do vídeo primeiro"); return; }
    if (!form.title.trim()) { toast.error("Título obrigatório"); return; }
    if (!form.attribution_text.trim()) { toast.error("Texto de atribuição obrigatório"); return; }

    setSubmitting(true);

    // Get video duration from preview element
    const vid = document.querySelector<HTMLVideoElement>("#curation-preview");
    const dur = vid?.duration && isFinite(vid.duration) ? Math.round(vid.duration) : duration;

    const { data: createdContent, error } = await supabase.from("contents").insert({
      creator_id: user!.id,
      content_type: "aula",
      title: form.title.trim(),
      description: form.description.trim() || null,
      file_url: videoUrl,
      media_asset_id: mediaAssetId,
      video_provider: videoProvider,
      thumbnail_url: thumbnailUrl || null,
      duration_seconds: dur,
      is_free: true,
      visibility: "free",
      status: "pending",
      published_at: null,
      is_curated: true,
      source_url: form.source_url.trim() || null,
      license_type: form.license_type,
      attribution_text: form.attribution_text.trim(),
      tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : null,
    }).select("id").single();

    if (error) {
      toast.error("Erro ao publicar: " + error.message);
    } else {
      const { data: approval, error: approvalError } = await supabase.functions.invoke("approve-content", {
        body: {
          contentId: createdContent.id,
          itemType: "content",
          reason: "Conteúdo licenciado publicado pela curadoria administrativa",
        },
      });
      if (approvalError || approval?.error) {
        toast.error("Conteúdo criado, mas a aprovação segura falhou. Ele permanece pendente.");
        setSubmitting(false);
        return;
      }
      toast.success("Conteúdo curado publicado!");
      setForm(emptyForm);
      setVideoFile(null);
      setVideoUrl("");
      setMediaAssetId(null);
      setVideoProvider(null);
      setVideoPreview("");
      setThumbnailUrl("");
      setThumbnailPreview("");
      setUploadState("idle");
      setUploadProgress(0);
    }

    setSubmitting(false);
  }

  return (
    <AdminLayout title="Curadoria de Conteúdo">
      <div className="p-6 max-w-2xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Video upload */}
          <div className="space-y-1.5">
            <Label>Arquivo de Vídeo</Label>
            <label
              className={cn(
                "flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors",
                uploadState === "done"
                  ? "border-green-500 bg-green-500/5"
                  : "border-border hover:border-primary/50"
              )}
            >
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleVideoSelect(e.target.files[0])}
                disabled={uploadState === "uploading"}
              />
              {uploadState === "idle" && (
                <>
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Clique para selecionar o vídeo</p>
                </>
              )}
              {uploadState === "uploading" && (
                <div className="w-full space-y-2">
                  <div className="flex items-center gap-2 justify-center">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm">Enviando... {uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} />
                </div>
              )}
              {uploadState === "done" && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-sm font-medium">{videoFile?.name}</span>
                </div>
              )}
            </label>
          </div>

          {/* Video preview */}
          {videoPreview && (
            <video
              id="curation-preview"
              src={videoPreview}
              controls
              className="w-full rounded-xl bg-black"
              onLoadedMetadata={(e) => setDuration(Math.round((e.target as HTMLVideoElement).duration))}
            />
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label>Título (PT-BR)</Label>
            <Input
              placeholder="Título em português..."
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Descrição (PT-BR)</Label>
            <Textarea
              placeholder="Descrição traduzida ou adaptada..."
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={4}
            />
          </div>

          {/* Thumbnail */}
          <div className="space-y-1.5">
            <Label>Thumbnail</Label>
            <label className="flex items-center gap-3 border rounded-lg p-3 cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleThumbnailSelect(e.target.files[0])}
              />
              {thumbnailPreview ? (
                <img src={thumbnailPreview} alt="thumb" className="h-16 rounded-md object-cover" />
              ) : (
                <div className="h-16 w-28 rounded-md bg-muted flex items-center justify-center">
                  <Video className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <span className="text-sm text-muted-foreground">
                {thumbnailFile ? thumbnailFile.name : "Selecionar imagem de capa"}
              </span>
            </label>
          </div>

          {/* Source URL */}
          <div className="space-y-1.5">
            <Label>URL da Fonte Original</Label>
            <Input
              placeholder="https://archive.org/details/... ou https://vimeo.com/..."
              value={form.source_url}
              onChange={(e) => setForm((p) => ({ ...p, source_url: e.target.value }))}
            />
          </div>

          {/* License */}
          <div className="space-y-1.5">
            <Label>Licença</Label>
            <Select
              value={form.license_type}
              onValueChange={(v) => setForm((p) => ({ ...p, license_type: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CC0">CC0 — Domínio Público</SelectItem>
                <SelectItem value="CC-BY">CC-BY — Atribuição</SelectItem>
                <SelectItem value="CC-BY-SA">CC-BY-SA — Atribuição + CompartilhaIgual</SelectItem>
                <SelectItem value="CC-BY-NC-SA">CC-BY-NC-SA — Não Comercial + CompartilhaIgual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Attribution */}
          <div className="space-y-1.5">
            <Label>Texto de Atribuição</Label>
            <Input
              placeholder='"Introduction to AI" por freeCodeCamp — CC-BY'
              value={form.attribution_text}
              onChange={(e) => setForm((p) => ({ ...p, attribution_text: e.target.value }))}
            />
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label>Tags (separadas por vírgula)</Label>
            <Input
              placeholder="tecnologia, ia, programação"
              value={form.tags}
              onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
            />
          </div>

          <Button
            type="submit"
            disabled={submitting || uploadState !== "done"}
            className="w-full"
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Publicando...</>
            ) : (
              "Publicar Conteúdo Curado"
            )}
          </Button>
        </form>
      </div>
    </AdminLayout>
  );
}
