import { useEffect, useState } from "react";
import { X, Settings, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConversationList } from "@/components/direct-messages/ConversationList";
import { MessageThread } from "@/components/direct-messages/MessageThread";
import { MessageSettingsModal } from "@/components/direct-messages/MessageSettingsModal";
import { useAuth } from "@/contexts/AuthContext";

interface DirectMessagesModalProps {
  open: boolean;
  onClose: () => void;
  initialRecipientId?: string;
}

export const DirectMessagesModal = ({ open, onClose, initialRecipientId }: DirectMessagesModalProps) => {
  const { user } = useAuth();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [open]);

  if (!open || !user) return null;

  return (
    <>
      <div className="fixed inset-0 bg-background z-[100] flex flex-col">
        {/* Header */}
        <div className="border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
            <h2 className="text-lg font-semibold">Mensagens</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)}>
            <Settings className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Conversations List */}
          <div className="w-full md:w-96 border-r flex flex-col">
            <ConversationList
              selectedConversationId={selectedConversationId}
              onSelectConversation={setSelectedConversationId}
              initialRecipientId={initialRecipientId}
            />
          </div>

          {/* Message Thread */}
          <div className="flex-1 hidden md:flex flex-col">
            {selectedConversationId ? (
              <MessageThread
                conversationId={selectedConversationId}
                onClose={() => setSelectedConversationId(null)}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageCircle className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <p className="text-lg">Selecione uma conversa</p>
                  <p className="text-sm">Escolha uma conversa da lista para começar</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <MessageSettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
};
