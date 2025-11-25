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

      // Check if conversation already exists
      const { data: existingParticipants, error: checkError } = await supabase
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", user.id);

      if (checkError) throw checkError;

      if (existingParticipants && existingParticipants.length > 0) {
        // Check if any of these conversations has the recipient
        const conversationIds = existingParticipants.map(p => p.conversation_id);
        
        const { data: recipientParticipants, error: recipientError } = await supabase
          .from("conversation_participants")
          .select("conversation_id")
          .eq("user_id", recipientId)
          .in("conversation_id", conversationIds);

        if (recipientError) throw recipientError;

        if (recipientParticipants && recipientParticipants.length > 0) {
          // Conversation already exists
          onConversationCreated(recipientParticipants[0].conversation_id);
          onClose();
          return;
        }
      }

      // Create new conversation
      const { data: conversation, error: convError } = await supabase
        .from("conversations")
        .insert({})
        .select()
        .single();

      if (convError) throw convError;

      // Add participants
      const { error: participantsError } = await supabase
        .from("conversation_participants")
        .insert([
          { conversation_id: conversation.id, user_id: user.id },
          { conversation_id: conversation.id, user_id: recipientId },
        ]);

      if (participantsError) throw participantsError;

      onConversationCreated(conversation.id);
      onClose();
      
      toast({
        title: "Conversa criada",
        description: "Você pode começar a conversar agora!",
      });
    } catch (error) {
      console.error("Error creating conversation:", error);
      toast({
        title: "Erro",
        description: "Não foi possível criar a conversa.",
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
      <DialogContent className="sm:max-w-md">
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
