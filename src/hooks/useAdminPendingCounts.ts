import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface AdminPendingCounts {
  creators: number;
  contents: number;
  withdrawals: number;
}

/**
 * Hook para buscar contagens de itens pendentes para admins
 * Atualiza em tempo real quando há mudanças
 */
export function useAdminPendingCounts() {
  const { role } = useAuth();
  const [counts, setCounts] = useState<AdminPendingCounts>({
    creators: 0,
    contents: 0,
    withdrawals: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchCounts = async () => {
    if (role !== "admin") return;

    try {
      const [creatorsRes, contentsRes, withdrawalsRes] = await Promise.all([
        supabase
          .from("creator_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("contents")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("withdraw_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);

      setCounts({
        creators: creatorsRes.count || 0,
        contents: contentsRes.count || 0,
        withdrawals: withdrawalsRes.count || 0,
      });
    } catch (error) {
      console.error("Erro ao buscar contagens:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role !== "admin") {
      setLoading(false);
      return;
    }

    fetchCounts();

    // Realtime subscriptions para atualizar contagens
    const creatorRequestsChannel = supabase
      .channel("admin-pending-creators-count")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "creator_requests",
        },
        () => fetchCounts()
      )
      .subscribe();

    const contentsChannel = supabase
      .channel("admin-pending-contents-count")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contents",
        },
        () => fetchCounts()
      )
      .subscribe();

    const withdrawalsChannel = supabase
      .channel("admin-pending-withdrawals-count")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "withdraw_requests",
        },
        () => fetchCounts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(creatorRequestsChannel);
      supabase.removeChannel(contentsChannel);
      supabase.removeChannel(withdrawalsChannel);
    };
  }, [role]);

  const totalPending = counts.creators + counts.contents + counts.withdrawals;

  return { counts, loading, totalPending, refetch: fetchCounts };
}
