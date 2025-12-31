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
  message_count: number;
  topic_deviations_count: number;
}

export interface StudyMessage {
  id: string;
  study_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

// Plan limits for studies, messages, and deviations
export const PLAN_LIMITS = {
  free: { studies: 5, messages: 30, deviations: 3 },
  pro: { studies: 50, messages: 200, deviations: 20 },
  premium: { studies: Infinity, messages: Infinity, deviations: Infinity },
};

export function useStudies() {
  const { user, profile } = useAuth();
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCount, setActiveCount] = useState(0);

  const currentPlan = (profile?.plan || 'free') as keyof typeof PLAN_LIMITS;
  const limits = PLAN_LIMITS[currentPlan];

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

      // Map to include new columns with defaults
      const mappedStudies = (data || []).map(s => ({
        ...s,
        message_count: s.message_count || 0,
        topic_deviations_count: s.topic_deviations_count || 0,
      })) as Study[];

      setStudies(mappedStudies);
      setActiveCount(mappedStudies.filter(s => s.status === 'active').length);
    } catch (error) {
      console.error("Error fetching studies:", error);
    } finally {
      setLoading(false);
    }
  };

  const createStudy = async (title: string, description?: string) => {
    if (!user) return null;

    // Check limit
    if (activeCount >= limits.studies) {
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

  // Get usage stats for a specific study
  const getStudyUsage = (studyId: string) => {
    const study = studies.find(s => s.id === studyId);
    if (!study) return null;

    return {
      messageCount: study.message_count,
      maxMessages: limits.messages,
      messagePercent: Math.min(100, Math.round((study.message_count / limits.messages) * 100)),
      deviationCount: study.topic_deviations_count,
      maxDeviations: limits.deviations,
      deviationPercent: Math.min(100, Math.round((study.topic_deviations_count / limits.deviations) * 100)),
      isNearLimit: study.message_count >= limits.messages * 0.8,
      isAtLimit: study.message_count >= limits.messages,
    };
  };

  const canCreateMore = activeCount < limits.studies;

  return {
    studies,
    activeStudies: studies.filter(s => s.status === 'active'),
    archivedStudies: studies.filter(s => s.status === 'archived'),
    loading,
    activeCount,
    limits,
    currentPlan,
    canCreateMore,
    createStudy,
    archiveStudy,
    updateLastActivity,
    getStudyUsage,
    refetch: fetchStudies,
  };
}
