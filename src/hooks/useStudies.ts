import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeStudyTitle } from "@/lib/study/getStudyJourneySummary";

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
  related_contents?: any[] | null;
  metadata?: Record<string, any> | null;
}

export interface StudyPlanLimits {
  studies: number;
  messages: number;
  deviations: number;
}

// Fallback until limits are loaded from the DB source of truth
export const PLAN_LIMITS: Record<'free' | 'pro' | 'premium', StudyPlanLimits> = {
  free: { studies: 5, messages: 5, deviations: 3 },
  pro: { studies: 50, messages: 30, deviations: 20 },
  premium: { studies: Number.POSITIVE_INFINITY, messages: Number.POSITIVE_INFINITY, deviations: Number.POSITIVE_INFINITY },
};

function normalizeLimitValue(value: unknown, fallback: number) {
  if (value === null || value === undefined) return fallback;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue >= 999999) {
    return Number.POSITIVE_INFINITY;
  }

  return numericValue;
}

export function useStudies() {
  const { user, profile } = useAuth();
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCount, setActiveCount] = useState(0);
  const [limits, setLimits] = useState<StudyPlanLimits>(PLAN_LIMITS.free);

  const currentPlan = (profile?.plan || 'free') as keyof typeof PLAN_LIMITS;

  useEffect(() => {
    setLimits(PLAN_LIMITS[currentPlan]);

    const loadLimits = async () => {
      const { data, error } = await supabase.rpc("get_study_limits", {
        p_plan: currentPlan,
      });

      if (error || !data) {
        console.error("Error loading study limits:", error);
        return;
      }

      setLimits({
        studies: normalizeLimitValue(data.max_studies, PLAN_LIMITS[currentPlan].studies),
        messages: normalizeLimitValue(data.max_messages, PLAN_LIMITS[currentPlan].messages),
        deviations: normalizeLimitValue(data.max_deviations, PLAN_LIMITS[currentPlan].deviations),
      });
    };

    loadLimits();
  }, [currentPlan]);

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
      const normalizedTitle = normalizeStudyTitle(title);

      const { data, error } = await supabase
        .from("studies")
        .insert({
          user_id: user.id,
          title: normalizedTitle,
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
      messagePercent: Number.isFinite(limits.messages)
        ? Math.min(100, Math.round((study.message_count / limits.messages) * 100))
        : 0,
      deviationCount: study.topic_deviations_count,
      maxDeviations: limits.deviations,
      deviationPercent: Number.isFinite(limits.deviations)
        ? Math.min(100, Math.round((study.topic_deviations_count / limits.deviations) * 100))
        : 0,
      isNearLimit: Number.isFinite(limits.messages) ? study.message_count >= limits.messages * 0.8 : false,
      isAtLimit: Number.isFinite(limits.messages) ? study.message_count >= limits.messages : false,
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
