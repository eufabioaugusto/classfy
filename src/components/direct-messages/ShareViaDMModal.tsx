import { useState, useEffect } from "react";
import { Search, Send, Check, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface ShareViaDMModalProps {
  open: boolean;
  onClose: () => void;
  contentId: string;
  contentTitle: string;
  contentThumbnail?: string;
  contentType?: string;
  creatorName?: string;
}

interface User {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

interface Conversation {
  id: string;
  otherUser: User;
}

export const ShareViaDMModal = ({
  open,
  onClose,
  contentId,
  contentTitle,
  contentThumbnail,
  contentType = "video",
  creatorName,
}: ShareViaDMModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [recentConversations, setRecentConversations] = useState<Conversation[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open && user) {
      loadRecentConversations();
      if (searchQuery) {
        searchUsers();
      }
    }
  }, [open, user, searchQuery]);

  const loadRecentConversations = async () => {
    if (!user) return;

    try {
      setLoading(true);
      
      // Get user's recent conversations
      const { data: participations, error } = await supabase
        .from("conversation_participants")
        .select(`
          conversation_id,
          conversations!inner(last_message_at)
        `)
        .eq("user_id", user.id)
        .eq("is_archived", false)
        .eq("is_muted", false)
        .order("conversations(last_message_at)", { ascending: false })
        .limit(10);

      if (error) throw error;

      if (!participations || participations.length === 0) {
        setRecentConversations([]);
        return;
      }

      const conversationIds = participations.map(p => p.conversation_id);

      // Get other participants for these conversations
      const { data: otherParticipants, error: otherError } = await supabase
        .from("conversation_participants")
        .select(`
          conversation_id,
          profiles!inner(id, display_name, avatar_url)
        `)
        .in("conversation_id", conversationIds)
        .neq("user_id", user.id);

      if (otherError) throw otherError;

      const conversations: Conversation[] = (otherParticipants || []).map((p: any) => ({
        id: p.conversation_id,
        otherUser: {
          id: p.profiles.id,
          display_name: p.profiles.display_name,
          avatar_url: p.profiles.avatar_url,
        },
      }));

      setRecentConversations(conversations);
    } catch (error) {
      console.error("Error loading recent conversations:", error);
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async () => {
    if (!user || !searchQuery.trim()) {
      setUsers([]);
      return;
    }

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
      console.error("Error searching users:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const sendToSelectedUsers = async () => {
    if (!user || selectedUsers.length === 0) return;

    try {
      setSending(true);

      // Create content card message format
      const contentMessage = JSON.stringify({
        type: "content_share",
        contentId,
        contentTitle,
        contentThumbnail,
        contentType,
        creatorName,
        shareUrl: `${window.location.origin}/watch/${contentId}`,
      });

      for (const recipientId of selectedUsers) {
        // Get or create conversation
        const { data: conversationId, error: convError } = await supabase
          .rpc("create_or_get_conversation", {
            p_user1_id: user.id,
            p_user2_id: recipientId,
          });

        if (convError) {
          console.error("Error creating conversation:", convError);
          continue;
        }

        // Ensure participation is active
        await supabase
          .from("conversation_participants")
          .update({ is_muted: false, is_archived: false })
          .eq("conversation_id", conversationId)
          .eq("user_id", user.id);

        // Also ensure recipient's participation is visible
        await supabase
          .from("conversation_participants")
          .update({ is_muted: false, is_archived: false })
          .eq("conversation_id", conversationId)
          .eq("user_id", recipientId);

        // Send the content share message
        const { error: msgError } = await supabase.from("messages").insert({
          conversation_id: conversationId,
          sender_id: user.id,
          content: contentMessage,
        });

        if (msgError) {
          console.error("Error sending message:", msgError);
        }
      }

      toast({
        title: "Enviado!",
        description: `Conteúdo compartilhado com ${selectedUsers.length} pessoa${selectedUsers.length > 1 ? "s" : ""}`,
      });

      setSelectedUsers([]);
      onClose();
    } catch (error) {
      console.error("Error sending content:", error);
      toast({
        title: "Erro",
        description: "Não foi possível enviar o conteúdo",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const displayList = searchQuery.trim() 
    ? users 
    : recentConversations.map(c => c.otherUser);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md z-[60]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Enviar para
          </DialogTitle>
        </DialogHeader>

        {/* Content Preview */}
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
          {contentThumbnail ? (
            <img 
              src={contentThumbnail} 
              alt={contentTitle}
              className="w-16 h-10 object-cover rounded"
            />
          ) : (
            <div className="w-16 h-10 bg-muted rounded flex items-center justify-center">
              <span className="text-xs text-muted-foreground">Video</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{contentTitle}</p>
            {creatorName && (
              <p className="text-xs text-muted-foreground truncate">{creatorName}</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* Selected Users */}
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map(userId => {
                const userInfo = displayList.find(u => u.id === userId) || 
                  recentConversations.find(c => c.otherUser.id === userId)?.otherUser;
                return userInfo ? (
                  <Badge 
                    key={userId} 
                    variant="secondary"
                    className="flex items-center gap-1 py-1"
                  >
                    {userInfo.display_name}
                    <button 
                      onClick={() => toggleUserSelection(userId)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ) : null;
              })}
            </div>
          )}

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Pesquisar usuários..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* User List */}
          <ScrollArea className="h-[300px]">
            <div className="space-y-1">
              {!searchQuery && recentConversations.length > 0 && (
                <p className="text-xs text-muted-foreground px-2 py-1">Conversas recentes</p>
              )}
              
              {loading ? (
                <div className="p-4 text-center text-muted-foreground">
                  Carregando...
                </div>
              ) : displayList.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  <p className="text-sm">
                    {searchQuery ? "Nenhum usuário encontrado" : "Nenhuma conversa recente"}
                  </p>
                </div>
              ) : (
                displayList.map((targetUser) => {
                  const isSelected = selectedUsers.includes(targetUser.id);
                  return (
                    <button
                      key={targetUser.id}
                      onClick={() => toggleUserSelection(targetUser.id)}
                      className={`w-full p-3 rounded-lg flex items-center gap-3 transition-colors ${
                        isSelected 
                          ? "bg-primary/10 border border-primary/30" 
                          : "hover:bg-accent"
                      }`}
                    >
                      <Avatar className="h-10 w-10">
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

                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                        isSelected 
                          ? "bg-primary border-primary text-primary-foreground" 
                          : "border-muted-foreground/30"
                      }`}>
                        {isSelected && <Check className="h-4 w-4" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>

          {/* Send Button */}
          <Button 
            onClick={sendToSelectedUsers}
            disabled={selectedUsers.length === 0 || sending}
            className="w-full"
          >
            <Send className="h-4 w-4 mr-2" />
            {sending 
              ? "Enviando..." 
              : selectedUsers.length > 0 
                ? `Enviar para ${selectedUsers.length} pessoa${selectedUsers.length > 1 ? "s" : ""}`
                : "Selecione pessoas para enviar"
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
