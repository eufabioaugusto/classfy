import { useState, useRef } from "react";
import { Send, Image, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, UserPlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import EmojiPicker, { EmojiClickData } from "emoji-picker-react";

interface MessageInputProps {
  onSendMessage: (content: string) => Promise<void>;
  isBlocked?: boolean;
  blockReason?: 'closed' | 'not_follower' | 'pending_request';
  otherUserId?: string;
  onFollow?: () => Promise<void>;
}

export const MessageInput = ({ 
  onSendMessage, 
  isBlocked = false, 
  blockReason,
  onFollow 
}: MessageInputProps) => {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    if (!message.trim() || sending) return;

    try {
      setSending(true);
      await onSendMessage(message.trim());
      setMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    const emoji = emojiData.emoji;
    const textarea = textareaRef.current;
    
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newMessage = message.substring(0, start) + emoji + message.substring(end);
      setMessage(newMessage);
      
      // Set cursor position after emoji
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
        textarea.focus();
      }, 0);
    } else {
      setMessage(message + emoji);
    }
    
    setShowEmojiPicker(false);
  };

  if (isBlocked) {
    return (
      <div className="border-t p-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              {blockReason === 'closed' && "Este usuário não está aceitando mensagens."}
              {blockReason === 'not_follower' && "Você precisa seguir este usuário para enviar mensagens."}
              {blockReason === 'pending_request' && "Aguardando aprovação do usuário para continuar."}
            </span>
            {blockReason === 'not_follower' && onFollow && (
              <Button size="sm" onClick={onFollow} className="ml-2">
                <UserPlus className="h-4 w-4 mr-1" />
                Seguir
              </Button>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="border-t p-4">
      <div className="flex items-end gap-2">
        <Button variant="ghost" size="icon" className="shrink-0">
          <Image className="h-5 w-5" />
        </Button>
        
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            placeholder="Mensagem..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[44px] max-h-32 resize-none pr-10"
            rows={1}
          />
          <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 bottom-1 z-10"
              >
                <Smile className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent 
              side="top" 
              align="end" 
              className="w-full p-0 border-none shadow-lg z-[70] bg-background"
              style={{ width: '350px' }}
            >
              <EmojiPicker
                onEmojiClick={handleEmojiClick}
                width="100%"
                height="400px"
                searchPlaceHolder="Buscar emoji..."
                previewConfig={{ showPreview: false }}
              />
            </PopoverContent>
          </Popover>
        </div>

        <Button
          size="icon"
          onClick={handleSend}
          disabled={!message.trim() || sending}
          className="shrink-0"
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};
