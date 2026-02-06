import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { RealtimeChannel } from "@supabase/supabase-js";

export interface LiveMessage {
  id: string;
  live_id: string;
  user_id: string;
  content: string;
  type: "text" | "gift" | "system" | "pinned";
  gift_id: string | null;
  is_pinned: boolean;
  created_at: string;
  user?: {
    display_name: string;
    avatar_url: string | null;
  };
}

export interface LiveGift {
  id: string;
  name: string;
  icon: string;
  price: number;
  animation_type: string;
  color: string;
}

interface UseLiveChatReturn {
  messages: LiveMessage[];
  pinnedMessage: LiveMessage | null;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  sendGiftMessage: (gift: LiveGift, amount: number) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  pinMessage: (messageId: string) => Promise<void>;
  unpinMessage: () => Promise<void>;
}

export function useLiveChat(liveId: string | null): UseLiveChatReturn {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [pinnedMessage, setPinnedMessage] = useState<LiveMessage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Fetch initial messages
  const fetchMessages = useCallback(async () => {
    if (!liveId) return;
    
    try {
      setIsLoading(true);
      
      const { data, error: fetchError } = await supabase
        .from("live_messages")
        .select(`
          *,
          user:profiles!user_id(display_name, avatar_url)
        `)
        .eq("live_id", liveId)
        .order("created_at", { ascending: true })
        .limit(200);
      
      if (fetchError) throw fetchError;
      
      const formattedMessages = (data || []).map(msg => ({
        ...msg,
        type: msg.type as LiveMessage["type"],
      }));
      
      setMessages(formattedMessages);
      
      // Find pinned message
      const pinned = formattedMessages.find(m => m.is_pinned);
      setPinnedMessage(pinned || null);
    } catch (err: any) {
      console.error("Error fetching messages:", err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [liveId]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!liveId) return;
    
    fetchMessages();
    
    // Set up realtime subscription
    channelRef.current = supabase
      .channel(`live-chat-${liveId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_messages",
          filter: `live_id=eq.${liveId}`,
        },
        async (payload) => {
          // Fetch user info for new message
          const { data: userData } = await supabase
            .from("profiles")
            .select("display_name, avatar_url")
            .eq("id", payload.new.user_id)
            .single();
          
          const newMessage: LiveMessage = {
            ...payload.new as any,
            type: payload.new.type as LiveMessage["type"],
            user: userData || undefined,
          };
          
          setMessages(prev => [...prev, newMessage]);
          
          if (newMessage.is_pinned) {
            setPinnedMessage(newMessage);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "live_messages",
          filter: `live_id=eq.${liveId}`,
        },
        (payload) => {
          setMessages(prev => prev.filter(m => m.id !== payload.old.id));
          
          if (pinnedMessage?.id === payload.old.id) {
            setPinnedMessage(null);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "live_messages",
          filter: `live_id=eq.${liveId}`,
        },
        (payload) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === payload.new.id
                ? { ...m, ...payload.new, type: payload.new.type as LiveMessage["type"] }
                : m
            )
          );
          
          // Handle pin/unpin
          if (payload.new.is_pinned && !payload.old.is_pinned) {
            const msg = messages.find(m => m.id === payload.new.id);
            if (msg) setPinnedMessage({ ...msg, ...payload.new });
          } else if (!payload.new.is_pinned && payload.old.is_pinned) {
            if (pinnedMessage?.id === payload.new.id) {
              setPinnedMessage(null);
            }
          }
        }
      )
      .subscribe();
    
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [liveId, fetchMessages]);

  // Send a text message
  const sendMessage = useCallback(async (content: string) => {
    if (!liveId || !user || !content.trim()) return;
    
    try {
      setIsSending(true);
      setError(null);
      
      const { error: insertError } = await supabase
        .from("live_messages")
        .insert({
          live_id: liveId,
          user_id: user.id,
          content: content.trim(),
          type: "text",
        });
      
      if (insertError) throw insertError;
    } catch (err: any) {
      console.error("Error sending message:", err);
      setError(err.message);
      throw err;
    } finally {
      setIsSending(false);
    }
  }, [liveId, user]);

  // Send a gift message
  const sendGiftMessage = useCallback(async (gift: LiveGift, amount: number) => {
    if (!liveId || !user) return;
    
    try {
      setIsSending(true);
      setError(null);
      
      const { error: insertError } = await supabase
        .from("live_messages")
        .insert({
          live_id: liveId,
          user_id: user.id,
          content: `Enviou ${gift.name} x${amount}!`,
          type: "gift",
          gift_id: gift.id,
        });
      
      if (insertError) throw insertError;
    } catch (err: any) {
      console.error("Error sending gift message:", err);
      setError(err.message);
      throw err;
    } finally {
      setIsSending(false);
    }
  }, [liveId, user]);

  // Delete a message
  const deleteMessage = useCallback(async (messageId: string) => {
    try {
      const { error: deleteError } = await supabase
        .from("live_messages")
        .delete()
        .eq("id", messageId);
      
      if (deleteError) throw deleteError;
    } catch (err: any) {
      console.error("Error deleting message:", err);
      setError(err.message);
      throw err;
    }
  }, []);

  // Pin a message
  const pinMessage = useCallback(async (messageId: string) => {
    if (!liveId) return;
    
    try {
      // First, unpin all messages
      await supabase
        .from("live_messages")
        .update({ is_pinned: false })
        .eq("live_id", liveId)
        .eq("is_pinned", true);
      
      // Then pin the new one
      const { error: pinError } = await supabase
        .from("live_messages")
        .update({ is_pinned: true })
        .eq("id", messageId);
      
      if (pinError) throw pinError;
    } catch (err: any) {
      console.error("Error pinning message:", err);
      setError(err.message);
      throw err;
    }
  }, [liveId]);

  // Unpin message
  const unpinMessage = useCallback(async () => {
    if (!liveId || !pinnedMessage) return;
    
    try {
      const { error: unpinError } = await supabase
        .from("live_messages")
        .update({ is_pinned: false })
        .eq("id", pinnedMessage.id);
      
      if (unpinError) throw unpinError;
      
      setPinnedMessage(null);
    } catch (err: any) {
      console.error("Error unpinning message:", err);
      setError(err.message);
      throw err;
    }
  }, [liveId, pinnedMessage]);

  return {
    messages,
    pinnedMessage,
    isLoading,
    isSending,
    error,
    sendMessage,
    sendGiftMessage,
    deleteMessage,
    pinMessage,
    unpinMessage,
  };
}
