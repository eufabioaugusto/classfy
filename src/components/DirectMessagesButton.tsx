import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DirectMessagesModal } from "@/components/DirectMessagesModal";
import { useEffect } from "react";

interface DirectMessagesButtonProps {
  unreadCount?: number;
}

export const DirectMessagesButton = ({ unreadCount = 0 }: DirectMessagesButtonProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [recipientId, setRecipientId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const handleOpenDM = (event: CustomEvent) => {
      setRecipientId(event.detail.recipientId);
      setIsOpen(true);
    };

    window.addEventListener('openDirectMessage' as any, handleOpenDM);
    return () => {
      window.removeEventListener('openDirectMessage' as any, handleOpenDM);
    };
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => setIsOpen(true)}
      >
        <MessageCircle className="h-5 w-5" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </Button>

      <DirectMessagesModal 
        open={isOpen} 
        onClose={() => {
          setIsOpen(false);
          setRecipientId(undefined);
        }}
        initialRecipientId={recipientId}
      />
    </>
  );
};
