import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";
import { Label } from "@/components/ui/label";

interface CoverUploadProps {
  userId: string;
  currentCoverUrl?: string | null;
  onUploadComplete?: (url: string) => void;
}

export const CoverUpload = ({ userId, currentCoverUrl, onUploadComplete }: CoverUploadProps) => {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentCoverUrl || null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Arquivo inválido",
          description: "Por favor, selecione uma imagem.",
          variant: "destructive",
        });
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "Arquivo muito grande",
          description: "A imagem deve ter no máximo 5MB.",
          variant: "destructive",
        });
        return;
      }

      setUploading(true);

      // Create preview
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      // Upload to storage
      const fileExt = file.name.split(".").pop();
      const fileName = `${userId}/cover-${Date.now()}.${fileExt}`;

      const { error: uploadError, data } = await supabase.storage
        .from("covers")
        .upload(fileName, file, {
          upsert: true,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("covers")
        .getPublicUrl(fileName);

      // Update profile
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ cover_image_url: publicUrl })
        .eq("id", userId);

      if (updateError) throw updateError;

      toast({
        title: "Sucesso!",
        description: "Capa do canal atualizada.",
      });

      onUploadComplete?.(publicUrl);
    } catch (error: any) {
      console.error("Error uploading cover:", error);
      toast({
        title: "Erro ao fazer upload",
        description: error.message,
        variant: "destructive",
      });
      setPreviewUrl(currentCoverUrl || null);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveCover = async () => {
    try {
      setUploading(true);

      // Update profile to remove cover
      const { error } = await supabase
        .from("profiles")
        .update({ cover_image_url: null })
        .eq("id", userId);

      if (error) throw error;

      setPreviewUrl(null);
      onUploadComplete?.("");

      toast({
        title: "Capa removida",
        description: "A capa do seu canal foi removida.",
      });
    } catch (error: any) {
      toast({
        title: "Erro ao remover capa",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Label>Capa do Canal</Label>
      
      {previewUrl ? (
        <div className="relative group">
          <img
            src={previewUrl}
            alt="Cover preview"
            className="w-full h-48 object-cover rounded-lg border border-border"
          />
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => document.getElementById("cover-upload")?.click()}
              disabled={uploading}
            >
              <Upload className="w-4 h-4 mr-2" />
              Alterar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRemoveCover}
              disabled={uploading}
            >
              <X className="w-4 h-4 mr-2" />
              Remover
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="w-full h-48 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => document.getElementById("cover-upload")?.click()}
        >
          <Upload className="w-10 h-10 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium">Clique para fazer upload</p>
            <p className="text-xs text-muted-foreground">PNG, JPG até 5MB</p>
          </div>
        </div>
      )}

      <input
        id="cover-upload"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
        disabled={uploading}
      />

      <p className="text-xs text-muted-foreground">
        Recomendamos uma imagem de 1920x480 pixels para melhor visualização
      </p>
    </div>
  );
};