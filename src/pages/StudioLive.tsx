import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Radio, Video, VideoOff, Mic, MicOff, Loader2, ImagePlus } from "lucide-react";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { CameraPreview } from "@/components/live/CameraPreview";
import { cn } from "@/lib/utils";

export default function StudioLive() {
  const { user, profile, role } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);

  const {
    stream,
    isStreamActive,
    cameras,
    microphones,
    selectedCamera,
    selectedMicrophone,
    isLoading: mediaLoading,
    error: mediaError,
    hasPermission,
    isCameraOn,
    isMicOn,
    audioLevel,
    startStream,
    stopStream,
    toggleCamera,
    toggleMic,
    flipCamera,
    selectCamera,
    selectMicrophone,
    requestPermissions,
  } = useMediaDevices();

  // Request permissions on mount
  useEffect(() => {
    requestPermissions().then((granted) => {
      if (granted) {
        startStream();
      }
    });

    return () => {
      stopStream();
    };
  }, []);

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setThumbnailUploading(true);
    setThumbnailPreview(URL.createObjectURL(file));

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `live-thumbnails/${user.id}/${Date.now()}.${fileExt}`;

      const { error } = await supabase.storage.from("contents").upload(fileName, file);
      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from("contents").getPublicUrl(fileName);
      setThumbnailUrl(publicUrl);
      toast.success("Thumbnail enviada!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar thumbnail");
      setThumbnailPreview("");
    } finally {
      setThumbnailUploading(false);
    }
  };

  const handleStartLive = async () => {
    if (!title.trim()) {
      toast.error("Preencha o título da live");
      return;
    }

    if (!user) {
      toast.error("Você precisa estar logado");
      return;
    }

    setIsCreating(true);

    try {
      // Create live record
      const { data: live, error } = await supabase
        .from("lives")
        .insert({
          creator_id: user.id,
          title: title.trim(),
          description: description.trim() || null,
          thumbnail_url: thumbnailUrl || null,
          status: "live",
          started_at: new Date().toISOString(),
          stream_key: crypto.randomUUID(),
        })
        .select()
        .single();

      if (error) throw error;

      toast.success("Live iniciada!");
      navigate(`/live/${live.id}/broadcast`);
    } catch (error: any) {
      console.error("Error creating live:", error);
      toast.error(error.message || "Erro ao criar live");
    } finally {
      setIsCreating(false);
    }
  };

  if (!user || (role !== "creator" && role !== "admin")) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center max-w-md">
          <Radio className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-bold mb-2">Acesso Restrito</h2>
          <p className="text-muted-foreground">
            Apenas creators aprovados podem iniciar transmissões ao vivo.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-black">
      {/* Camera Background */}
      {isStreamActive && (
        <div className="absolute inset-0">
          <CameraPreview
            stream={stream}
            isCameraOn={isCameraOn}
            isMicOn={isMicOn}
            audioLevel={audioLevel}
            cameras={cameras}
            microphones={microphones}
            selectedCamera={selectedCamera}
            selectedMicrophone={selectedMicrophone}
            onToggleCamera={toggleCamera}
            onToggleMic={toggleMic}
            onFlipCamera={flipCamera}
            onSelectCamera={selectCamera}
            onSelectMicrophone={selectMicrophone}
            showControls={false}
            showSettings={false}
            size="full"
            className="blur-sm opacity-50"
          />
        </div>
      )}

      {/* Overlay Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-lg bg-background/95 backdrop-blur-xl border-border/50 p-6 space-y-6">
          {/* Header */}
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-destructive/10 text-destructive rounded-full text-sm font-medium mb-4">
              <span className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
              Preparar Live
            </div>
            <h1 className="text-2xl font-bold">Iniciar Transmissão</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Configure sua live antes de ir ao ar
            </p>
          </div>

          {/* Camera Preview */}
          <div className="aspect-video rounded-lg overflow-hidden bg-muted">
            {!hasPermission ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                <VideoOff className="w-12 h-12 text-muted-foreground" />
                <p className="text-muted-foreground text-sm">Permissão de câmera necessária</p>
                <Button onClick={() => requestPermissions().then(granted => granted && startStream())}>
                  Permitir Acesso
                </Button>
              </div>
            ) : mediaError ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-destructive">
                <VideoOff className="w-12 h-12" />
                <p className="text-sm">{mediaError}</p>
              </div>
            ) : (
              <CameraPreview
                stream={stream}
                isCameraOn={isCameraOn}
                isMicOn={isMicOn}
                audioLevel={audioLevel}
                cameras={cameras}
                microphones={microphones}
                selectedCamera={selectedCamera}
                selectedMicrophone={selectedMicrophone}
                onToggleCamera={toggleCamera}
                onToggleMic={toggleMic}
                onFlipCamera={flipCamera}
                onSelectCamera={selectCamera}
                onSelectMicrophone={selectMicrophone}
                size="full"
              />
            )}
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Título da Live *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Live sobre produtividade"
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Sobre o que você vai falar..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Thumbnail (opcional)</Label>
              <div className="flex gap-3">
                {thumbnailPreview ? (
                  <div className="relative w-24 h-16 rounded overflow-hidden">
                    <img src={thumbnailPreview} alt="Thumbnail" className="w-full h-full object-cover" />
                  </div>
                ) : null}
                <label className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-3 cursor-pointer hover:border-accent transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleThumbnailUpload}
                    className="hidden"
                  />
                  {thumbnailUploading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <ImagePlus className="w-5 h-5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {thumbnailPreview ? "Trocar" : "Adicionar thumbnail"}
                      </span>
                    </>
                  )}
                </label>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => navigate("/studio")} className="flex-1">
              Cancelar
            </Button>
            <Button
              onClick={handleStartLive}
              disabled={!title.trim() || isCreating || !hasPermission}
              className="flex-1 bg-destructive hover:bg-destructive/90"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Iniciando...
                </>
              ) : (
                <>
                  <Radio className="w-4 h-4 mr-2" />
                  Iniciar Live
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
