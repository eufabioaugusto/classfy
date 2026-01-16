import { useEffect, useState, useRef } from "react";
import { ArrowLeft, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MessageInput } from "./MessageInput";
import { MessageContextMenu } from "./MessageContextMenu";
import { MessageRequestBanner } from "./MessageRequestBanner";
import { ContentMessageCard, isContentShareMessage } from "./ContentMessageCard";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface Message {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  is_request: boolean;
  request_status: string | null;
}

interface MessageThreadProps {
  conversationId: string;
  onClose: () => void;
  isArchived?: boolean;
}

export const MessageThread = ({ conversationId, onClose, isArchived = false }: MessageThreadProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockReason, setBlockReason] = useState<'closed' | 'not_follower' | 'pending_request'>();
  const [isFollowing, setIsFollowing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conversationId && user) {
      loadMessages();
      loadOtherUser();
      markAsRead();
      setupRealtimeSubscription();
      checkMessagePermissions();
    }
  }, [conversationId, user]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error("Error loading messages:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadOtherUser = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("conversation_participants")
        .select(`
          profiles!inner (
            id,
            display_name,
            avatar_url
          )
        `)
        .eq("conversation_id", conversationId)
        .neq("user_id", user.id)
        .single();

      if (error) throw error;
      setOtherUser(data?.profiles);
    } catch (error) {
      console.error("Error loading other user:", error);
    }
  };

  const markAsRead = async () => {
    if (!user) return;

    try {
      await supabase
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id);
    } catch (error) {
      console.error("Error marking as read:", error);
    }
  };

  const setupRealtimeSubscription = () => {
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((current) => [...current, payload.new as Message]);
          markAsRead();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const checkMessagePermissions = async () => {
    if (!user || !otherUser) return;

    try {
      // Revalida sempre que o usuário destino mudar
      console.log("Checking message permissions for", otherUser.id);

      // Check if user is blocked
      const { data: blockData } = await supabase
        .from("blocked_users")
        .select("id")
        .eq("blocked_id", user.id)
        .eq("blocker_id", otherUser.id)
        .maybeSingle();

      if (blockData) {
        setIsBlocked(true);
        setBlockReason('closed');
        return;
      }

      // Check recipient's privacy settings
      const { data: settings } = await supabase
        .from("message_settings")
        .select("privacy_mode")
        .eq("user_id", otherUser.id)
        .maybeSingle();

      const privacyMode = settings?.privacy_mode || 'open';

      if (privacyMode === 'closed') {
        setIsBlocked(true);
        setBlockReason('closed');
        return;
      }

      if (privacyMode === 'followers') {
        const { data: followData } = await supabase
          .from("follows")
          .select("id")
          .eq("follower_id", user.id)
          .eq("following_id", otherUser.id)
          .maybeSingle();

        if (!followData) {
          setIsBlocked(true);
          setBlockReason('not_follower');
          return;
        }
        setIsFollowing(true);
      }

      // privacy_mode === 'request': não bloqueia o envio, apenas marca a
      // primeira mensagem como solicitação visual para o destinatário.

      setIsBlocked(false);
    } catch (error) {
      console.error("Error checking permissions:", error);
    }
  };

  const handleFollow = async () => {
    if (!user || !otherUser) return;

    try {
      const { error } = await supabase
        .from("follows")
        .insert({
          follower_id: user.id,
          following_id: otherUser.id,
        });

      if (error) throw error;

      toast({
        title: "Seguindo",
        description: `Agora você segue ${otherUser.display_name}`,
      });

      setIsFollowing(true);
      checkMessagePermissions();
    } catch (error) {
      console.error("Error following user:", error);
      toast({
        title: "Erro",
        description: "Não foi possível seguir o usuário",
        variant: "destructive",
      });
    }
  };

  const handleDeleteConversation = async () => {
    if (!user) return;

    try {
      // Deleta a conversa COMPLETAMENTE no backend (mensagens, participantes, conversa)
      const { error } = await supabase.rpc("delete_conversation_for_user", {
        p_conversation_id: conversationId,
        p_user_id: user.id,
      });

      if (error) throw error;

      toast({
        title: "Conversa excluída",
        description:
          "A conversa foi apagada completamente. Se alguém te mandar mensagem de novo, será uma nova solicitação.",
      });

      window.dispatchEvent(new CustomEvent("dm-conversations-changed"));
      onClose();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      toast({
        title: "Erro",
        description: "Não foi possível excluir a conversa",
        variant: "destructive",
      });
    }
  };
  const handleArchiveConversation = async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("conversation_participants")
        .update({ is_archived: true })
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id);

      if (error) throw error;

      toast({
        title: "Conversa arquivada",
        description: "A conversa foi movida para arquivados",
      });

      // Notifica a lista para recarregar imediatamente
      window.dispatchEvent(new CustomEvent("dm-conversations-changed"));

      onClose();
    } catch (error) {
      console.error("Error archiving conversation:", error);
      toast({
        title: "Erro",
        description: "Não foi possível arquivar a conversa",
        variant: "destructive",
      });
    }
  };

  const handleUnarchiveConversation = async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("conversation_participants")
        .update({ is_archived: false })
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id);

      if (error) throw error;

      toast({
        title: "Conversa desarquivada",
        description: "A conversa foi movida para Principal",
      });

      window.dispatchEvent(new CustomEvent("dm-conversations-changed"));

      onClose();
    } catch (error) {
      console.error("Error unarchiving conversation:", error);
      toast({
        title: "Erro",
        description: "Não foi possível desarquivar a conversa",
        variant: "destructive",
      });
    }
  };

  const handleBlockUser = async () => {
    if (!user || !otherUser) return;

    try {
      const { error } = await supabase
        .from("blocked_users")
        .insert({
          blocker_id: user.id,
          blocked_id: otherUser.id,
        });

      if (error) throw error;

      toast({
        title: "Usuário bloqueado",
        description: `${otherUser.display_name} foi bloqueado e não poderá mais enviar mensagens`,
      });

      onClose();
    } catch (error) {
      console.error("Error blocking user:", error);
      toast({
        title: "Erro",
        description: "Não foi possível bloquear o usuário",
        variant: "destructive",
      });
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!user || !otherUser) return;

    try {
      // Check if user is blocked pelo outro usuário
      const { data: blockData } = await supabase
        .from("blocked_users")
        .select("id")
        .eq("blocked_id", user.id)
        .eq("blocker_id", otherUser.id)
        .maybeSingle();

      if (blockData) {
        toast({
          title: "Bloqueado",
          description: "Você foi bloqueado por este usuário",
          variant: "destructive",
        });
        return;
      }

      // Unmute recipient if they deleted the conversation (is_muted = true)
      // This ensures the conversation appears in their list when a new message arrives
      await supabase
        .from("conversation_participants")
        .update({ is_muted: false, is_archived: false })
        .eq("conversation_id", conversationId)
        .eq("user_id", otherUser.id);

      // Privacidade do destinatário
      const { data: settings } = await supabase
        .from("message_settings")
        .select("privacy_mode")
        .eq("user_id", otherUser.id)
        .maybeSingle();

      const privacyMode = settings?.privacy_mode || "open";

      if (privacyMode === "closed") {
        toast({
          title: "Mensagens bloqueadas",
          description: "Este usuário não está aceitando mensagens.",
          variant: "destructive",
        });
        return;
      }

      if (privacyMode === "followers") {
        const { data: followData } = await supabase
          .from("follows")
          .select("id")
          .eq("follower_id", user.id)
          .eq("following_id", otherUser.id)
          .maybeSingle();

        if (!followData) {
          toast({
            title: "Permissão necessária",
            description: "Você precisa seguir este usuário para enviar mensagens.",
            variant: "destructive",
          });
          return;
        }
      }

      let isRequest = false;
      let requestStatus: string | null = null;

      if (privacyMode === "request") {
        // Verifica se já existe solicitação pendente deste remetente nesta conversa
        const { data: existingRequests, error: existingError } = await supabase
          .from("messages")
          .select("request_status")
          .eq("conversation_id", conversationId)
          .eq("sender_id", user.id)
          .eq("is_request", true);

        if (existingError) throw existingError;

        const hasPending = existingRequests?.some(
          (m) => !m.request_status || m.request_status === "pending"
        );

        if (hasPending) {
          toast({
            title: "Solicitação já enviada",
            description:
              "Você já tem uma solicitação pendente. Aguarde a aprovação do destinatário.",
            variant: "destructive",
          });
          return;
        }

        const hasApproved = existingRequests?.some(
          (m) => m.request_status === "approved"
        );

        // Se nunca teve aprovação, a próxima mensagem vira solicitação pendente
        if (!hasApproved) {
          isRequest = true;
          requestStatus = "pending";

          toast({
            title: "Solicitação enviada",
            description:
              "Sua solicitação foi enviada. Aguarde aprovação do destinatário.",
          });
        }
      }

      const { error } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content,
        is_request: isRequest,
        request_status: requestStatus,
      });

      if (error) throw error;
    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onClose}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {otherUser && (
          <>
            <Avatar className="h-10 w-10">
              <AvatarImage src={otherUser.avatar_url || undefined} />
              <AvatarFallback>
                {otherUser.display_name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h3 className="font-semibold">{otherUser.display_name}</h3>
            </div>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[60]">
            {isArchived ? (
              <DropdownMenuItem onClick={handleUnarchiveConversation}>
                Desarquivar conversa
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={handleArchiveConversation}>
                Arquivar conversa
              </DropdownMenuItem>
            )}
            <DropdownMenuItem 
              className="text-destructive"
              onClick={() => setShowBlockDialog(true)}
            >
              Bloquear usuário
            </DropdownMenuItem>
            <DropdownMenuItem 
              className="text-destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              Excluir conversa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {/* Request Banner */}
          {messages.some(m =>
            m.is_request &&
            (m.request_status === "pending" || !m.request_status) &&
            m.sender_id !== user?.id
          ) && (
            <MessageRequestBanner
              conversationId={conversationId}
              senderName={otherUser?.display_name || "Usuário"}
              onResponse={() => {
                loadMessages();
                checkMessagePermissions();
              }}
            />
          )}

          {messages.map((message) => {
            const isOwn = message.sender_id === user?.id;
            const contentShareData = isContentShareMessage(message.content);
            
            return (
              <MessageContextMenu
                key={message.id}
                messageId={message.id}
                content={message.content}
                isOwn={isOwn}
                senderId={message.sender_id}
                onDelete={loadMessages}
              >
                <div
                  className={`flex gap-2 ${isOwn ? "flex-row-reverse" : "flex-row"}`}
                >
                  {contentShareData ? (
                    // Content Share Card
                    <div className="max-w-[80%]">
                      <ContentMessageCard data={contentShareData} isOwn={isOwn} />
                      <p
                        className={`text-xs mt-1 ${
                          isOwn ? "text-right text-muted-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {formatDistanceToNow(new Date(message.created_at), {
                          locale: ptBR,
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  ) : (
                    // Regular text message
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                        isOwn
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="text-sm break-words">{message.content}</p>
                      <p
                        className={`text-xs mt-1 ${
                          isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
                        }`}
                      >
                        {formatDistanceToNow(new Date(message.created_at), {
                          locale: ptBR,
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  )}
                </div>
              </MessageContextMenu>
            );
          })}
        </div>
      </ScrollArea>

      {/* Input */}
      <MessageInput 
        onSendMessage={handleSendMessage}
        isBlocked={isBlocked}
        blockReason={blockReason}
        otherUserId={otherUser?.id}
        onFollow={handleFollow}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Todas as mensagens serão permanentemente excluídas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConversation} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Block User Confirmation Dialog */}
      <AlertDialog open={showBlockDialog} onOpenChange={setShowBlockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear {otherUser?.display_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Este usuário não poderá mais enviar mensagens para você. Você pode desbloquear nas configurações de mensagens.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleBlockUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Bloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
