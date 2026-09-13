import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

const catchUpWindowMs = 24 * 60 * 60 * 1000;

function toastMarkerKey(userId: string) {
  return `classfy:notification-toast:last-seen:${userId}`;
}

/**
 * Escuta novas notificações do usuário e exibe um toast automático
 * (ex: conteúdo aprovado, novas recompensas, avisos do admin).
 */
export function useNotificationToasts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const displayedIds = useRef(new Set<string>());

  useEffect(() => {
    if (!user) return;

    let active = true;
    const markerKey = toastMarkerKey(user.id);
    const remember = (notification: NotificationRow) => {
      displayedIds.current.add(notification.id);
      const currentMarker = localStorage.getItem(markerKey);
      if (
        !currentMarker ||
        new Date(notification.created_at).getTime() >
          new Date(currentMarker).getTime()
      ) {
        localStorage.setItem(markerKey, notification.created_at);
      }
    };
    const showNotification = (notification: NotificationRow) => {
      if (displayedIds.current.has(notification.id)) return;
      remember(notification);
      toast({
        title: notification.title || "Nova notificação",
        description: notification.message,
      });
    };

    const storedMarker = localStorage.getItem(markerKey);
    const since =
      storedMarker && Number.isFinite(new Date(storedMarker).getTime())
        ? storedMarker
        : new Date(Date.now() - catchUpWindowMs).toISOString();

    void supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_read", false)
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(3)
      .then(({ data }) => {
        if (!active) return;
        (data ?? []).forEach(showNotification);
      });

    const channel = supabase
      .channel(`notification-toasts-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          showNotification(payload.new as NotificationRow);
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user, toast]);
}
