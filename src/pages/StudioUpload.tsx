import { useState, useEffect } from "react";
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
import { Upload, Video, Music, Film, BookOpen, Radio, X, ImagePlus } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { TagsInput } from "@/components/TagsInput";

type ContentType = "aula" | "short" | "podcast" | "curso" | "live";
type Visibility = "free" | "pro" | "premium" | "paid";

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
    if (type && ["aula", "short", "podcast", "curso", "live"].includes(type)) {
      setContentType(type);
    }
  }, [searchParams]);
  
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create preview
    const previewUrl = URL.createObjectURL(file);
    setFilePreview(previewUrl);

    // Validações
    if (contentType === "short") {
      const video = document.createElement("video");
      video.src = previewUrl;
      video.onloadedmetadata = () => {
        if (video.duration > 180) {
          toast.error("Shorts devem ter no máximo 180 segundos");
          setFilePreview("");
          return;
        }
        setDuration(Math.floor(video.duration));
      };
    }

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

    setFileUploading(true);
    setFileProgress(0);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setFileProgress(prev => {
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
      setFileProgress(100);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('contents')
        .getPublicUrl(fileName);

      setFileUrl(publicUrl);
      toast.success("Arquivo enviado com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar arquivo");
      setFilePreview("");
      setFileProgress(0);
    } finally {
      setFileUploading(false);
    }
  };

  const handleRemoveFile = () => {
    setFileUrl("");
    setFilePreview("");
    setFileProgress(0);
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
                        <div className={`relative w-full h-64 rounded-lg overflow-hidden ${fileUploading ? 'opacity-50' : ''}`}>
                          {contentType === "podcast" ? (
                            <div className="flex items-center justify-center w-full h-full bg-muted">
                              <Music className="w-16 h-16 text-primary" />
                            </div>
                          ) : (
                            <video
                              src={filePreview}
                              className="w-full h-full object-cover"
                              controls={!fileUploading}
                            />
                          )}
                          
                          {!fileUploading && (
                            <button
                              onClick={handleRemoveFile}
                              className="absolute top-2 right-2 p-2 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}

                      {fileUploading && (
                        <div className="mt-4 space-y-2">
                          <Progress value={fileProgress} />
                          <p className="text-xs text-center text-muted-foreground">
                            Enviando... {fileProgress}%
                          </p>
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
                        <div className={`relative w-full h-64 rounded-lg overflow-hidden ${thumbnailUploading ? 'opacity-50' : ''}`}>
                          <img
                            src={thumbnailPreview}
                            alt="Thumbnail preview"
                            className="w-full h-full object-cover"
                          />
                          
                          {!thumbnailUploading && (
                            <button
                              onClick={handleRemoveThumbnail}
                              className="absolute top-2 right-2 p-2 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}

                      {thumbnailUploading && (
                        <div className="mt-4 space-y-2">
                          <Progress value={thumbnailProgress} />
                          <p className="text-xs text-center text-muted-foreground">
                            Enviando... {thumbnailProgress}%
                          </p>
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
