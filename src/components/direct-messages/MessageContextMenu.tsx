import { Copy, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface MessageContextMenuProps {
  messageId: string;
  content: string;
  isOwn: boolean;
  children: React.ReactNode;
  onDelete?: () => void;
}

export const MessageContextMenu = ({
  messageId,
  content,
  isOwn,
  children,
  onDelete,
}: MessageContextMenuProps) => {
  const { toast } = useToast();

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    toast({
      title: "Copiado",
      description: "Mensagem copiada para a área de transferência",
    });
  };

  const handleDelete = async () => {
    if (!isOwn) return;

    try {
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("id", messageId);

      if (error) throw error;

      toast({
        title: "Mensagem excluída",
        description: "A mensagem foi removida da conversa",
      });

      onDelete?.();
    } catch (error) {
      console.error("Error deleting message:", error);
      toast({
        title: "Erro",
        description: "Não foi possível excluir a mensagem",
        variant: "destructive",
      });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleCopy}>
          <Copy className="h-4 w-4 mr-2" />
          Copiar
        </ContextMenuItem>
        {isOwn && (
          <ContextMenuItem onClick={handleDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Excluir
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
