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

const PLAN_MULTIPLIERS: PlanMultipliers = {
  free: 1.0,
  pro: 1.1,
  premium: 1.25,
};

// Actions that can only be rewarded once per day
const DAILY_ACTIONS = ['DAILY_LOGIN', 'FIRST_CONTENT_WEEK'];

// Actions that can only be rewarded once per content per user
const UNIQUE_PER_CONTENT_ACTIONS = [
  'LIKE_CONTENT', 
  'SAVE_CONTENT', 
  'FAVORITE_CONTENT', 
  'WATCH_50', 
  'WATCH_100', 
  'COMMENT_CONTENT',
  'VIEW_15S'
];

// Actions that can only be rewarded once ever per user
const ONE_TIME_ACTIONS = [
  'PROFILE_COMPLETE', 
  'FIRST_UPLOAD'
];

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
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { actionKey, userId, contentId, metadata = {} }: RewardPayload = await req.json();

    if (!actionKey || !userId) {
      console.error('Missing required fields:', { actionKey, userId });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: actionKey and userId' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
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
    const today = new Date().toISOString().split('T')[0];
    let trackingKey: string;
    let trackingMetadata: Record<string, any> = { ...metadata };

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

    // Insert tracking record (atomic lock)
    const { error: insertTrackingError } = await supabase
      .from('reward_action_tracking')
      .insert({
        user_id: userId,
        content_id: resolvedContentId,
        action_key: trackingKey,
        metadata: trackingMetadata,
      });

    if (insertTrackingError) {
      console.log('Tracking insert failed:', insertTrackingError.message);
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Action already being processed or was already rewarded',
          alreadyTracked: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Tracking record created, proceeding with reward:', { trackingKey });

    // ──────────────────────────────────────────
    // ANTI-FRAUD: Daily limit & diminishing returns check
    // ──────────────────────────────────────────
    let diminishingMultiplier = 1.0;
    const dailyLimit = DAILY_ACTION_LIMITS[actionKey];
    
    if (dailyLimit) {
      // Count how many times this action was used today by this user
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      
      const { count: dailyCount } = await supabase
        .from('reward_action_tracking')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .like('action_key', `${actionKey}%`)
        .gte('created_at', todayStart.toISOString());

      const currentCount = dailyCount || 0;
      console.log('Daily action count:', { actionKey, currentCount, dailyLimit });

      if (currentCount > dailyLimit) {
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

    // STEP 3: Get user profile and plan
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', userId)
      .single();

    const userPlan = (userProfile?.plan || 'free') as keyof PlanMultipliers;
    const planMultiplier = PLAN_MULTIPLIERS[userPlan] || 1.0;

    // STEP 4: Get or create current economic cycle
    const { data: cycleIdResult } = await supabase.rpc('get_or_create_current_cycle');
    const cycleId = cycleIdResult as string | null;

    const rewards = [];
    const notifications = [];

    // STEP 5: Process user reward (viewer/actor)
    // XP (points) still credited instantly for gamification
    // Performance Points accumulated in economic_cycle_users (NO direct wallet credit)
    if (config.points_user > 0 || config.value_user > 0) {
      const userPoints = Math.floor(config.points_user * planMultiplier);
      // Performance points with diminishing returns applied
      const performancePoints = config.points_user * planMultiplier * diminishingMultiplier;

      const { data: userReward, error: rewardError } = await supabase
        .from('reward_events')
        .insert({
          user_id: userId,
          related_user_id: creatorId,
          content_id: resolvedContentId,
          action_key: actionKey,
          points: userPoints,
          value: 0, // No direct value anymore - pool distributes later
          performance_points: performancePoints,
          cycle_id: cycleId,
          metadata: { ...trackingMetadata, tracking_key: trackingKey },
        })
        .select()
        .single();

      if (rewardError) {
        console.error('Error inserting user reward:', rewardError);
      } else if (userReward) {
        rewards.push(userReward);

        // Accumulate performance points in economic_cycle_users
        if (cycleId) {
          await upsertCycleUserPoints(supabase, cycleId, userId, performancePoints);
        }

        // Create notification (no R$ value shown - only points)
        const notificationData = getNotificationText(actionKey, userPoints);
        const { data: notification } = await supabase
          .from('notifications')
          .insert({
            user_id: userId,
            type: 'reward',
            title: notificationData.title,
            message: notificationData.message,
            related_content_id: resolvedContentId,
            related_reward_id: userReward.id,
          })
          .select()
          .single();

        if (notification) notifications.push(notification);
      }
    }

    // STEP 6: Process creator reward (if applicable)
    if (creatorId && creatorId !== userId && (config.points_creator > 0 || config.value_creator > 0)) {
      const { data: creatorProfile } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', creatorId)
        .single();

      const creatorPlan = (creatorProfile?.plan || 'free') as keyof PlanMultipliers;
      const creatorMultiplier = PLAN_MULTIPLIERS[creatorPlan] || 1.0;

      const creatorPoints = Math.floor(config.points_creator * creatorMultiplier);
      const creatorPP = config.points_creator * creatorMultiplier * diminishingMultiplier;

      const { data: creatorReward, error: creatorRewardError } = await supabase
        .from('reward_events')
        .insert({
          user_id: creatorId,
          related_user_id: userId,
          content_id: resolvedContentId,
          action_key: actionKey,
          points: creatorPoints,
          value: 0, // No direct value - pool distributes
          performance_points: creatorPP,
          cycle_id: cycleId,
          metadata: { ...trackingMetadata, as_creator: true, tracking_key: trackingKey },
        })
        .select()
        .single();

      if (creatorRewardError) {
        console.error('Error inserting creator reward:', creatorRewardError);
      } else if (creatorReward) {
        rewards.push(creatorReward);

        // Accumulate PP for creator
        if (cycleId) {
          await upsertCycleUserPoints(supabase, cycleId, creatorId, creatorPP);
        }

        const creatorNotification = getCreatorNotificationText(
          actionKey,
          creatorPoints,
          resolvedTitle || 'seu conteúdo'
        );

        const { data: notification } = await supabase
          .from('notifications')
          .insert({
            user_id: creatorId,
            type: 'reward',
            title: creatorNotification.title,
            message: creatorNotification.message,
            related_content_id: resolvedContentId,
            related_reward_id: creatorReward.id,
          })
          .select()
          .single();

        if (notification) notifications.push(notification);
      }
    }

    console.log('Rewards processed successfully:', { 
      actionKey, 
      trackingKey,
      rewardsCount: rewards.length, 
      notificationsCount: notifications.length 
    });

    return new Response(
      JSON.stringify({ success: true, rewards, notifications }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing reward:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Upsert performance points for a user in the current cycle
async function upsertCycleUserPoints(
  supabase: ReturnType<typeof createClient>,
  cycleId: string,
  userId: string,
  points: number
) {
  try {
    // Try to find existing record
    const { data: existing } = await supabase
      .from('economic_cycle_users')
      .select('id, performance_points')
      .eq('cycle_id', cycleId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('economic_cycle_users')
        .update({
          performance_points: parseFloat(String(existing.performance_points)) + points,
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('economic_cycle_users')
        .insert({
          cycle_id: cycleId,
          user_id: userId,
          performance_points: points,
        });
    }
  } catch (err) {
    console.error('Error upserting cycle user points:', err);
  }
}

// Notification text - NO R$ values (pool distributes monthly)
function getNotificationText(actionKey: string, points: number): { title: string; message: string } {
  switch (actionKey) {
    case 'DAILY_LOGIN':
      return {
        title: 'Login diário! 🎯',
        message: `Bem-vindo de volta! +${points} pontos de performance`
      };
    case 'WATCH_50':
      return {
        title: 'Bom progresso!',
        message: `Você já assistiu 50% do conteúdo. +${points} pontos de performance`
      };
    case 'WATCH_100':
      return {
        title: 'Conteúdo concluído! 🎉',
        message: `Parabéns! Você completou o conteúdo. +${points} pontos de performance`
      };
    case 'LIKE_CONTENT':
      return {
        title: 'Recompensa por curtir!',
        message: `+${points} pontos de performance por curtir o conteúdo`
      };
    case 'PROFILE_COMPLETE':
      return {
        title: 'Perfil completo! 🌟',
        message: `Seu perfil está completo! +${points} pontos de performance`
      };
    case 'SUBSCRIBE_CREATOR':
      return {
        title: 'Novo seguidor!',
        message: `+${points} pontos de performance por seguir um criador`
      };
    default:
      return {
        title: 'Nova recompensa!',
        message: `+${points} pontos de performance`
      };
  }
}

function getCreatorNotificationText(actionKey: string, points: number, contentTitle: string): { title: string; message: string } {
  switch (actionKey) {
    case 'CONTENT_APPROVED':
      return {
        title: 'Conteúdo aprovado! ✅',
        message: `Seu conteúdo "${contentTitle}" foi aprovado! +${points} pontos de performance`
      };
    case 'VIEW_15S':
      return {
        title: 'Nova visualização!',
        message: `Seu conteúdo "${contentTitle}" recebeu uma nova visualização. +${points} PP`
      };
    case 'WATCH_100':
      return {
        title: 'Conteúdo completado!',
        message: `Alguém completou "${contentTitle}"! +${points} PP`
      };
    case 'LIKE_CONTENT':
      return {
        title: 'Nova curtida! ❤️',
        message: `Seu conteúdo "${contentTitle}" recebeu uma curtida. +${points} PP`
      };
    default:
      return {
        title: 'Nova recompensa!',
        message: `+${points} pontos de performance pelo seu conteúdo`
      };
  }
}
