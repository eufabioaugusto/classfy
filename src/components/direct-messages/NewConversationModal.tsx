import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface NewConversationModalProps {
  open: boolean;
  onClose: () => void;
  onConversationCreated: (conversationId: string) => void;
  initialRecipientId?: string;
}

interface User {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export const NewConversationModal = ({
  open,
  onClose,
  onConversationCreated,
  initialRecipientId,
}: NewConversationModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      loadUsers();
    }
  }, [open, searchQuery]);

  const loadUsers = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .neq("id", user.id)
        .ilike("display_name", `%${searchQuery}%`)
        .limit(20);

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error("Error loading users:", error);
    } finally {
      setLoading(false);
    }
  };

  const createConversation = async (recipientId: string) => {
    if (!user || creating) return;

    try {
      setCreating(true);
      console.log("Starting conversation creation with recipient:", recipientId);

      // Check if user is blocked
      const { data: blockData } = await supabase
        .from("blocked_users")
        .select("id")
        .eq("blocked_id", user.id)
        .eq("blocker_id", recipientId)
        .maybeSingle();

      if (blockData) {
        toast({
          title: "Não é possível enviar mensagem",
          description: "Este usuário bloqueou você.",
          variant: "destructive",
        });
        setCreating(false);
        return;
      }

      // Check recipient's privacy settings
      const { data: recipientSettings } = await supabase
        .from("message_settings")
        .select("privacy_mode")
        .eq("user_id", recipientId)
        .maybeSingle();

      const privacyMode = recipientSettings?.privacy_mode || 'open';
      console.log("Recipient privacy mode:", privacyMode);

      // If privacy is closed, block the message
      if (privacyMode === 'closed') {
        toast({
          title: "Mensagens bloqueadas",
          description: "Este usuário não está aceitando mensagens no momento.",
          variant: "destructive",
        });
        setCreating(false);
        return;
      }

      // If privacy is 'followers', check if user follows recipient
      if (privacyMode === 'followers') {
        const { data: followData } = await supabase
          .from("follows")
          .select("id")
          .eq("follower_id", user.id)
          .eq("following_id", recipientId)
          .maybeSingle();

        if (!followData) {
          toast({
            title: "Permissão necessária",
            description: "Você precisa seguir este usuário para enviar mensagens.",
            variant: "destructive",
          });
          setCreating(false);
          return;
        }
      }

      // Check if conversation already exists
      const { data: existingParticipants, error: checkError } = await supabase
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", user.id);

      if (checkError) {
        console.error("Error checking existing participants:", checkError);
        throw checkError;
      }

      console.log("Existing participants:", existingParticipants);

      if (existingParticipants && existingParticipants.length > 0) {
        // Check if any of these conversations has the recipient
        const conversationIds = existingParticipants.map(p => p.conversation_id);
        
        const { data: recipientParticipants, error: recipientError } = await supabase
          .from("conversation_participants")
          .select("conversation_id")
          .eq("user_id", recipientId)
          .in("conversation_id", conversationIds);

        if (recipientError) {
          console.error("Error checking recipient participants:", recipientError);
          throw recipientError;
        }

        console.log("Recipient participants:", recipientParticipants);

        if (recipientParticipants && recipientParticipants.length > 0) {
          // Conversation already exists
          console.log("Conversation already exists, using:", recipientParticipants[0].conversation_id);
          onConversationCreated(recipientParticipants[0].conversation_id);
          onClose();
          return;
        }
      }

      // Create or get conversation using backend helper to avoid RLS issues
      console.log("Creating or getting conversation via RPC...");
      const { data: conversationId, error: convError } = await supabase
        .rpc("create_or_get_conversation", {
          p_user1_id: user.id,
          p_user2_id: recipientId,
        });

      if (convError || !conversationId) {
        console.error("Error creating/getting conversation via RPC:", convError);
        throw convError || new Error("Falha ao criar conversa");
      }

      console.log("Conversation id from RPC:", conversationId);

      // Garante que sua participação não esteja mutada/arquivada (caso tenha excluído antes)
      await supabase
        .from("conversation_participants")
        .update({ is_muted: false, is_archived: false })
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id);

      // If privacy mode is 'request', mark first message as request
      const isRequest = privacyMode === 'request';
      
      onConversationCreated(conversationId as string);
      onClose();
      
      toast({
        title: isRequest ? "Solicitação enviada" : "Conversa criada",
        description: isRequest 
          ? "Sua solicitação foi enviada. Aguarde aprovação do destinatário."
          : "Você pode começar a conversar agora!",
      });
    } catch (error: any) {
      console.error("Error creating conversation - Full details:", {
        error,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code
      });
      
      const errorMessage = error?.message || "Não foi possível criar a conversa.";
      toast({
        title: "Erro",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (open && initialRecipientId) {
      createConversation(initialRecipientId);
    }
  }, [open, initialRecipientId]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md z-[60]">
        <DialogHeader>
          <DialogTitle>Nova mensagem</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Pesquisar usuários..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <ScrollArea className="h-[400px]">
            <div className="space-y-1">
              {loading ? (
                <div className="p-4 text-center text-muted-foreground">
                  Carregando...
                </div>
              ) : users.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  <p className="text-sm">Nenhum usuário encontrado</p>
                </div>
              ) : (
                users.map((targetUser) => (
                  <button
                    key={targetUser.id}
                    onClick={() => createConversation(targetUser.id)}
                    disabled={creating}
                    className="w-full p-3 rounded-lg flex items-center gap-3 hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={targetUser.avatar_url || undefined} />
                      <AvatarFallback>
                        {targetUser.display_name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 text-left">
                      <span className="font-medium text-sm">
                        {targetUser.display_name}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};
