import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, Loader2, AlertCircle, CheckCircle } from "lucide-react";

interface BecomeCreatorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BecomeCreatorModal({ open, onOpenChange }: BecomeCreatorModalProps) {
  const { user, refreshProfile } = useAuth();
  const [channelName, setChannelName] = useState("");
  const [bio, setBio] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!channelName.trim()) {
      setError("Nome do canal é obrigatório");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      // Create creator request
      const { error: requestError } = await supabase
        .from('creator_requests')
        .insert({
          user_id: user?.id,
          channel_name: channelName,
          bio: bio || null,
          status: 'pending'
        });

      if (requestError) throw requestError;

      // Update profile creator status
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
          creator_status: 'pending',
          creator_channel_name: channelName,
          creator_bio: bio || null
        })
        .eq('id', user?.id);

      if (profileError) throw profileError;

      setSuccess(true);
      await refreshProfile();
      
      setTimeout(() => {
        onOpenChange(false);
        setSuccess(false);
        setChannelName("");
        setBio("");
      }, 2000);

    } catch (error: any) {
      setError(error.message || "Erro ao enviar solicitação");
      console.error('Creator request error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cinematic-accent" />
            Torne-se Creator
          </DialogTitle>
          <DialogDescription>
            Compartilhe seu conhecimento e ganhe com seus conteúdos
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle className="w-12 h-12 text-green-500" />
            <div>
              <p className="font-medium text-foreground mb-1">Solicitação enviada!</p>
              <p className="text-sm text-muted-foreground">
                Aguarde a análise do admin
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channel-name">Nome do Canal *</Label>
              <Input
                id="channel-name"
                placeholder="Ex: Canal Tech com João"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                disabled={isSubmitting}
                className="bg-muted border-border"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio (opcional)</Label>
              <Textarea
                id="bio"
                placeholder="Conte um pouco sobre você e seu conteúdo..."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                disabled={isSubmitting}
                rows={4}
                className="bg-muted border-border resize-none"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 bg-cinematic-accent hover:bg-cinematic-accent/90 text-white"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enviando
                  </>
                ) : (
                  "Enviar Solicitação"
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
