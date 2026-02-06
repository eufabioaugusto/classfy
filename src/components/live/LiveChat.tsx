import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Send, Pin, Trash2, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveMessage, LiveGift } from "@/hooks/useLiveChat";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LiveChatProps {
  messages: LiveMessage[];
  pinnedMessage: LiveMessage | null;
  isLoading: boolean;
  isSending: boolean;
  onSendMessage: (content: string) => Promise<void>;
  onDeleteMessage?: (messageId: string) => Promise<void>;
  onPinMessage?: (messageId: string) => Promise<void>;
  onUnpinMessage?: () => Promise<void>;
  isCreator?: boolean;
  className?: string;
}

export function LiveChat({
  messages,
  pinnedMessage,
  isLoading,
  isSending,
  onSendMessage,
  onDeleteMessage,
  onPinMessage,
  onUnpinMessage,
  isCreator = false,
  className,
}: LiveChatProps) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!message.trim() || isSending) return;
    
    const content = message;
    setMessage("");
    
    try {
      await onSendMessage(content);
    } catch (error) {
      setMessage(content); // Restore on error
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getMessageColor = (type: LiveMessage["type"]) => {
    switch (type) {
      case "gift":
        return "bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30";
      case "system":
        return "bg-blue-500/10 text-blue-400 italic";
      case "pinned":
        return "bg-accent/10 border border-accent/30";
      default:
        return "";
    }
  };

  return (
    <div className={cn("flex flex-col h-full bg-card rounded-lg", className)}>
      {/* Header */}
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm">Chat ao Vivo</h3>
      </div>
      
      {/* Pinned Message */}
      {pinnedMessage && (
        <div className="p-2 bg-accent/10 border-b border-accent/20 flex items-start gap-2">
          <Pin className="w-3 h-3 text-accent mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-accent">
              {pinnedMessage.user?.display_name || "Anônimo"}:
            </span>
            <p className="text-xs text-muted-foreground truncate">
              {pinnedMessage.content}
            </p>
          </div>
          {isCreator && onUnpinMessage && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={onUnpinMessage}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      )}
      
      {/* Messages */}
      <ScrollArea className="flex-1 p-3" ref={scrollRef as any}>
        <div className="space-y-2">
          {isLoading ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              Carregando chat...
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              Seja o primeiro a enviar uma mensagem!
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "group flex items-start gap-2 py-1 px-2 rounded-lg transition-colors hover:bg-secondary/50",
                  getMessageColor(msg.type)
                )}
              >
                <Avatar className="h-6 w-6 flex-shrink-0">
                  <AvatarImage src={msg.user?.avatar_url || ""} />
                  <AvatarFallback className="text-[10px]">
                    {msg.user?.display_name?.charAt(0) || "?"}
                  </AvatarFallback>
                </Avatar>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      "text-xs font-medium",
                      msg.type === "gift" && "text-yellow-500"
                    )}>
                      {msg.user?.display_name || "Anônimo"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(msg.created_at), {
                        addSuffix: false,
                        locale: ptBR,
                      })}
                    </span>
                  </div>
                  <p className={cn(
                    "text-sm break-words",
                    msg.type === "system" && "italic text-muted-foreground"
                  )}>
                    {msg.type === "gift" && (
                      <span className="mr-1">🎁</span>
                    )}
                    {msg.content}
                  </p>
                </div>
                
                {/* Actions */}
                {(isCreator || msg.user_id === user?.id) && (onDeleteMessage || onPinMessage) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isCreator && onPinMessage && msg.type === "text" && (
                        <DropdownMenuItem onClick={() => onPinMessage(msg.id)}>
                          <Pin className="w-3 h-3 mr-2" />
                          Fixar
                        </DropdownMenuItem>
                      )}
                      {onDeleteMessage && (msg.user_id === user?.id || isCreator) && (
                        <DropdownMenuItem
                          onClick={() => onDeleteMessage(msg.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="w-3 h-3 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      
      {/* Input */}
      <div className="p-3 border-t">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Envie uma mensagem..."
            className="text-sm"
            disabled={isSending || !user}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!message.trim() || isSending || !user}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        {!user && (
          <p className="text-xs text-muted-foreground mt-1">
            Faça login para participar do chat
          </p>
        )}
      </div>
    </div>
  );
}
