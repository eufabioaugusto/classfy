import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Study {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  main_topic: string | null;
  status: 'active' | 'archived';
  plan_at_creation: 'free' | 'pro' | 'premium';
  created_at: string;
  last_activity_at: string;
}

export interface StudyMessage {
  id: string;
  study_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

const PLAN_LIMITS = {
  free: 5,
  pro: 50,
  premium: Infinity,
};

export function useStudies() {
  const { user, profile } = useAuth();
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCount, setActiveCount] = useState(0);

  const currentPlan = profile?.plan || 'free';
  const limit = PLAN_LIMITS[currentPlan];

  useEffect(() => {
    if (user) {
      fetchStudies();
    } else {
      setStudies([]);
      setLoading(false);
    }
  }, [user]);

  const fetchStudies = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("studies")
        .select("*")
        .eq("user_id", user.id)
        .order("last_activity_at", { ascending: false });

      if (error) throw error;

      setStudies((data || []) as Study[]);
      setActiveCount(data?.filter(s => s.status === 'active').length || 0);
    } catch (error) {
      console.error("Error fetching studies:", error);
    } finally {
      setLoading(false);
    }
  };

  const createStudy = async (title: string, description?: string) => {
    if (!user) return null;

    // Check limit
    if (activeCount >= limit) {
      return { error: 'LIMIT_REACHED' };
    }

    try {
      const { data, error } = await supabase
        .from("studies")
        .insert({
          user_id: user.id,
          title,
          description,
          plan_at_creation: currentPlan,
          status: 'active',
        })
        .select()
        .single();

      if (error) throw error;

      await fetchStudies();
      return { data };
    } catch (error) {
      console.error("Error creating study:", error);
      return { error };
    }
  };

  const archiveStudy = async (studyId: string) => {
    try {
      const { error } = await supabase
        .from("studies")
        .update({ status: 'archived' })
        .eq("id", studyId);

      if (error) throw error;

      await fetchStudies();
    } catch (error) {
      console.error("Error archiving study:", error);
    }
  };

  const updateLastActivity = async (studyId: string) => {
    try {
      await supabase
        .from("studies")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", studyId);
    } catch (error) {
      console.error("Error updating last activity:", error);
    }
  };

  const canCreateMore = activeCount < limit;

  return {
    studies,
    activeStudies: studies.filter(s => s.status === 'active'),
    archivedStudies: studies.filter(s => s.status === 'archived'),
    loading,
    activeCount,
    limit,
    canCreateMore,
    createStudy,
    archiveStudy,
    updateLastActivity,
    refetch: fetchStudies,
  };
}
