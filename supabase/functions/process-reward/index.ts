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
  'COMMENT_CONTENT'
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { actionKey, userId, contentId, metadata = {} }: RewardPayload = await req.json();

    // Validate required fields
    if (!actionKey || !userId) {
      console.error('Missing required fields:', { actionKey, userId });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: actionKey and userId' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log('Processing reward request:', { actionKey, userId: userId.slice(0, 8) + '...', hasContent: !!contentId });

    // STEP 1: ATOMIC FRAUD PREVENTION - Insert tracking FIRST with unique constraint check
    // This prevents race conditions by using database-level uniqueness
    const today = new Date().toISOString().split('T')[0];
    
    let trackingKey: string;
    let trackingMetadata: Record<string, any> = { ...metadata };
    
    if (DAILY_ACTIONS.includes(actionKey)) {
      // For daily actions, include date in the key
      trackingKey = `${actionKey}_${today}`;
      trackingMetadata.tracking_date = today;
    } else if (UNIQUE_PER_CONTENT_ACTIONS.includes(actionKey)) {
      // For per-content actions, include content_id
      trackingKey = contentId ? `${actionKey}_${contentId}` : actionKey;
    } else if (ONE_TIME_ACTIONS.includes(actionKey)) {
      // For one-time actions, just the action key
      trackingKey = actionKey;
    } else if (UNIQUE_PER_CONTENT_GLOBAL.includes(actionKey)) {
      // For per-content global actions
      trackingKey = contentId ? `${actionKey}_${contentId}` : actionKey;
    } else {
      // For other actions (like SUBSCRIBE_CREATOR), use metadata to create unique key
      const creatorId = metadata?.creatorId;
      trackingKey = creatorId ? `${actionKey}_${creatorId}` : actionKey;
    }

    // Try to insert tracking record FIRST - this is the atomic lock
    // If it fails due to existing record, we skip the reward
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

    // Check if this specific action was already tracked
    if (existingTracking && existingTracking.length > 0) {
      console.log('Action already tracked, skipping reward:', { actionKey, trackingKey });
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Action already rewarded',
          alreadyTracked: true,
          trackedAt: existingTracking[0].created_at
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert tracking record BEFORE processing reward (atomic lock)
    const { error: insertTrackingError } = await supabase
      .from('reward_action_tracking')
      .insert({
        user_id: userId,
        content_id: contentId || null,
        action_key: trackingKey,
        metadata: trackingMetadata
      });

    if (insertTrackingError) {
      // If insert fails (likely duplicate), another request beat us
      console.log('Tracking insert failed (likely duplicate):', insertTrackingError.message);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Action already being processed or was already rewarded',
          alreadyTracked: true 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Tracking record created, proceeding with reward:', { trackingKey });

    // STEP 2: Get action config
    const { data: config, error: configError } = await supabase
      .from('reward_actions_config')
      .select('*')
      .eq('action_key', actionKey)
      .eq('active', true)
      .single();

    if (configError || !config) {
      console.error('Action config not found or inactive:', actionKey);
      // Don't delete tracking - the action was still performed, just not rewarded
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

    let creatorId: string | null = null;

    // Get creator if content is involved
    if (contentId) {
      const { data: content } = await supabase
        .from('contents')
        .select('creator_id')
        .eq('id', contentId)
        .single();

      creatorId = content?.creator_id || null;
    }

    const rewards = [];
    const notifications = [];

    // STEP 4: Process user reward (viewer/actor)
    if (config.points_user > 0 || config.value_user > 0) {
      const userPoints = Math.floor(config.points_user * planMultiplier);
      const userValue = parseFloat((config.value_user * planMultiplier).toFixed(2));

      const { data: userReward, error: rewardError } = await supabase
        .from('reward_events')
        .insert({
          user_id: userId,
          related_user_id: creatorId,
          content_id: contentId,
          action_key: actionKey,
          points: userPoints,
          value: userValue,
          metadata: { ...metadata, tracking_key: trackingKey },
        })
        .select()
        .single();

      if (rewardError) {
        console.error('Error inserting user reward:', rewardError);
      } else if (userReward) {
        rewards.push(userReward);

        // Update wallet
        const { data: wallet } = await supabase
          .from('wallets')
          .select('balance, total_earned')
          .eq('user_id', userId)
          .single();

        if (wallet) {
          await supabase
            .from('wallets')
            .update({
              balance: parseFloat(wallet.balance) + userValue,
              total_earned: parseFloat(wallet.total_earned) + userValue,
            })
            .eq('user_id', userId);
        }

        // Create notification
        const notificationData = getNotificationText(actionKey, userPoints, userValue);
        
        const { data: notification } = await supabase
          .from('notifications')
          .insert({
            user_id: userId,
            type: 'reward',
            title: notificationData.title,
            message: notificationData.message,
            related_content_id: contentId,
            related_reward_id: userReward.id,
          })
          .select()
          .single();

        if (notification) {
          notifications.push(notification);
        }
      }
    }

    // STEP 5: Process creator reward (if applicable)
    if (creatorId && creatorId !== userId && (config.points_creator > 0 || config.value_creator > 0)) {
      const { data: creatorProfile } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', creatorId)
        .single();

      const creatorPlan = (creatorProfile?.plan || 'free') as keyof PlanMultipliers;
      const creatorMultiplier = PLAN_MULTIPLIERS[creatorPlan] || 1.0;

      const creatorPoints = Math.floor(config.points_creator * creatorMultiplier);
      const creatorValue = parseFloat((config.value_creator * creatorMultiplier).toFixed(2));

      const { data: creatorReward, error: creatorRewardError } = await supabase
        .from('reward_events')
        .insert({
          user_id: creatorId,
          related_user_id: userId,
          content_id: contentId,
          action_key: actionKey,
          points: creatorPoints,
          value: creatorValue,
          metadata: { ...metadata, as_creator: true, tracking_key: trackingKey },
        })
        .select()
        .single();

      if (creatorRewardError) {
        console.error('Error inserting creator reward:', creatorRewardError);
      } else if (creatorReward) {
        rewards.push(creatorReward);

        // Update creator wallet
        const { data: creatorWallet } = await supabase
          .from('wallets')
          .select('balance, total_earned')
          .eq('user_id', creatorId)
          .single();

        if (creatorWallet) {
          await supabase
            .from('wallets')
            .update({
              balance: parseFloat(creatorWallet.balance) + creatorValue,
              total_earned: parseFloat(creatorWallet.total_earned) + creatorValue,
            })
            .eq('user_id', creatorId);
        }

        // Get content title for notification
        const { data: content } = await supabase
          .from('contents')
          .select('title')
          .eq('id', contentId)
          .single();

        const contentTitle = content?.title || 'seu conteúdo';
        const creatorNotification = getCreatorNotificationText(actionKey, creatorPoints, creatorValue, contentTitle);

        const { data: notification } = await supabase
          .from('notifications')
          .insert({
            user_id: creatorId,
            type: 'reward',
            title: creatorNotification.title,
            message: creatorNotification.message,
            related_content_id: contentId,
            related_reward_id: creatorReward.id,
          })
          .select()
          .single();

        if (notification) {
          notifications.push(notification);
        }
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

function getNotificationText(actionKey: string, points: number, value: number): { title: string; message: string } {
  const valueStr = value.toFixed(2);
  
  switch (actionKey) {
    case 'DAILY_LOGIN':
      return {
        title: 'Login diário! 🎯',
        message: `Bem-vindo de volta! Você ganhou ${points} pontos e R$ ${valueStr}!`
      };
    case 'WATCH_50':
      return {
        title: 'Bom progresso!',
        message: `Você já assistiu 50% do conteúdo. Ganhou ${points} pontos e R$ ${valueStr}!`
      };
    case 'WATCH_100':
      return {
        title: 'Conteúdo concluído! 🎉',
        message: `Parabéns! Você completou o conteúdo e ganhou ${points} pontos e R$ ${valueStr}!`
      };
    case 'LIKE_CONTENT':
      return {
        title: 'Recompensa por curtir!',
        message: `Você ganhou ${points} pontos e R$ ${valueStr} por curtir o conteúdo!`
      };
    case 'PROFILE_COMPLETE':
      return {
        title: 'Perfil completo! 🌟',
        message: `Seu perfil está completo! Você ganhou ${points} pontos e R$ ${valueStr}!`
      };
    case 'SUBSCRIBE_CREATOR':
      return {
        title: 'Novo seguidor!',
        message: `Você ganhou ${points} pontos e R$ ${valueStr} por seguir um criador!`
      };
    default:
      return {
        title: 'Nova recompensa!',
        message: `Você ganhou ${points} pontos e R$ ${valueStr}!`
      };
  }
}

function getCreatorNotificationText(actionKey: string, points: number, value: number, contentTitle: string): { title: string; message: string } {
  const valueStr = value.toFixed(2);
  
  switch (actionKey) {
    case 'CONTENT_APPROVED':
      return {
        title: 'Conteúdo aprovado! ✅',
        message: `Seu conteúdo "${contentTitle}" foi aprovado e você ganhou ${points} pontos e R$ ${valueStr}!`
      };
    case 'VIEW_15S':
      return {
        title: 'Nova visualização!',
        message: `Seu conteúdo "${contentTitle}" recebeu uma nova visualização. +${points} pontos e R$ ${valueStr}`
      };
    case 'WATCH_100':
      return {
        title: 'Conteúdo completado!',
        message: `Alguém completou "${contentTitle}"! Você ganhou ${points} pontos e R$ ${valueStr}`
      };
    case 'LIKE_CONTENT':
      return {
        title: 'Nova curtida! ❤️',
        message: `Seu conteúdo "${contentTitle}" recebeu uma curtida. +${points} pontos e R$ ${valueStr}`
      };
    default:
      return {
        title: 'Nova recompensa!',
        message: `Você ganhou ${points} pontos e R$ ${valueStr} pelo seu conteúdo!`
      };
  }
}