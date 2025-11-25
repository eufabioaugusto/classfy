import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface MessageSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type PrivacyMode = "open" | "followers" | "request" | "closed";

export const MessageSettingsModal = ({ open, onClose }: MessageSettingsModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>("open");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && user) {
      loadSettings();
    }
  }, [open, user]);

  const loadSettings = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("message_settings")
        .select("privacy_mode")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error && error.code !== "PGRST116") throw error;

      if (data) {
        setPrivacyMode(data.privacy_mode as PrivacyMode);
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (newMode: PrivacyMode) => {
    if (!user || saving) return;

    try {
      setSaving(true);
      setPrivacyMode(newMode);

      const { error } = await supabase
        .from("message_settings")
        .upsert({
          user_id: user.id,
          privacy_mode: newMode,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;

      toast({
        title: "Configurações salvas",
        description: "Suas preferências de mensagens foram atualizadas.",
      });
    } catch (error) {
      console.error("Error saving settings:", error);
      toast({
        title: "Erro",
        description: "Não foi possível salvar as configurações.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configurações de Mensagens</DialogTitle>
          <DialogDescription>
            Escolha quem pode enviar mensagens para você
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="p-4 text-center text-muted-foreground">
            Carregando...
          </div>
        ) : (
          <RadioGroup value={privacyMode} onValueChange={(value) => handleSave(value as PrivacyMode)}>
            <div className="space-y-4">
              <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent transition-colors cursor-pointer">
                <RadioGroupItem value="open" id="open" disabled={saving} />
                <div className="flex-1">
                  <Label htmlFor="open" className="cursor-pointer font-medium">
                    Aberto
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Qualquer pessoa pode enviar mensagens para você
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent transition-colors cursor-pointer">
                <RadioGroupItem value="followers" id="followers" disabled={saving} />
                <div className="flex-1">
                  <Label htmlFor="followers" className="cursor-pointer font-medium">
                    Apenas seguidores
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Somente pessoas que você segue podem enviar mensagens
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent transition-colors cursor-pointer">
                <RadioGroupItem value="request" id="request" disabled={saving} />
                <div className="flex-1">
                  <Label htmlFor="request" className="cursor-pointer font-medium">
                    Solicitação
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Novos contatos precisam enviar uma solicitação que você pode aprovar ou recusar
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent transition-colors cursor-pointer">
                <RadioGroupItem value="closed" id="closed" disabled={saving} />
                <div className="flex-1">
                  <Label htmlFor="closed" className="cursor-pointer font-medium">
                    Fechado
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Você não aceita mensagens de ninguém
                  </p>
                </div>
              </div>
            </div>
          </RadioGroup>
        )}
      </DialogContent>
    </Dialog>
  );
};
