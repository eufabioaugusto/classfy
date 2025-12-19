import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, ArrowLeft, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConversationList } from "@/components/direct-messages/ConversationList";
import { MessageThread } from "@/components/direct-messages/MessageThread";
import { MessageSettingsModal } from "@/components/direct-messages/MessageSettingsModal";
import { useAuth } from "@/contexts/AuthContext";
import { GlobalLoader } from "@/components/GlobalLoader";

export default function Messages() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);

  if (loading) return <GlobalLoader />;
  
  if (!user) {
    navigate("/auth");
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background pb-20 md:pb-0">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="md:hidden">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">Mensagens</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)}>
          <Settings className="h-5 w-5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Mobile: Show either list or thread */}
        <div className={`w-full md:w-96 md:border-r flex flex-col ${selectedConversationId ? 'hidden md:flex' : 'flex'}`}>
          <ConversationList
            selectedConversationId={selectedConversationId}
            onSelectConversation={setSelectedConversationId}
            onConversationsChange={setConversations}
          />
        </div>

        {/* Message Thread - Full width on mobile when selected */}
        <div className={`flex-1 flex flex-col ${selectedConversationId ? 'flex' : 'hidden md:flex'}`}>
          {selectedConversationId ? (
            <MessageThread
              conversationId={selectedConversationId}
              onClose={() => setSelectedConversationId(null)}
              isArchived={conversations.find(c => c.id === selectedConversationId)?.is_archived}
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

      <MessageSettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}
