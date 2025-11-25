import { useEffect, useState } from "react";
import { Search, Edit } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NewConversationModal } from "./NewConversationModal";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Conversation {
  id: string;
  last_message_at: string;
  is_archived: boolean;
  other_user: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
  last_message?: {
    content: string;
    sender_id: string;
    created_at: string;
  };
  unread_count: number;
}

interface ConversationListProps {
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  initialRecipientId?: string;
  onConversationsChange?: (conversations: Conversation[]) => void;
}

export const ConversationList = ({
  selectedConversationId,
  onSelectConversation,
  initialRecipientId,
  onConversationsChange,
}: ConversationListProps) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [activeTab, setActiveTab] = useState<"inbox" | "archived">("inbox");

  useEffect(() => {
    if (user) {
      loadConversations();
      setupRealtimeSubscription();

      const handleExternalChange = () => {
        loadConversations();
      };

      window.addEventListener("dm-conversations-changed", handleExternalChange);

      return () => {
        window.removeEventListener("dm-conversations-changed", handleExternalChange);
      };
    }
  }, [user]);

  useEffect(() => {
    if (initialRecipientId) {
      setShowNewConversation(true);
    }
  }, [initialRecipientId]);

  const loadConversations = async () => {
    if (!user) return;

    try {
      setLoading(true);
      
      // Get conversations user is part of (exclude archived)
      const { data: participants, error: participantsError } = await supabase
        .from("conversation_participants")
        .select(`
          conversation_id,
          last_read_at,
          is_archived,
          is_muted,
          conversations!inner (
            id,
            last_message_at,
            updated_at
          )
        `)
        .eq("user_id", user.id);

      if (participantsError) throw participantsError;

      if (!participants || participants.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }

      const visibleParticipants = (participants || []).filter(p => !p.is_muted);
      const conversationIds = visibleParticipants.map(p => p.conversation_id);

      // Get other participants
      const { data: otherParticipants, error: otherError } = await supabase
        .from("conversation_participants")
        .select(`
          conversation_id,
          profiles!inner (
            id,
            display_name,
            avatar_url
          )
        `)
        .in("conversation_id", conversationIds)
        .neq("user_id", user.id);

      if (otherError) throw otherError;

      // Get last messages
      const { data: messages, error: messagesError } = await supabase
        .from("messages")
        .select("conversation_id, content, sender_id, created_at")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false });

      if (messagesError) throw messagesError;

      // Build conversations
      const conversationsData: Conversation[] = (participants || []).map(p => {
        const otherUser = otherParticipants?.find(op => op.conversation_id === p.conversation_id);
        const lastMessage = messages?.find(m => m.conversation_id === p.conversation_id);
        const unreadMessages = messages?.filter(
          m => m.conversation_id === p.conversation_id && 
          m.sender_id !== user.id &&
          new Date(m.created_at) > new Date(p.last_read_at || 0)
        ) || [];

        return {
          id: p.conversation_id,
          last_message_at: p.conversations.last_message_at || p.conversations.updated_at,
          is_archived: p.is_archived,
          other_user: {
            id: otherUser?.profiles.id || "",
            display_name: otherUser?.profiles.display_name || "Usuário",
            avatar_url: otherUser?.profiles.avatar_url || null,
          },
          last_message: lastMessage ? {
            content: lastMessage.content,
            sender_id: lastMessage.sender_id,
            created_at: lastMessage.created_at,
          } : undefined,
          unread_count: unreadMessages.length,
        };
      });

      // Sort by last message
      conversationsData.sort((a, b) => 
        new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      );

      setConversations(conversationsData);
      onConversationsChange?.(conversationsData);
    } catch (error) {
      console.error("Error loading conversations:", error);
    } finally {
      setLoading(false);
    }
  };

  const setupRealtimeSubscription = () => {
    const channel = supabase
      .channel("conversations-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
        },
        () => {
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const filteredConversations = conversations
    .filter(conv => (activeTab === "inbox" ? !conv.is_archived : conv.is_archived))
    .filter(conv =>
      conv.other_user.display_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

  return (
    <>
      <div className="p-3 space-y-3">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full mb-2">
          <TabsList className="w-full">
            <TabsTrigger value="inbox" className="flex-1">Principal</TabsTrigger>
            <TabsTrigger value="archived" className="flex-1">Arquivados</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => setShowNewConversation(true)}
        >
          <Edit className="h-4 w-4" />
          Nova mensagem
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-1 px-2">
          {loading ? (
            <div className="p-4 text-center text-muted-foreground">
              Carregando...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <p className="text-sm">Nenhuma conversa ainda</p>
              <p className="text-xs mt-1">Comece uma nova conversa</p>
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`w-full p-3 rounded-lg flex items-center gap-3 hover:bg-accent transition-colors ${
                  selectedConversationId === conv.id ? "bg-accent" : ""
                }`}
              >
                <Avatar className="h-12 w-12">
                  <AvatarImage src={conv.other_user.avatar_url || undefined} />
                  <AvatarFallback>
                    {conv.other_user.display_name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm truncate">
                      {conv.other_user.display_name}
                    </span>
                    {conv.last_message && (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(conv.last_message.created_at), {
                          locale: ptBR,
                          addSuffix: false,
                        })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground truncate">
                      {conv.last_message ? (
                        <>
                          {conv.last_message.sender_id === user?.id && "Você: "}
                          {conv.last_message.content}
                        </>
                      ) : (
                        "Sem mensagens"
                      )}
                    </p>
                    {conv.unread_count > 0 && (
                      <Badge variant="default" className="ml-2 h-5 w-5 flex items-center justify-center p-0 text-xs">
                        {conv.unread_count}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      <NewConversationModal
        open={showNewConversation}
        onClose={() => setShowNewConversation(false)}
        onConversationCreated={onSelectConversation}
        initialRecipientId={initialRecipientId}
      />
    </>
  );
};
