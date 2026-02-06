import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Video, Music, Film, BookOpen, Radio, Trash2, ImagePlus, CheckCircle2, Loader2, Zap, ArrowDown } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { TagsInput } from "@/components/TagsInput";
import { useVideoCompression } from "@/hooks/useVideoCompression";
import { Badge } from "@/components/ui/badge";

type ContentType = "aula" | "short" | "podcast" | "curso" | "live";
type Visibility = "free" | "pro" | "premium" | "paid";
type UploadState = "idle" | "compressing" | "uploading" | "processing" | "complete";

export default function StudioUpload() {
  const { user, role, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const editId = searchParams.get('edit');
  const [isEditMode, setIsEditMode] = useState(false);
  const [originalStatus, setOriginalStatus] = useState<string | null>(null);
  const [contentType, setContentType] = useState<ContentType>("aula");
  
  useEffect(() => {
    const type = searchParams.get('type') as ContentType;
    if (type === 'live') {
      navigate('/studio/live');
      return;
    }
    if (type && ["aula", "short", "podcast", "curso"].includes(type)) {
      setContentType(type);
    }
  }, [searchParams, navigate]);
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("free");
  const [price, setPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [fileUploading, setFileUploading] = useState(false);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [fileUrl, setFileUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [fileProgress, setFileProgress] = useState(0);
  const [thumbnailProgress, setThumbnailProgress] = useState(0);
  const [filePreview, setFilePreview] = useState("");
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [fileSize, setFileSize] = useState<number>(0);
  const [originalFileSize, setOriginalFileSize] = useState<number>(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  
  // Video compression hook
  const {
    isCompressing,
    isLoading: compressionLoading,
    progress: compressionProgress,
    stage: compressionStage,
    message: compressionMessage,
    originalSize,
    compressedSize,
    compressionRatio,
    compressVideo,
    abort: abortCompression,
    reset: resetCompression,
  } = useVideoCompression();
  
  // Load content data if editing
  useEffect(() => {
    if (editId && user) {
      loadContentForEdit();
    }
  }, [editId, user]);
  
  const loadContentForEdit = async () => {
    if (!editId || !user) return;
    
    try {
      const { data, error } = await supabase
        .from('contents')
        .select('*')
        .eq('id', editId)
        .eq('creator_id', user.id)
        .single();
      
      if (error) throw error;
      
      if (data) {
        setIsEditMode(true);
        setOriginalStatus(data.status);
        setTitle(data.title);
        setDescription(data.description || "");
        setContentType(data.content_type as ContentType);
        setVisibility(data.visibility as Visibility);
        setPrice(data.price?.toString() || "0");
        setDiscount(data.discount?.toString() || "0");
        setFileUrl(data.file_url || "");
        setThumbnailUrl(data.thumbnail_url || "");
        setDuration(data.duration_seconds || 0);
        setTags(data.tags || []);
        setFilePreview(data.file_url || "");
        setThumbnailPreview(data.thumbnail_url || "");
        setFileProgress(100);
        setThumbnailProgress(100);
      }
    } catch (error: any) {
      console.error("Erro ao carregar conteúdo:", error);
      toast.error("Erro ao carregar conteúdo para edição");
      navigate('/studio/contents');
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }

  if (!user || (role !== 'creator' && role !== 'admin')) {
    return <Navigate to="/" replace />;
  }

  if (profile?.creator_status !== 'approved' && role !== 'admin') {
    return (
      <SidebarProvider defaultOpen={true}>
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col">
            <Header variant="studio" title="Publicar Conteúdo" />
            <main className="flex-1 p-6 md:p-12 flex items-center justify-center">
              <Card className="p-8 text-center max-w-md">
                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h2 className="text-xl font-bold mb-2">Apenas Creators podem publicar conteúdos</h2>
                <p className="text-muted-foreground">
                  Você precisa ser um Creator aprovado para publicar conteúdos na Classfy.
                </p>
              </Card>
            </main>
          </div>
        </div>
      </SidebarProvider>
    );
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create preview immediately using local blob URL
    const previewUrl = URL.createObjectURL(file);
    setFilePreview(previewUrl);
    setFileUploading(true);
    setFileProgress(0);
    setOriginalFileSize(file.size);
    setFileSize(file.size);

    // For duration validation on shorts
    if (contentType === "short") {
      const video = document.createElement("video");
      video.src = previewUrl;
      video.onloadedmetadata = () => {
        if (video.duration > 180) {
          toast.error("Shorts devem ter no máximo 180 segundos");
          setFileUploading(false);
          setUploadState("idle");
          setFilePreview("");
          URL.revokeObjectURL(previewUrl);
          return;
        }
        setDuration(Math.floor(video.duration));
      };
    }

    // Extract duration for audio/video
    if (contentType === "podcast") {
      const audio = document.createElement("audio");
      audio.src = previewUrl;
      audio.onloadedmetadata = () => {
        setDuration(Math.floor(audio.duration));
      };
    }

    if (contentType === "aula" || contentType === "curso" || contentType === "live") {
      const video = document.createElement("video");
      video.src = previewUrl;
      video.onloadedmetadata = () => {
        setDuration(Math.floor(video.duration));
      };
    }

    try {
      let fileToUpload = file;
      
      // Compress video files (not podcasts/audio)
      if (contentType !== "podcast") {
        setUploadState("compressing");
        
        try {
          fileToUpload = await compressVideo(file, {
            quality: 'balanced',
            maxWidth: 1920,
            maxHeight: 1080,
          });
          
          // Update file size to compressed size
          setFileSize(fileToUpload.size);
          
          // Update preview if file was compressed
          if (fileToUpload !== file) {
            URL.revokeObjectURL(previewUrl);
            const newPreviewUrl = URL.createObjectURL(fileToUpload);
            setFilePreview(newPreviewUrl);
          }
        } catch (compressionError) {
          console.warn('Compression failed, using original file:', compressionError);
          // Continue with original file if compression fails
        }
      }
      
      // Now upload the file
      setUploadState("uploading");
      setFileProgress(0);
      
      const fileExt = fileToUpload.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      // Get upload URL for tracking progress
      const { data: session } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const uploadUrl = `${supabaseUrl}/storage/v1/object/contents/${fileName}`;

      // Use XMLHttpRequest for real progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setFileProgress(percent);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

        xhr.open('POST', uploadUrl);
        xhr.setRequestHeader('Authorization', `Bearer ${session?.session?.access_token}`);
        xhr.setRequestHeader('x-upsert', 'true');
        xhr.send(fileToUpload);
      });

      // Show processing state briefly
      setUploadState("processing");
      
      const { data: { publicUrl } } = supabase.storage
        .from('contents')
        .getPublicUrl(fileName);

      // Small delay to show processing state
      await new Promise(resolve => setTimeout(resolve, 500));

      setFileUrl(publicUrl);
      setUploadState("complete");
      setFileProgress(100);
      
      // Show compression savings if applicable
      if (compressionRatio > 5) {
        toast.success(`Arquivo enviado! Comprimido ${compressionRatio.toFixed(0)}% (${formatFileSize(originalFileSize)} → ${formatFileSize(fileSize)})`);
      } else {
        toast.success("Arquivo enviado com sucesso!");
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar arquivo");
      setFilePreview("");
      setFileProgress(0);
      setUploadState("idle");
      resetCompression();
    } finally {
      setFileUploading(false);
      xhrRef.current = null;
    }
  };

  const handleRemoveFile = () => {
    // Cancel ongoing upload if any
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    // Cancel compression if in progress
    if (isCompressing) {
      abortCompression();
    }
    setFileUrl("");
    setFilePreview("");
    setFileProgress(0);
    setUploadState("idle");
    setFileSize(0);
    setOriginalFileSize(0);
    resetCompression();
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create preview
    const previewUrl = URL.createObjectURL(file);
    setThumbnailPreview(previewUrl);

    setThumbnailUploading(true);
    setThumbnailProgress(0);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `thumbnails/${user.id}/${Date.now()}.${fileExt}`;
      
      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setThumbnailProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      const { error } = await supabase.storage
        .from('contents')
        .upload(fileName, file);

      clearInterval(progressInterval);
      setThumbnailProgress(100);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('contents')
        .getPublicUrl(fileName);

      setThumbnailUrl(publicUrl);
      toast.success("Thumbnail enviada com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar thumbnail");
      setThumbnailPreview("");
      setThumbnailProgress(0);
    } finally {
      setThumbnailUploading(false);
    }
  };

  const handleRemoveThumbnail = () => {
    setThumbnailUrl("");
    setThumbnailPreview("");
    setThumbnailProgress(0);
  };

  const handleGenerateTags = async () => {
    if (!title.trim()) {
      toast.error("Preencha o título primeiro para gerar tags");
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

      if (data?.tags) {
        setTags(data.tags);
        toast.success(`${data.tags.length} tags geradas com sucesso!`);
      }
    } catch (error: any) {
      console.error("Erro ao gerar tags:", error);
      toast.error(error.message || "Erro ao gerar tags");
    } finally {
      setIsGeneratingTags(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title || !fileUrl || !thumbnailUrl) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setSubmitting(true);
    try {
      // Map frontend content types to database types
      const dbContentType = contentType === "curso" || contentType === "live" ? "aula" : contentType;
      
      const contentData = {
        content_type: dbContentType,
        title,
        description: description || null,
        file_url: fileUrl,
        thumbnail_url: thumbnailUrl,
        duration_seconds: duration,
        visibility,
        price: visibility === 'paid' ? parseFloat(price) : 0,
        discount: visibility === 'paid' ? parseFloat(discount) : 0,
        tags: tags.length > 0 ? tags : null,
      };

      if (isEditMode && editId) {
        // UPDATE existing content
        // If content was approved, set back to pending for re-approval
        const newStatus = originalStatus === 'approved' ? 'pending' : originalStatus;
        
        const { error } = await supabase
          .from('contents')
          .update({
            ...contentData,
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editId)
          .eq('creator_id', user.id);

        if (error) throw error;

        if (originalStatus === 'approved') {
          toast.success("Conteúdo atualizado! Como estava aprovado, voltará para revisão do admin.");
        } else {
          toast.success("Conteúdo atualizado com sucesso!");
        }
      } else {
        // INSERT new content
        const { error } = await supabase
          .from('contents')
          .insert({
            ...contentData,
            creator_id: user.id,
            status: 'pending',
            views_count: 0,
            likes_count: 0,
          });

        if (error) throw error;

        toast.success("Seu conteúdo foi enviado e aguarda aprovação!");
      }
      
      navigate('/studio/contents');
    } catch (error: any) {
      toast.error(error.message || "Erro ao publicar conteúdo");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <Header
            variant="studio"
            title={
              isEditMode ? "Editar Conteúdo" :
              contentType === "aula" ? "Publicar Aula" :
              contentType === "curso" ? "Criar Curso" :
              contentType === "podcast" ? "Enviar Podcast" :
              contentType === "short" ? "Postar Short" :
              "Transmitir ao Vivo"
            }
          />

          <main className="flex-1 p-6 md:p-12">
            <div className="max-w-3xl mx-auto">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Tipo de Conteúdo */}
                <Card className="p-6">
                  <Label>Tipo de Conteúdo</Label>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-4 mt-4">
                    <Button
                      type="button"
                      variant={contentType === "aula" ? "default" : "outline"}
                      onClick={() => setContentType("aula")}
                      className="flex flex-col gap-2 h-auto py-4"
                    >
                      <Video className="w-6 h-6" />
                      <span className="text-xs">Aula</span>
                    </Button>
                    <Button
                      type="button"
                      variant={contentType === "curso" ? "default" : "outline"}
                      onClick={() => setContentType("curso")}
                      className="flex flex-col gap-2 h-auto py-4"
                    >
                      <BookOpen className="w-6 h-6" />
                      <span className="text-xs">Curso</span>
                    </Button>
                    <Button
                      type="button"
                      variant={contentType === "podcast" ? "default" : "outline"}
                      onClick={() => setContentType("podcast")}
                      className="flex flex-col gap-2 h-auto py-4"
                    >
                      <Music className="w-6 h-6" />
                      <span className="text-xs">Podcast</span>
                    </Button>
                    <Button
                      type="button"
                      variant={contentType === "short" ? "default" : "outline"}
                      onClick={() => setContentType("short")}
                      className="flex flex-col gap-2 h-auto py-4"
                    >
                      <Film className="w-6 h-6" />
                      <span className="text-xs">Short</span>
                    </Button>
                    <Button
                      type="button"
                      variant={contentType === "live" ? "default" : "outline"}
                      onClick={() => setContentType("live")}
                      className="flex flex-col gap-2 h-auto py-4"
                    >
                      <Radio className="w-6 h-6" />
                      <span className="text-xs">Ao Vivo</span>
                    </Button>
                  </div>
                </Card>

                {/* Upload de Arquivo e Thumbnail - Lado a Lado */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Upload de Arquivo */}
                  <Card className="p-6">
                    <Label>Arquivo {contentType === "podcast" ? "de Áudio" : "de Vídeo"} *</Label>
                    
                    <div className="mt-4">
                      {!filePreview ? (
                        <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary transition-colors bg-muted/20">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            {contentType === "podcast" ? (
                              <Music className="w-12 h-12 mb-4 text-muted-foreground" />
                            ) : (
                              <Video className="w-12 h-12 mb-4 text-muted-foreground" />
                            )}
                            <p className="mb-2 text-sm text-muted-foreground font-medium">
                              Enviar arquivo
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Clique ou arraste {contentType === "podcast" ? "o áudio" : "o vídeo"}
                            </p>
                          </div>
                          <input
                            type="file"
                            className="hidden"
                            accept={contentType === "podcast" ? "audio/*" : "video/*"}
                            onChange={handleFileUpload}
                            disabled={fileUploading}
                          />
                        </label>
                      ) : (
                        <div className="relative w-full">
                          <div className="w-full h-64 rounded-lg overflow-hidden relative">
                            {contentType === "podcast" ? (
                              <div className="flex items-center justify-center w-full h-full bg-muted">
                                <Music className="w-16 h-16 text-primary" />
                              </div>
                            ) : (
                              <>
                                {/* Video preview - interactive when upload complete */}
                                <video
                                  src={filePreview}
                                  className="w-full h-full object-cover"
                                  controls={uploadState === "complete" || uploadState === "idle"}
                                  muted={uploadState !== "complete" && uploadState !== "idle"}
                                  playsInline
                                />
                                
                                {/* Overlay during compression/upload/processing */}
                                {(uploadState === "compressing" || uploadState === "uploading" || uploadState === "processing") && (
                                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10">
                                    {uploadState === "compressing" ? (
                                      <>
                                        <Zap className="w-10 h-10 text-yellow-400 animate-pulse" />
                                        <div className="text-white text-2xl font-bold tabular-nums">
                                          {compressionProgress}%
                                        </div>
                                        <Progress 
                                          value={compressionProgress} 
                                          variant="gradient" 
                                          className="w-3/4 h-2"
                                        />
                                        <p className="text-white/70 text-sm text-center px-4">
                                          {compressionMessage || 'Otimizando vídeo...'}
                                        </p>
                                        {originalFileSize > 0 && (
                                          <div className="flex items-center gap-2 text-white/50 text-xs mt-1">
                                            <span>{formatFileSize(originalFileSize)}</span>
                                            <ArrowDown className="w-3 h-3" />
                                            <span className="text-green-400">Comprimindo...</span>
                                          </div>
                                        )}
                                      </>
                                    ) : uploadState === "uploading" ? (
                                      <>
                                        <div className="text-white text-4xl font-bold tabular-nums">
                                          {fileProgress}%
                                        </div>
                                        <Progress 
                                          value={fileProgress} 
                                          variant="gradient" 
                                          className="w-3/4 h-2"
                                        />
                                        <p className="text-white/70 text-sm">
                                          Enviando {formatFileSize(fileSize)}...
                                        </p>
                                        {compressionRatio > 5 && (
                                          <Badge variant="secondary" className="bg-green-500/20 text-green-300 border-green-500/30">
                                            <ArrowDown className="w-3 h-3 mr-1" />
                                            {compressionRatio.toFixed(0)}% menor
                                          </Badge>
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        <Loader2 className="w-10 h-10 text-white animate-spin" />
                                        <p className="text-white text-sm">Finalizando...</p>
                                      </>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          
                          {/* Remove button - show when not uploading/compressing */}
                          {uploadState !== "uploading" && uploadState !== "processing" && uploadState !== "compressing" && (
                            <button
                              type="button"
                              onClick={handleRemoveFile}
                              className="absolute top-2 right-2 p-2 bg-muted/80 backdrop-blur-sm text-muted-foreground rounded-lg hover:bg-muted hover:text-foreground transition-colors z-20"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}

                      {contentType === "short" && (
                        <p className="text-xs text-muted-foreground mt-2">Máximo 180 segundos</p>
                      )}
                    </div>
                  </Card>

                  {/* Upload de Thumbnail */}
                  <Card className="p-6">
                    <Label>Thumbnail *</Label>
                    
                    <div className="mt-4">
                      {!thumbnailPreview ? (
                        <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary transition-colors bg-muted/20">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <ImagePlus className="w-12 h-12 mb-4 text-muted-foreground" />
                            <p className="mb-2 text-sm text-muted-foreground font-medium">
                              Enviar arquivo
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Clique ou arraste a imagem
                            </p>
                          </div>
                          <input
                            type="file"
                            className="hidden"
                            accept="image/*"
                            onChange={handleThumbnailUpload}
                            disabled={thumbnailUploading}
                          />
                        </label>
                      ) : (
                        <div className="relative w-full">
                          {/* Gradient progress bar at top - Instagram style */}
                          {thumbnailUploading && (
                            <Progress 
                              variant="gradient" 
                              indeterminate 
                              className="absolute top-0 left-0 right-0 z-10"
                            />
                          )}
                          
                          <div className={`w-full h-64 rounded-lg overflow-hidden ${thumbnailUploading ? 'opacity-70' : ''}`}>
                            <img
                              src={thumbnailPreview}
                              alt="Thumbnail preview"
                              className="w-full h-full object-cover"
                            />
                          </div>
                          
                          {!thumbnailUploading && (
                            <button
                              onClick={handleRemoveThumbnail}
                              className="absolute top-2 right-2 p-2 bg-muted/80 backdrop-blur-sm text-muted-foreground rounded-lg hover:bg-muted hover:text-foreground transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                {/* Informações */}
                <Card className="p-6 space-y-4">
                  <div>
                    <Label>Título *</Label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Digite o título"
                      className="mt-2"
                    />
                  </div>

                  {(contentType === "aula" || contentType === "podcast") && (
                    <div>
                      <Label>Descrição</Label>
                      <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Descreva o conteúdo"
                        className="mt-2"
                      />
                    </div>
                  )}

                  <div>
                    <Label>Tags</Label>
                    <div className="mt-2">
                      <TagsInput
                        tags={tags}
                        onChange={setTags}
                        onGenerateTags={handleGenerateTags}
                        isGenerating={isGeneratingTags}
                        placeholder="Digite tags para melhorar a descoberta do conteúdo..."
                      />
                    </div>
                  </div>
                </Card>

                {/* Visibilidade e Preço */}
                <Card className="p-6 space-y-4">
                  <div>
                    <Label>Visibilidade</Label>
                    <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">Gratuito</SelectItem>
                        <SelectItem value="pro">PRO</SelectItem>
                        <SelectItem value="premium">Premium</SelectItem>
                        <SelectItem value="paid">Pago</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {visibility === "paid" && (
                    <>
                      <div>
                        <Label>Preço (R$)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                      <div>
                        <Label>Desconto (%)</Label>
                        <Input
                          type="number"
                          step="1"
                          value={discount}
                          onChange={(e) => setDiscount(e.target.value)}
                          className="mt-2"
                        />
                      </div>
                    </>
                  )}
                </Card>

                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting 
                    ? (isEditMode ? "Salvando..." : "Publicando...") 
                    : (isEditMode ? "Salvar Alterações" : "Publicar Conteúdo")
                  }
                </Button>
              </form>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
