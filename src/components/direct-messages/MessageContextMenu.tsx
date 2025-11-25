import { Copy, Trash2, Ban } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";

interface MessageContextMenuProps {
  messageId: string;
  content: string;
  isOwn: boolean;
  senderId: string;
  children: React.ReactNode;
  onDelete?: () => void;
  onBlock?: () => void;
}

export const MessageContextMenu = ({
  messageId,
  content,
  isOwn,
  senderId,
  children,
  onDelete,
  onBlock,
}: MessageContextMenuProps) => {
  const { toast } = useToast();
  const [showBlockDialog, setShowBlockDialog] = useState(false);

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

  const handleBlock = async () => {
    // TODO: Implement user blocking functionality
    toast({
      title: "Função em desenvolvimento",
      description: "A funcionalidade de bloquear usuário será implementada em breve",
    });
    setShowBlockDialog(false);
    onBlock?.();
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={handleCopy}>
            <Copy className="h-4 w-4 mr-2" />
            Copiar mensagem
          </ContextMenuItem>
          {isOwn && (
            <ContextMenuItem onClick={handleDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Excluir mensagem
            </ContextMenuItem>
          )}
          {!isOwn && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem 
                onClick={() => setShowBlockDialog(true)}
                className="text-destructive"
              >
                <Ban className="h-4 w-4 mr-2" />
                Bloquear usuário
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={showBlockDialog} onOpenChange={setShowBlockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear este usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              Você não receberá mais mensagens desta pessoa e ela não poderá enviar novas mensagens para você.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleBlock} className="bg-destructive text-destructive-foreground">
              Bloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
