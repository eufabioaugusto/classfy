import { useState } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Upload, Loader2 } from "lucide-react";

interface EditableAvatarProps {
  userId: string;
  avatarUrl?: string | null;
  displayName: string;
  size?: "sm" | "md" | "lg" | "xl";
  editable?: boolean;
  onUploadSuccess?: () => void;
}

export const EditableAvatar = ({ 
  userId, 
  avatarUrl, 
  displayName, 
  size = "lg",
  editable = true,
  onUploadSuccess 
}: EditableAvatarProps) => {
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const { refreshProfile } = useAuth();

  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-20 w-20",
    xl: "h-32 w-32"
  };

  const buttonSizeClasses = {
    sm: "text-xs px-2 py-1",
    md: "text-sm px-3 py-1.5",
    lg: "text-sm px-4 py-2",
    xl: "text-base px-5 py-2.5"
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);

      if (!event.target.files || event.target.files.length === 0) {
        return;
      }

      const file = event.target.files[0];
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Arquivo inválido",
          description: "Por favor, selecione uma imagem.",
          variant: "destructive",
        });
        return;
      }

      // Validate file size (max 2MB)
      if (file.size > 2 * 1024 * 1024) {
        toast({
          title: "Arquivo muito grande",
          description: "O tamanho máximo é 2MB.",
          variant: "destructive",
        });
        return;
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/avatar.${fileExt}`;

      // Delete old avatar if exists
      if (avatarUrl) {
        const oldPath = avatarUrl.split('/').slice(-2).join('/');
        await supabase.storage.from('avatars').remove([oldPath]);
      }

      // Upload new avatar
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Update profile with new avatar URL
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);

      if (updateError) throw updateError;

      // Atualiza o contexto de autenticação
      await refreshProfile();
      
      toast({
        title: "Foto atualizada!",
        description: "Sua foto de perfil foi atualizada com sucesso.",
      });

      if (onUploadSuccess) {
        onUploadSuccess();
      }
    } catch (error: any) {
      toast({
        title: "Erro ao fazer upload",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      // Reset input
      event.target.value = '';
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <Avatar className={sizeClasses[size]}>
        {avatarUrl && (
          <AvatarImage 
            src={`${avatarUrl}?t=${Date.now()}`} 
            alt={displayName}
            key={avatarUrl} 
          />
        )}
        <AvatarFallback className="bg-primary text-primary-foreground">
          {getInitials(displayName)}
        </AvatarFallback>
      </Avatar>
      
      {editable && (
        <div className="flex flex-col gap-2 w-full">
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            size={size === "xl" ? "default" : "sm"}
            className={`w-full ${buttonSizeClasses[size]}`}
            onClick={() => document.getElementById(`avatar-upload-${userId}`)?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Alterar Foto
              </>
            )}
          </Button>
          <Input
            id={`avatar-upload-${userId}`}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
            disabled={uploading}
          />
          <p className="text-xs text-muted-foreground text-center">
            JPG, PNG ou GIF. Máx 2MB
          </p>
        </div>
      )}
    </div>
  );
};
