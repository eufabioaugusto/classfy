import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface CreatorMilestone {
  id: string;
  milestone_type: 'contents' | 'followers' | 'earnings' | 'engagement' | 'views';
  milestone_value: number;
  points_reward: number;
  value_reward: number;
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
    const { count: contentsCount } = await supabase
      .from('contents')
      .select('*', { count: 'exact', head: true })
      .eq('creator_id', userId)
      .eq('status', 'approved');

    // Fetch total followers
    const { count: followersCount } = await supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', userId);

    // Fetch total views
    const { data: contentsData } = await supabase
      .from('contents')
      .select('views_count')
      .eq('creator_id', userId);
    
    const totalViews = contentsData?.reduce((sum, c) => sum + (c.views_count || 0), 0) || 0;

    // Fetch total earnings from wallet
    const { data: walletData } = await supabase
      .from('wallets')
      .select('total_earned')
      .eq('user_id', userId)
      .single();

    // Calculate engagement rate (likes / views * 100)
    const { data: likesData } = await supabase
      .from('contents')
      .select('likes_count')
      .eq('creator_id', userId);
    
    const totalLikes = likesData?.reduce((sum, c) => sum + (c.likes_count || 0), 0) || 0;
    const engagementRate = totalViews > 0 ? Math.round((totalLikes / totalViews) * 100) : 0;

    return {
      totalContents: contentsCount || 0,
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
          points_reward: milestone.points_reward,
          value_reward: milestone.value_reward,
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

      // Check if progress exists, create if not
      const { data: existingProgress } = await supabase
        .from('creator_milestone_progress')
        .select('id')
        .eq('creator_id', creatorId)
        .eq('milestone_id', milestoneId)
        .single();

      if (existingProgress) {
        // Update existing progress
        await supabase
          .from('creator_milestone_progress')
          .update({
            claimed: true,
            claimed_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            current_value: milestone.currentValue
          })
          .eq('id', existingProgress.id);
      } else {
        // Insert new progress
        await supabase
          .from('creator_milestone_progress')
          .insert({
            creator_id: creatorId,
            milestone_id: milestoneId,
            current_value: milestone.currentValue,
            completed_at: new Date().toISOString(),
            claimed: true,
            claimed_at: new Date().toISOString()
          });
      }

      // Acumular PP e registrar reward via edge function (service_role server-side)
      const { error: rewardError } = await supabase.functions.invoke('claim-creator-milestone', {
        body: {
          milestoneId: milestone.id,
          creatorId,
        },
      });

      if (rewardError) {
        console.error('Erro ao processar recompensa de milestone:', rewardError);
      }

      toast({
        title: '🎉 Meta alcançada!',
        description: `+${milestone.points_reward} pontos de nível · +${ppAmount} PP acumulados no pool mensal`,
      });

      // Refresh milestones
      await fetchMilestones();
    } catch (error) {
      console.error('Error claiming milestone:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível resgatar a recompensa',
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
