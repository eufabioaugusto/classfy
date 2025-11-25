import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface MessageRequestBannerProps {
  conversationId: string;
  senderName: string;
  onResponse: () => void;
}

export const MessageRequestBanner = ({
  conversationId,
  senderName,
  onResponse,
}: MessageRequestBannerProps) => {
  const { toast } = useToast();

  const handleResponse = async (approved: boolean) => {
    try {
      const { error } = await supabase.rpc("respond_message_request", {
        p_conversation_id: conversationId,
        p_approved: approved,
      });

      if (error) throw error;

      toast({
        title: approved ? "Solicitação aprovada" : "Solicitação recusada",
        description: approved
          ? "Você pode conversar livremente agora"
          : "A solicitação foi recusada",
      });

      onResponse();
    } catch (error) {
      console.error("Error responding to request:", error);
      toast({
        title: "Erro",
        description: "Não foi possível processar a solicitação",
        variant: "destructive",
      });
    }
  };

  return (
    <Alert className="mb-4">
      <AlertDescription>
        <div className="flex items-center justify-between">
          <span className="text-sm">
            <strong>{senderName}</strong> quer enviar mensagens para você
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleResponse(false)}
            >
              <X className="h-4 w-4 mr-1" />
              Recusar
            </Button>
            <Button
              size="sm"
              onClick={() => handleResponse(true)}
            >
              <Check className="h-4 w-4 mr-1" />
              Aprovar
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
};
