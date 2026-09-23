import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { dispatchRewardEarned } from '@/lib/rewards/events';

export interface CreatorMilestone {
  id: string;
  milestone_type: 'contents' | 'followers' | 'earnings' | 'engagement' | 'views';
  milestone_value: number;
  reward_points: number;
  reward_enabled: boolean;
  badge_id: string | null;
  title: string;
  description: string | null;
  icon: string;
  active: boolean;
  order_index: number;
  created_at: string;
}

export interface CreatorMilestoneProgress {
  id: string;
  creator_id: string;
  milestone_id: string;
  current_value: number;
  completed_at: string | null;
  claimed: boolean;
  claimed_at: string | null;
  reward_status: 'pending' | 'awarded' | 'legacy_ignored' | 'disabled';
  reward_points: number;
  reward_event_id: string | null;
  milestone?: CreatorMilestone;
}

export interface CreatorStats {
  totalContents: number;
  totalFollowers: number;
  totalEarnings: number;
  totalViews: number;
  engagementRate: number;
}

export interface MilestoneWithProgress extends CreatorMilestone {
  progress: CreatorMilestoneProgress | null;
  currentValue: number;
  percentComplete: number;
  isCompleted: boolean;
  isClaimed: boolean;
}

export function useCreatorMilestones(creatorId?: string) {
  const [milestones, setMilestones] = useState<MilestoneWithProgress[]>([]);
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchCreatorStats = useCallback(async (userId: string): Promise<CreatorStats> => {
    // Fetch total contents
    const [{ count: contentsCount }, { count: coursesCount }] = await Promise.all([
      supabase
        .from('contents')
        .select('*', { count: 'exact', head: true })
        .eq('creator_id', userId)
        .eq('status', 'approved')
        .neq('content_type', 'short'),
      supabase
        .from('courses')
        .select('*', { count: 'exact', head: true })
        .eq('creator_id', userId)
        .eq('status', 'approved'),
    ]);

    // Fetch total followers
    const { count: followersCount } = await supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', userId);

    // Fetch total views
    const [{ data: contentsData }, { data: coursesData }] = await Promise.all([
      supabase
        .from('contents')
        .select('views_count, likes_count')
        .eq('creator_id', userId)
        .eq('status', 'approved')
        .neq('content_type', 'short'),
      supabase
        .from('courses')
        .select('views_count')
        .eq('creator_id', userId)
        .eq('status', 'approved'),
    ]);
    
    const totalViews = (contentsData?.reduce((sum, c) => sum + (c.views_count || 0), 0) || 0)
      + (coursesData?.reduce((sum, c) => sum + (c.views_count || 0), 0) || 0);

    // Fetch total earnings from wallet
    const { data: walletData } = await supabase
      .from('wallets')
      .select('total_earned')
      .eq('user_id', userId)
      .single();

    // Calculate engagement rate (likes / views * 100)
    const totalLikes = contentsData?.reduce((sum, c) => sum + (c.likes_count || 0), 0) || 0;
    const engagementRate = totalViews > 0 ? Math.round((totalLikes / totalViews) * 100) : 0;

    return {
      totalContents: (contentsCount || 0) + (coursesCount || 0),
      totalFollowers: followersCount || 0,
      totalEarnings: walletData?.total_earned || 0,
      totalViews,
      engagementRate
    };
  }, []);

  const fetchMilestones = useCallback(async () => {
    if (!creatorId) return;

    setLoading(true);
    try {
      // Fetch creator stats
      const creatorStats = await fetchCreatorStats(creatorId);
      setStats(creatorStats);

      // Fetch all active milestones
      const { data: milestonesData, error: milestonesError } = await supabase
        .from('creator_milestones')
        .select('*')
        .eq('active', true)
        .order('order_index');

      if (milestonesError) throw milestonesError;

      // Fetch progress for this creator
      const { data: progressData, error: progressError } = await supabase
        .from('creator_milestone_progress')
        .select('*')
        .eq('creator_id', creatorId);

      if (progressError) throw progressError;

      // Map milestones with progress
      const milestonesWithProgress: MilestoneWithProgress[] = (milestonesData || []).map((milestone) => {
        const progress = progressData?.find(p => p.milestone_id === milestone.id) || null;
        const milestoneType = milestone.milestone_type as CreatorMilestone['milestone_type'];
        
        // Get current value based on milestone type
        let currentValue = 0;
        switch (milestoneType) {
          case 'contents':
            currentValue = creatorStats.totalContents;
            break;
          case 'followers':
            currentValue = creatorStats.totalFollowers;
            break;
          case 'earnings':
            currentValue = creatorStats.totalEarnings;
            break;
          case 'views':
            currentValue = creatorStats.totalViews;
            break;
          case 'engagement':
            currentValue = creatorStats.engagementRate;
            break;
        }

        const percentComplete = Math.min(100, Math.round((currentValue / milestone.milestone_value) * 100));
        const isCompleted = currentValue >= milestone.milestone_value;
        const isClaimed = progress?.claimed || false;

        return {
          id: milestone.id,
          milestone_type: milestoneType,
          milestone_value: milestone.milestone_value,
          reward_points: milestone.reward_points,
          reward_enabled: milestone.reward_enabled,
          badge_id: milestone.badge_id,
          title: milestone.title,
          description: milestone.description,
          icon: milestone.icon || 'trophy',
          active: milestone.active,
          order_index: milestone.order_index,
          created_at: milestone.created_at,
          progress,
          currentValue,
          percentComplete,
          isCompleted,
          isClaimed
        };
      });

      setMilestones(milestonesWithProgress);
    } catch (error) {
      console.error('Error fetching milestones:', error);
    } finally {
      setLoading(false);
    }
  }, [creatorId, fetchCreatorStats]);

  const claimMilestone = useCallback(async (milestoneId: string) => {
    if (!creatorId || claiming) return;

    setClaiming(milestoneId);
    try {
      const milestone = milestones.find(m => m.id === milestoneId);
      if (!milestone || !milestone.isCompleted || milestone.isClaimed) {
        throw new Error('Milestone não pode ser resgatada');
      }

      // O servidor valida a meta e registra conquista + Creator Points de forma
      // atomica e idempotente no ledger da Economia V1.
      const { data: claimData, error: claimError } = await supabase.functions.invoke('claim-creator-milestone', {
        body: {
          milestoneId: milestone.id,
          creatorId,
        },
      });
      if (claimError) throw claimError;

      const awardedMilestone = claimData?.evaluation?.awarded?.find(
        (award: { milestone_id: string; points: number; reward_event_id?: string }) => award.milestone_id === milestone.id,
      );
      const earnedPoints = Number(awardedMilestone?.points || 0);
      if (earnedPoints > 0) {
        dispatchRewardEarned({
          eventId: awardedMilestone.reward_event_id,
          actionKey: 'CREATOR_MILESTONE',
          userId: creatorId,
          points: earnedPoints,
          pointType: 'creator',
        });
      }

      toast({
        title: '🎉 Meta alcançada!',
        description: earnedPoints > 0
          ? `Você recebeu +${earnedPoints.toLocaleString('pt-BR')} Creator Points.`
          : 'Conquista registrada no seu perfil.',
      });

      // Refresh milestones
      await fetchMilestones();
    } catch (error) {
      console.error('Error claiming milestone:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível registrar a conquista',
        variant: 'destructive'
      });
    } finally {
      setClaiming(null);
    }
  }, [creatorId, claiming, milestones, toast, fetchMilestones]);

  useEffect(() => {
    fetchMilestones();
  }, [fetchMilestones]);

  // Group milestones by type
  const milestonesByType = {
    contents: milestones.filter(m => m.milestone_type === 'contents'),
    followers: milestones.filter(m => m.milestone_type === 'followers'),
    earnings: milestones.filter(m => m.milestone_type === 'earnings'),
    views: milestones.filter(m => m.milestone_type === 'views'),
    engagement: milestones.filter(m => m.milestone_type === 'engagement')
  };

  // Get next milestones (closest to completion that aren't claimed)
  const nextMilestones = milestones
    .filter(m => !m.isClaimed)
    .sort((a, b) => b.percentComplete - a.percentComplete)
    .slice(0, 3);

  // Calculate totals
  const totalMilestones = milestones.length;
  const completedMilestones = milestones.filter(m => m.isCompleted).length;
  const claimedMilestones = milestones.filter(m => m.isClaimed).length;
  const pendingClaims = milestones.filter(m => m.isCompleted && !m.isClaimed).length;

  return {
    milestones,
    milestonesByType,
    nextMilestones,
    stats,
    loading,
    claiming,
    claimMilestone,
    refetch: fetchMilestones,
    totals: {
      total: totalMilestones,
      completed: completedMilestones,
      claimed: claimedMilestones,
      pendingClaims
    }
  };
}
