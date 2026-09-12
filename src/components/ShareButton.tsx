import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Share2, Copy, Check, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { useToast } from "@/hooks/use-toast";
import { ShareViaDMModal } from "@/components/direct-messages/ShareViaDMModal";
import { supabase } from "@/integrations/supabase/client";

interface ShareButtonProps {
  contentId: string;
  contentTitle: string;
  contentThumbnail?: string;
  creatorName?: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost";
  isCourse?: boolean;
}

export function ShareButton({ 
  contentId, 
  contentTitle, 
  contentThumbnail,
  creatorName,
  size = "sm", 
  variant = "ghost",
  isCourse = false,
}: ShareButtonProps) {
  const { user } = useAuth();
  const { processReward } = useRewardSystem();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [showDMModal, setShowDMModal] = useState(false);

  const shareUrl = `${window.location.origin}/watch/${contentId}`;

  const recordRewardableShare = async (channel: "native" | "copy" | "direct_message") => {
    if (!user) return;
    try {
      const { error } = await supabase.from("content_shares").insert({
        user_id: user.id,
        channel,
        [isCourse ? "course_id" : "content_id"]: contentId,
      });
      if (error) throw error;
      await processReward({ actionKey: "SHARE", userId: user.id, contentId });
    } catch (error) {
      // Compartilhar e recompensar sao operacoes independentes: uma falha na
      // telemetria economica nunca deve transformar um envio bem-sucedido em erro.
      console.error("Error recording rewardable share:", error);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

      // Trigger reward
      await recordRewardableShare("copy");

      toast({
        title: "Link copiado!",
        description: "O link foi copiado para sua área de transferência.",
      });
    } catch (error) {
      toast({
        title: "Erro ao copiar",
        description: "Não foi possível copiar o link.",
        variant: "destructive",
      });
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: contentTitle,
          url: shareUrl,
        });

        // Trigger reward
        await recordRewardableShare("native");
      } catch (error) {
        console.error('Error sharing:', error);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant={variant} className="gap-2 rounded-full px-4">
          <Share2 className="h-4 w-4" />
          <span className="hidden sm:inline">Compartilhar</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compartilhar Conteúdo</DialogTitle>
          <DialogDescription>
            Compartilhe este conteúdo com seus amigos
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="flex-1 px-3 py-2 border rounded-md bg-muted text-sm"
            />
            <Button onClick={handleCopy} size="icon" variant="outline">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          {/* Send via DM */}
          {user && (
            <Button 
              onClick={() => {
                setOpen(false);
                setShowDMModal(true);
              }} 
              variant="outline"
              className="w-full"
            >
              <Send className="h-4 w-4 mr-2" />
              Enviar via mensagem
            </Button>
          )}

          {navigator.share && (
            <Button onClick={handleNativeShare} className="w-full">
              <Share2 className="h-4 w-4 mr-2" />
              Compartilhar via...
            </Button>
          )}
        </div>
      </DialogContent>

      {/* DM Share Modal */}
      <ShareViaDMModal
        open={showDMModal}
        onClose={() => setShowDMModal(false)}
        contentId={contentId}
        contentTitle={contentTitle}
        contentThumbnail={contentThumbnail}
        creatorName={creatorName}
        onShared={() => recordRewardableShare("direct_message")}
      />
    </Dialog>
  );
}
