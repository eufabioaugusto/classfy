import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

/**
 * Hook to show toast notifications for new messages
 */
export function useMessageNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`message-notifications-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        async (payload) => {
          const message: any = payload.new;

          // Don't show notifications for own messages
          if (message.sender_id === user.id) return;

          // Check if this message is in a conversation where user is participant
          const { data: participation } = await supabase
            .from("conversation_participants")
            .select("*")
            .eq("conversation_id", message.conversation_id)
            .eq("user_id", user.id)
            .maybeSingle();

          if (!participation) return;

      // Get sender info
      const { data: sender } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", message.sender_id)
        .single();

      if (sender) {
        // Força recarregar lista de conversas (coluna) em qualquer lugar aberto
        window.dispatchEvent(new CustomEvent("dm-conversations-changed"));

        toast({
          title: sender.display_name,
          description:
            message.content.length > 50
              ? message.content.substring(0, 50) + "..."
              : message.content,
        });
      }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, toast]);
}
