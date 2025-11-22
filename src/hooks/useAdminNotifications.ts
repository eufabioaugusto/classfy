import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

/**
 * Hook para notificações em tempo real para administradores
 * Monitora novas solicitações pendentes e exibe toasts
 */
export function useAdminNotifications() {
  const { role } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (role !== "admin") return;

    // Canal para solicitações de creator
    const creatorRequestsChannel = supabase
      .channel("admin-creator-requests")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "creator_requests",
          filter: "status=eq.pending",
        },
        (payload) => {
          const request: any = payload.new;
          toast({
            title: "🎨 Nova Solicitação de Creator",
            description: `${request.channel_name} solicitou ser creator`,
          });
        }
      )
      .subscribe();

    // Canal para conteúdos pendentes
    const contentsChannel = supabase
      .channel("admin-pending-contents")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "contents",
          filter: "status=eq.pending",
        },
        (payload) => {
          const content: any = payload.new;
          toast({
            title: "📹 Novo Conteúdo para Aprovar",
            description: `"${content.title}" aguarda revisão`,
          });
        }
      )
      .subscribe();

    // Canal para saques pendentes
    const withdrawalsChannel = supabase
      .channel("admin-pending-withdrawals")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "withdraw_requests",
          filter: "status=eq.pending",
        },
        (payload) => {
          const withdrawal: any = payload.new;
          toast({
            title: "💰 Nova Solicitação de Saque",
            description: `R$ ${withdrawal.amount.toFixed(2)} aguarda aprovação`,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(creatorRequestsChannel);
      supabase.removeChannel(contentsChannel);
      supabase.removeChannel(withdrawalsChannel);
    };
  }, [role, toast]);
}
