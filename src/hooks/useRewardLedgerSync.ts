import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { dispatchRewardEarned } from "@/lib/rewards/events";

type RewardRow = Pick<Database["public"]["Tables"]["reward_events"]["Row"],
  "id" | "user_id" | "action_key" | "content_id" | "points" | "point_type">;

// Recompensas concedidas ao creator por outra pessoa não passam pelo hook da ação.
export function useRewardLedgerSync(userId?: string) {
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let cursor = new Date(Date.now() - 10_000).toISOString();

    const publish = (row: RewardRow) => {
      if (row.user_id !== userId || Number(row.points) <= 0) return;
      dispatchRewardEarned({
        eventId: row.id,
        actionKey: row.action_key,
        userId,
        contentId: row.content_id || undefined,
        points: Number(row.points),
        pointType: row.point_type === "creator" ? "creator" : "user",
      });
    };

    const catchUp = async () => {
      const startedAt = new Date().toISOString();
      const { data, error } = await supabase.from("reward_events")
        .select("id, user_id, action_key, content_id, points, point_type, created_at")
        .eq("user_id", userId)
        .gte("created_at", cursor)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!active || error) return;
      data?.reverse().forEach(publish);
      if (startedAt > cursor) cursor = startedAt;
    };

    const channel = supabase.channel(`reward-ledger-${userId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "reward_events",
        filter: `user_id=eq.${userId}`,
      }, (payload) => publish(payload.new as RewardRow))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void catchUp();
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") void catchUp();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
