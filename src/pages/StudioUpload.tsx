import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Video, Music, Film } from "lucide-react";

type ContentType = "aula" | "short" | "podcast";
type Visibility = "free" | "pro" | "premium" | "paid";

export default function StudioUpload() {
  const { user, role, profile, loading } = useAuth();
  const navigate = useNavigate();
  
  const [contentType, setContentType] = useState<ContentType>("aula");
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
            <header className="sticky top-0 z-50 border-b border-border/20 bg-background/95 backdrop-blur-xl">
              <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-4">
                  <SidebarTrigger />
                  <h1 className="text-2xl font-bold text-foreground">Publicar Conteúdo</h1>
                </div>
              </div>
            </header>
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

    // Validações
    if (contentType === "short") {
      const video = document.createElement("video");
      video.src = URL.createObjectURL(file);
      video.onloadedmetadata = () => {
        if (video.duration > 180) {
          toast.error("Shorts devem ter no máximo 180 segundos");
          return;
        }
        setDuration(Math.floor(video.duration));
      };
    }

    if (contentType === "podcast") {
      const audio = document.createElement("audio");
      audio.src = URL.createObjectURL(file);
      audio.onloadedmetadata = () => {
        setDuration(Math.floor(audio.duration));
      };
    }

    if (contentType === "aula") {
      const video = document.createElement("video");
      video.src = URL.createObjectURL(file);
      video.onloadedmetadata = () => {
        setDuration(Math.floor(video.duration));
      };
    }

    setFileUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { error } = await supabase.storage
        .from('contents')
        .upload(fileName, file);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('contents')
        .getPublicUrl(fileName);

      setFileUrl(publicUrl);
      toast.success("Arquivo enviado com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar arquivo");
    } finally {
      setFileUploading(false);
    }
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setThumbnailUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `thumbnails/${user.id}/${Date.now()}.${fileExt}`;
      
      const { error } = await supabase.storage
        .from('contents')
        .upload(fileName, file);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('contents')
        .getPublicUrl(fileName);

      setThumbnailUrl(publicUrl);
      toast.success("Thumbnail enviada com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar thumbnail");
    } finally {
      setThumbnailUploading(false);
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
      const { error } = await supabase
        .from('contents')
        .insert({
          content_type: contentType,
          title,
          description: description || null,
          file_url: fileUrl,
          thumbnail_url: thumbnailUrl,
          duration_seconds: duration,
          visibility,
          price: visibility === 'paid' ? parseFloat(price) : 0,
          discount: visibility === 'paid' ? parseFloat(discount) : 0,
          creator_id: user.id,
          status: 'pending',
          views_count: 0,
          likes_count: 0
        });

      if (error) throw error;

      toast.success("Seu conteúdo foi enviado e aguarda aprovação!");
      navigate('/studio');
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
          <header className="sticky top-0 z-50 border-b border-border/20 bg-background/95 backdrop-blur-xl">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
                <h1 className="text-2xl font-bold text-foreground">Publicar Conteúdo</h1>
              </div>
            </div>
          </header>

          <main className="flex-1 p-6 md:p-12">
            <div className="max-w-3xl mx-auto">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Tipo de Conteúdo */}
                <Card className="p-6">
                  <Label>Tipo de Conteúdo</Label>
                  <div className="grid grid-cols-3 gap-4 mt-4">
                    <Button
                      type="button"
                      variant={contentType === "aula" ? "default" : "outline"}
                      onClick={() => setContentType("aula")}
                      className="flex flex-col gap-2 h-auto py-4"
                    >
                      <Video className="w-6 h-6" />
                      Aula
                    </Button>
                    <Button
                      type="button"
                      variant={contentType === "short" ? "default" : "outline"}
                      onClick={() => setContentType("short")}
                      className="flex flex-col gap-2 h-auto py-4"
                    >
                      <Film className="w-6 h-6" />
                      Short
                    </Button>
                    <Button
                      type="button"
                      variant={contentType === "podcast" ? "default" : "outline"}
                      onClick={() => setContentType("podcast")}
                      className="flex flex-col gap-2 h-auto py-4"
                    >
                      <Music className="w-6 h-6" />
                      Podcast
                    </Button>
                  </div>
                </Card>

                {/* Upload de Arquivo */}
                <Card className="p-6">
                  <Label>Arquivo {contentType === "podcast" ? "de Áudio" : "de Vídeo"} *</Label>
                  <Input
                    type="file"
                    accept={contentType === "podcast" ? "audio/*" : "video/*"}
                    onChange={handleFileUpload}
                    disabled={fileUploading}
                    className="mt-2"
                  />
                  {fileUrl && <p className="text-sm text-green-500 mt-2">✓ Arquivo enviado</p>}
                  {contentType === "short" && (
                    <p className="text-xs text-muted-foreground mt-1">Máximo 180 segundos</p>
                  )}
                </Card>

                {/* Upload de Thumbnail */}
                <Card className="p-6">
                  <Label>Thumbnail *</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleThumbnailUpload}
                    disabled={thumbnailUploading}
                    className="mt-2"
                  />
                  {thumbnailUrl && <p className="text-sm text-green-500 mt-2">✓ Thumbnail enviada</p>}
                  {thumbnailUrl && (
                    <img src={thumbnailUrl} alt="Preview" className="mt-4 max-h-40 rounded" />
                  )}
                </Card>

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
                  {submitting ? "Publicando..." : "Publicar Conteúdo"}
                </Button>
              </form>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
