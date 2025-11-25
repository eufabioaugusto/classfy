import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Hook to count unread messages for the current user
 */
export function useUnreadMessages() {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    const fetchUnreadCount = async () => {
      try {
        // Get all conversations where user is a participant
        const { data: participations } = await supabase
          .from("conversation_participants")
          .select("conversation_id, last_read_at")
          .eq("user_id", user.id);

        if (!participations || participations.length === 0) {
          setUnreadCount(0);
          return;
        }

        let totalUnread = 0;

        // For each conversation, count messages after last_read_at
        for (const participation of participations) {
          const { count } = await supabase
            .from("messages")
            .select("*", { count: "exact", head: true })
            .eq("conversation_id", participation.conversation_id)
            .neq("sender_id", user.id) // Don't count own messages
            .gt(
              "created_at",
              participation.last_read_at || "1970-01-01T00:00:00.000Z"
            );

          totalUnread += count || 0;
        }

        setUnreadCount(totalUnread);
      } catch (error) {
        console.error("Error fetching unread count:", error);
      }
    };

    fetchUnreadCount();

    // Subscribe to new messages
    const channel = supabase
      .channel(`unread-messages-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        () => {
          fetchUnreadCount();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_participants",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return unreadCount;
}
