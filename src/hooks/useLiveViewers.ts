import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { RealtimeChannel } from "@supabase/supabase-js";

interface UseLiveViewersReturn {
  viewerCount: number;
  peakViewers: number;
  isLoading: boolean;
  joinLive: () => Promise<void>;
  leaveLive: () => Promise<void>;
}

export function useLiveViewers(liveId: string | null): UseLiveViewersReturn {
  const { user } = useAuth();
  const [viewerCount, setViewerCount] = useState(0);
  const [peakViewers, setPeakViewers] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  
  const channelRef = useRef<RealtimeChannel | null>(null);
  const viewerIdRef = useRef<string | null>(null);

  // Fetch current viewer count
  const fetchViewerCount = useCallback(async () => {
    if (!liveId) return;
    
    try {
      const { data, error } = await supabase
        .from("lives")
        .select("viewer_count, peak_viewers")
        .eq("id", liveId)
        .single();
      
      if (error) throw error;
      
      setViewerCount(data?.viewer_count || 0);
      setPeakViewers(data?.peak_viewers || 0);
    } catch (err) {
      console.error("Error fetching viewer count:", err);
    } finally {
      setIsLoading(false);
    }
  }, [liveId]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!liveId) return;
    
    fetchViewerCount();
    
    // Subscribe to lives table for viewer count updates
    channelRef.current = supabase
      .channel(`live-viewers-${liveId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "lives",
          filter: `id=eq.${liveId}`,
        },
        (payload) => {
          setViewerCount(payload.new.viewer_count || 0);
          setPeakViewers(payload.new.peak_viewers || 0);
        }
      )
      .subscribe();
    
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [liveId, fetchViewerCount]);

  // Join live as viewer
  const joinLive = useCallback(async () => {
    if (!liveId || !user) return;
    
    try {
      // Upsert viewer record
      const { data, error } = await supabase
        .from("live_viewers")
        .upsert(
          {
            live_id: liveId,
            user_id: user.id,
            is_active: true,
            joined_at: new Date().toISOString(),
            left_at: null,
          },
          {
            onConflict: "live_id,user_id",
          }
        )
        .select()
        .single();
      
      if (error) throw error;
      
      viewerIdRef.current = data.id;
    } catch (err) {
      console.error("Error joining live:", err);
    }
  }, [liveId, user]);

  // Leave live
  const leaveLive = useCallback(async () => {
    if (!liveId || !user) return;
    
    try {
      await supabase
        .from("live_viewers")
        .update({
          is_active: false,
          left_at: new Date().toISOString(),
        })
        .eq("live_id", liveId)
        .eq("user_id", user.id);
    } catch (err) {
      console.error("Error leaving live:", err);
    }
  }, [liveId, user]);

  // Auto-leave on unmount
  useEffect(() => {
    return () => {
      if (liveId && user) {
        // Fire and forget
        supabase
          .from("live_viewers")
          .update({
            is_active: false,
            left_at: new Date().toISOString(),
          })
          .eq("live_id", liveId)
          .eq("user_id", user.id)
          .then(() => {});
      }
    };
  }, [liveId, user]);

  return {
    viewerCount,
    peakViewers,
    isLoading,
    joinLive,
    leaveLive,
  };
}
