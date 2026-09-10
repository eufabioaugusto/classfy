import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RewardPayload {
  actionKey: string;
  userId: string;
  contentId?: string;
  metadata?: Record<string, any>;
}

interface PlanMultipliers {
  free: number;
  pro: number;
  premium: number;
}

// Defaults usados se platform_settings não carregar
const DEFAULT_PLAN_MULTIPLIERS: PlanMultipliers = {
  free: 0.1,
  pro: 1.0,
  premium: 1.5,
};

// Actions that can only be rewarded once per day
const DAILY_ACTIONS = ['DAILY_LOGIN', 'FIRST_CONTENT_WEEK', 'BINGE_WATCH', 'WEEKLY_STREAK'];

// Actions that can only be rewarded once per content per user
const UNIQUE_PER_CONTENT_ACTIONS = [
  'LIKE_CONTENT', 
  'SAVE_CONTENT', 
  'FAVORITE_CONTENT', 
  'WATCH_50', 
  'WATCH_100', 
  'COMMENT_CONTENT',
  'VIEW_15S',
  'SHARE_CONTENT'
];

// Actions that can only be rewarded once ever per user
const ONE_TIME_ACTIONS = [
  'PROFILE_COMPLETE', 
  'FIRST_UPLOAD'
];

const CLIENT_REWARD_ACTIONS = new Set([
  'DAILY_LOGIN', 'WEEKLY_STREAK', 'FIRST_CONTENT_WEEK', 'BINGE_WATCH',
  'LIKE_CONTENT', 'SAVE_CONTENT', 'FAVORITE_CONTENT', 'COMMENT_CONTENT',
  'SUBSCRIBE_CREATOR', 'VIEW_15S', 'WATCH_50', 'WATCH_100',
  'COMPLETE_COURSE', 'PROFILE_COMPLETE',
]);

async function hasRewardEvidence(
  supabase: any,
  actionKey: string,
  userId: string,
  contentId: string | undefined,
  metadata: Record<string, any>,
) {
  const exists = async (table: string, filters: Array<[string, unknown]>) => {
    let query = supabase.from(table).select('id', { count: 'exact', head: true });
    for (const [column, value] of filters) query = query.eq(column, value);
    const { count, error } = await query;
    if (error) throw error;
    return (count || 0) > 0;
  };

  switch (actionKey) {
    case 'LIKE_CONTENT':
      return !!contentId && exists('actions', [['user_id', userId], ['content_id', contentId], ['type', 'LIKE']]);
    case 'SAVE_CONTENT':
      return !!contentId && exists('saved_contents', [['user_id', userId], ['content_id', contentId]]);
    case 'FAVORITE_CONTENT':
      return !!contentId && exists('favorites', [['user_id', userId], ['content_id', contentId]]);
    case 'COMMENT_CONTENT':
      return !!contentId && exists('comments', [['user_id', userId], ['content_id', contentId]]);
    case 'SUBSCRIBE_CREATOR':
      return !!metadata.creatorId && exists('follows', [['follower_id', userId], ['following_id', metadata.creatorId]]);
    case 'VIEW_15S': {
      if (!contentId) return false;
      const { data, error } = await supabase.from('content_views')
        .select('id').eq('user_id', userId).eq('content_id', contentId)
        .gte('total_watch_time_seconds', 15).limit(1);
      if (error) throw error;
      return !!data?.length;
    }
    case 'WATCH_50':
    case 'WATCH_100': {
      if (!contentId) return false;
      const threshold = actionKey === 'WATCH_50' ? 50 : 90;
      const { data, error } = await supabase.from('user_progress')
        .select('id').eq('user_id', userId).eq('content_id', contentId)
        .gte('progress_percent', threshold).limit(1);
      if (error) throw error;
      return !!data?.length;
    }
    case 'COMPLETE_COURSE': {
      if (!contentId) return false;
      const { data, error } = await supabase.from('course_enrollments')
        .select('id').eq('user_id', userId).eq('course_id', contentId)
        .gte('progress_percent', 100).limit(1);
      if (error) throw error;
      return !!data?.length;
    }
    case 'PROFILE_COMPLETE': {
      const { data, error } = await supabase.from('profiles')
        .select('display_name,avatar_url,bio').eq('id', userId).single();
      if (error) throw error;
      return !!data?.display_name && !!data?.avatar_url && !!data?.bio;
    }
    case 'DAILY_LOGIN': {
      const brazilDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0];
      return exists('user_login_streaks', [['user_id', userId], ['last_login_date', brazilDate]]);
    }
    case 'WEEKLY_STREAK': {
      const { data, error } = await supabase.from('user_login_streaks')
        .select('current_streak').eq('user_id', userId).single();
      if (error) throw error;
      return Number(data?.current_streak || 0) >= 7;
    }
    case 'FIRST_CONTENT_WEEK':
      return !!contentId && exists('content_metrics', [['user_id', userId], ['content_id', contentId], ['event', 'start']]);
    case 'BINGE_WATCH': {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error } = await supabase.from('content_metrics')
        .select('id', { count: 'exact', head: true }).eq('user_id', userId)
        .eq('event', 'complete').gte('created_at', oneHourAgo);
      if (error) throw error;
      return (count || 0) >= 3;
    }
    default:
      return false;
  }
}

// Actions that can only be rewarded once per content (regardless of user)
const UNIQUE_PER_CONTENT_GLOBAL = [
  'CONTENT_APPROVED',
  'COMPLETE_COURSE'
];

// ──────────────────────────────────────────
// ANTI-FRAUD: Daily limits per action type
// ──────────────────────────────────────────
const DAILY_ACTION_LIMITS: Record<string, number> = {
  LIKE_CONTENT: 30,
  SAVE_CONTENT: 20,
  FAVORITE_CONTENT: 20,
  COMMENT_CONTENT: 15,
  VIEW_15S: 50,
  WATCH_50: 30,
  WATCH_100: 20,
  SUBSCRIBE_CREATOR: 10,
  SHARE_CONTENT: 15,
};

// Diminishing returns: after N actions in a day, PP is reduced by a curve
// Returns a multiplier between 0 and 1
function getDiminishingMultiplier(dailyCount: number, limit: number): number {
  if (dailyCount <= 0) return 1.0;
  // First 50% of limit: full value
  const halfLimit = Math.floor(limit / 2);
  if (dailyCount < halfLimit) return 1.0;
  // 50-80% of limit: 50% value
  const eightyLimit = Math.floor(limit * 0.8);
  if (dailyCount < eightyLimit) return 0.5;
  // 80-100%: 25% value
  if (dailyCount < limit) return 0.25;
  // At limit: blocked
  return 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { actionKey, userId, contentId, metadata = {} }: RewardPayload = await req.json();

    if (!actionKey || !userId) {
      console.error('Missing required fields:', { actionKey, userId });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: actionKey and userId' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const authHeader = req.headers.get('Authorization') || '';
    const isServiceRequest = authHeader === `Bearer ${supabaseKey}`;
    if (!isServiceRequest) {
      if (!CLIENT_REWARD_ACTIONS.has(actionKey)) {
        return new Response(JSON.stringify({ error: 'Server-only reward action' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
        });
      }
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authError } = await authClient.auth.getUser(authHeader.replace('Bearer ', ''));
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
        });
      }
      if (user.id !== userId) {
        return new Response(JSON.stringify({ error: 'User identity mismatch' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
        });
      }
      if (!await hasRewardEvidence(supabase, actionKey, userId, contentId, metadata)) {
        return new Response(JSON.stringify({ error: 'Reward action is not backed by server evidence' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409,
        });
      }
    }

    console.log('Processing reward request:', { actionKey, userId: userId.slice(0, 8) + '...', hasContent: !!contentId });

    // Resolve content or course
    let resolvedContentId: string | null = null;
    let resolvedCourseId: string | null = null;
    let resolvedTitle: string | null = null;
    let creatorId: string | null = null;

    if (contentId) {
      const { data: contentRow } = await supabase
        .from('contents')
        .select('id, creator_id, title')
        .eq('id', contentId)
        .maybeSingle();

      if (contentRow) {
        resolvedContentId = contentRow.id;
        creatorId = contentRow.creator_id;
        resolvedTitle = contentRow.title;
      } else {
        const { data: courseRow } = await supabase
          .from('courses')
          .select('id, creator_id, title')
          .eq('id', contentId)
          .maybeSingle();

        if (courseRow) {
          resolvedCourseId = courseRow.id;
          creatorId = courseRow.creator_id;
          resolvedTitle = courseRow.title;
        }
      }
    }

    // STEP 1: ATOMIC FRAUD PREVENTION
    // Use Brazil timezone (UTC-3) so the day boundary matches the user's local calendar
    const brazilDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const today = brazilDate.toISOString().split('T')[0];
    let trackingKey: string;
    const trackingMetadata: Record<string, any> = { ...metadata };

    if (resolvedCourseId) {
      trackingMetadata.course_id = resolvedCourseId;
      if (resolvedTitle) trackingMetadata.course_title = resolvedTitle;
    }

    if (DAILY_ACTIONS.includes(actionKey)) {
      trackingKey = `${actionKey}_${today}`;
      trackingMetadata.tracking_date = today;
    } else if (UNIQUE_PER_CONTENT_ACTIONS.includes(actionKey)) {
      trackingKey = contentId ? `${actionKey}_${contentId}` : actionKey;
    } else if (ONE_TIME_ACTIONS.includes(actionKey)) {
      trackingKey = actionKey;
    } else if (UNIQUE_PER_CONTENT_GLOBAL.includes(actionKey)) {
      trackingKey = contentId ? `${actionKey}_${contentId}` : actionKey;
    } else {
      const creatorIdFromMeta = metadata?.creatorId;
      trackingKey = creatorIdFromMeta ? `${actionKey}_${creatorIdFromMeta}` : actionKey;
    }

    // Check existing tracking
    const { data: existingTracking, error: trackingCheckError } = await supabase
      .from('reward_action_tracking')
      .select('id, created_at')
      .eq('user_id', userId)
      .eq('action_key', trackingKey);

    if (trackingCheckError) {
      console.error('Error checking tracking:', trackingCheckError);
      return new Response(
        JSON.stringify({ error: 'Database error checking tracking' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    if (existingTracking && existingTracking.length > 0) {
      console.log('Action already tracked, skipping reward:', { actionKey, trackingKey });
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Action already rewarded',
          alreadyTracked: true,
          trackedAt: existingTracking[0].created_at,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ──────────────────────────────────────────
    // ANTI-FRAUD: Daily limit & diminishing returns check
    // ──────────────────────────────────────────
    let diminishingMultiplier = 1.0;
    const dailyLimit = DAILY_ACTION_LIMITS[actionKey];
    
    if (dailyLimit) {
      // Count how many times this action was used today by this user (Brazil UTC-3 day boundary)
      const todayStart = new Date(Date.now() - 3 * 60 * 60 * 1000);
      todayStart.setUTCHours(0, 0, 0, 0);
      
      const { count: dailyCount } = await supabase
        .from('reward_action_tracking')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .like('action_key', `${actionKey}%`)
        .gte('created_at', todayStart.toISOString());

      const currentCount = dailyCount || 0;
      console.log('Daily action count:', { actionKey, currentCount, dailyLimit });

      if (currentCount >= dailyLimit) {
        console.log('ANTI-FRAUD: Daily limit exceeded, blocking reward:', { actionKey, currentCount, dailyLimit });
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Daily action limit reached',
            dailyLimitReached: true,
            limit: dailyLimit,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      diminishingMultiplier = getDiminishingMultiplier(currentCount, dailyLimit);
      if (diminishingMultiplier < 1) {
        console.log('Diminishing returns applied:', { multiplier: diminishingMultiplier, currentCount });
      }
    }

    // ANTI-FRAUD: Burst detection (>5 actions of same type within 60 seconds)
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: burstCount } = await supabase
      .from('reward_action_tracking')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .like('action_key', `${actionKey}%`)
      .gte('created_at', oneMinAgo);

    if ((burstCount || 0) > 5) {
      console.log('ANTI-FRAUD: Burst behavior detected, reducing reward:', { actionKey, burstCount });
      diminishingMultiplier = Math.min(diminishingMultiplier, 0.1);
    }

    // STEP 2: Get action config
    const { data: config, error: configError } = await supabase
      .from('reward_actions_config')
      .select('*')
      .eq('action_key', actionKey)
      .eq('active', true)
      .single();

    if (configError || !config) {
      console.error('Action config not found or inactive:', actionKey);
      return new Response(
        JSON.stringify({ error: 'Action config not found or inactive' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // STEP 3: Get user profile, plan e multipliers configuráveis do banco
    const [profileRes, settingsRes] = await Promise.all([
      supabase.from('profiles').select('plan').eq('id', userId).single(),
      supabase.from('platform_settings').select('value').eq('key', 'economic').single(),
    ]);

    const userPlan = (profileRes.data?.plan || 'free') as keyof PlanMultipliers;
    const economicSettings = settingsRes.data?.value as any;
    const planConfig = economicSettings?.plan_config?.[userPlan];
    const planMultiplier = planConfig?.multiplier ?? DEFAULT_PLAN_MULTIPLIERS[userPlan] ?? 1.0;

    // STEP 4: Get or create current economic cycle
    const { data: cycleIdResult } = await supabase.rpc('get_or_create_current_cycle');
    const cycleId = cycleIdResult as string | null;

    // STEP 4.5: Get consistency multiplier based on active days this cycle
    const cycleStart = new Date();
    cycleStart.setUTCDate(1);
    cycleStart.setUTCHours(0, 0, 0, 0);
    const cycleStartDate = cycleStart.toISOString().split('T')[0];

    const { data: activeDays } = await supabase.rpc('get_user_active_days', {
      p_user_id: userId,
      p_cycle_start: cycleStartDate,
    });

    const userActiveDays = (activeDays as number) || 0;
    const consistencyMultiplier = userActiveDays >= 25 ? 1.3
      : userActiveDays >= 20 ? 1.2
      : userActiveDays >= 15 ? 1.1
      : 1.0;

    if (consistencyMultiplier > 1.0) {
      console.log('Consistency multiplier applied:', { userActiveDays, consistencyMultiplier });
    }

    if (!cycleId) throw new Error('Current economic cycle is unavailable');

    const userPoints = parseFloat((Number(config.points_user || 0) * planMultiplier).toFixed(2));
    const userPP = Number(config.points_user || 0) * planMultiplier
      * diminishingMultiplier * consistencyMultiplier;
    const actorEvent = {
      user_id: userId,
      related_user_id: creatorId,
      content_id: resolvedContentId,
      action_key: actionKey,
      points: userPoints,
      performance_points: userPP,
      metadata: {
        ...trackingMetadata,
        tracking_key: trackingKey,
        consistency_multiplier: consistencyMultiplier,
        active_days: userActiveDays,
      },
    };

    let creatorEvent: Record<string, unknown> | null = null;
    if (creatorId && creatorId !== userId && Number(config.points_creator || 0) > 0) {
      const { data: creatorProfile, error: creatorProfileError } = await supabase
        .from('profiles').select('plan').eq('id', creatorId).single();
      if (creatorProfileError) throw creatorProfileError;
      const creatorPlan = (creatorProfile?.plan || 'free') as keyof PlanMultipliers;
      const creatorMultiplier = economicSettings?.plan_config?.[creatorPlan]?.multiplier
        ?? DEFAULT_PLAN_MULTIPLIERS[creatorPlan] ?? 1;
      const { data: creatorActiveDays, error: creatorDaysError } = await supabase.rpc('get_user_active_days', {
        p_user_id: creatorId,
        p_cycle_start: cycleStartDate,
      });
      if (creatorDaysError) throw creatorDaysError;
      const creatorDays = Number(creatorActiveDays || 0);
      const creatorConsistency = creatorDays >= 25 ? 1.3 : creatorDays >= 20 ? 1.2 : creatorDays >= 15 ? 1.1 : 1;
      const creatorPoints = parseFloat((Number(config.points_creator) * creatorMultiplier).toFixed(2));
      creatorEvent = {
        user_id: creatorId,
        related_user_id: userId,
        content_id: resolvedContentId,
        action_key: actionKey,
        points: creatorPoints,
        performance_points: Number(config.points_creator) * creatorMultiplier * diminishingMultiplier * creatorConsistency,
        metadata: {
          ...trackingMetadata,
          as_creator: true,
          tracking_key: trackingKey,
          consistency_multiplier: creatorConsistency,
          active_days: creatorDays,
        },
      };
    }

    const { data: committed, error: commitError } = await supabase.rpc('commit_reward_award', {
      p_tracking_user_id: userId,
      p_tracking_action_key: trackingKey,
      p_tracking_content_id: resolvedContentId,
      p_tracking_metadata: trackingMetadata,
      p_cycle_id: cycleId,
      p_actor_event: actorEvent,
      p_creator_event: creatorEvent,
    });
    if (commitError) throw new Error(`Atomic reward commit failed: ${commitError.message}`);
    if (committed?.already_tracked) {
      return new Response(JSON.stringify({ success: false, alreadyTracked: true, rewards: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rewards = committed?.rewards || [];
    const notifications: unknown[] = [];
    for (const reward of rewards) {
      const asCreator = reward?.metadata?.as_creator === true;
      const text = asCreator
        ? getCreatorNotificationText(actionKey, Number(reward.points || 0), resolvedTitle || 'seu conteúdo')
        : getNotificationText(actionKey, Number(reward.points || 0));
      const { data: notification, error: notificationError } = await supabase.from('notifications').insert({
        user_id: reward.user_id,
        type: 'reward',
        title: text.title,
        message: text.message,
        related_content_id: resolvedContentId,
        related_reward_id: reward.id,
      }).select().single();
      if (notificationError) console.error('Reward notification failed:', notificationError);
      if (notification) notifications.push(notification);
    }

    console.log('Rewards processed atomically:', { actionKey, trackingKey, rewardsCount: rewards.length });
    return new Response(JSON.stringify({ success: true, rewards, notifications }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error processing reward:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Notification text - NO R$ values (pool distributes monthly)
function formatPoints(points: number): string {
  return points % 1 === 0 ? points.toString() : points.toFixed(2);
}

function getNotificationText(actionKey: string, points: number): { title: string; message: string } {
  const p = formatPoints(points);
  switch (actionKey) {
    case 'DAILY_LOGIN':
      return { title: 'Login diário! 🎯', message: `Bem-vindo de volta! +${p} pontos de performance` };
    case 'WATCH_50':
      return { title: 'Bom progresso!', message: `Você já assistiu 50% do conteúdo. +${p} pontos de performance` };
    case 'WATCH_100':
      return { title: 'Conteúdo concluído! 🎉', message: `Parabéns! Você completou o conteúdo. +${p} pontos de performance` };
    case 'LIKE_CONTENT':
      return { title: 'Recompensa por curtir!', message: `+${p} pontos de performance por curtir o conteúdo` };
    case 'PROFILE_COMPLETE':
      return { title: 'Perfil completo! 🌟', message: `Seu perfil está completo! +${p} pontos de performance` };
    case 'SUBSCRIBE_CREATOR':
      return { title: 'Novo seguidor!', message: `+${p} pontos de performance por seguir um criador` };
    case 'WEEKLY_STREAK':
      return { title: 'Sequência semanal! 🔥', message: `Você completou uma sequência de 7 dias! +${p} pontos de performance` };
    default:
      return { title: 'Nova recompensa!', message: `+${p} pontos de performance` };
  }
}

function getCreatorNotificationText(actionKey: string, points: number, contentTitle: string): { title: string; message: string } {
  const p = formatPoints(points);
  switch (actionKey) {
    case 'CONTENT_APPROVED':
      return { title: 'Conteúdo aprovado! ✅', message: `Seu conteúdo "${contentTitle}" foi aprovado! +${p} pontos de performance` };
    case 'VIEW_15S':
      return { title: 'Nova visualização!', message: `Seu conteúdo "${contentTitle}" recebeu uma nova visualização. +${p} PP` };
    case 'WATCH_100':
      return { title: 'Conteúdo completado!', message: `Alguém completou "${contentTitle}"! +${p} PP` };
    case 'LIKE_CONTENT':
      return { title: 'Nova curtida! ❤️', message: `Seu conteúdo "${contentTitle}" recebeu uma curtida. +${p} PP` };
    default:
      return { title: 'Nova recompensa!', message: `+${p} pontos de performance pelo seu conteúdo` };
  }
}
