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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { actionKey, userId, contentId, metadata = {} }: RewardPayload = await req.json();

    console.log('Processing reward:', { actionKey, userId, contentId });

    // FRAUD PREVENTION: Check if action was already tracked
    const dailyActions = ['DAILY_LOGIN', 'FIRST_CONTENT_WEEK'];
    const uniqueActions = ['LIKE_CONTENT', 'SAVE_CONTENT', 'FAVORITE_CONTENT', 'WATCH_50', 'WATCH_100', 'COMPLETE_COURSE', 'COMMENT_CONTENT', 'CONTENT_APPROVED', 'FIRST_UPLOAD'];

    let fraudCheckQuery = supabase
      .from('reward_action_tracking')
      .select('id')
      .eq('user_id', userId)
      .eq('action_key', actionKey);

    if (dailyActions.includes(actionKey)) {
      // For daily actions, check if already done today
      const today = new Date().toISOString().split('T')[0];
      fraudCheckQuery = fraudCheckQuery.gte('created_at', `${today}T00:00:00Z`).lt('created_at', `${today}T23:59:59Z`);
    } else if (uniqueActions.includes(actionKey) && contentId) {
      // For unique actions per content, check if already done for this content
      fraudCheckQuery = fraudCheckQuery.eq('content_id', contentId);
    }

    const { data: existingTracking } = await fraudCheckQuery.maybeSingle();

    if (existingTracking) {
      console.log('Action already tracked, skipping reward:', { actionKey, userId, contentId });
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Action already rewarded',
          alreadyTracked: true 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get action config
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

    // Get user profile and plan
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

    // Process user reward (viewer/actor)
    if (config.points_user > 0 || config.value_user > 0) {
      const userPoints = Math.floor(config.points_user * planMultiplier);
      const userValue = parseFloat((config.value_user * planMultiplier).toFixed(2));

      const { data: userReward } = await supabase
        .from('reward_events')
        .insert({
          user_id: userId,
          related_user_id: creatorId,
          content_id: contentId,
          action_key: actionKey,
          points: userPoints,
          value: userValue,
          metadata,
        })
        .select()
        .single();

      if (userReward) {
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

        // Create notification based on action
        let notificationTitle = '';
        let notificationMessage = '';

        switch (actionKey) {
          case 'WATCH_50':
            notificationTitle = 'Bom progresso!';
            notificationMessage = `Você já assistiu 50% do conteúdo. Ganhou ${userPoints} pontos e R$ ${userValue.toFixed(2)}!`;
            break;
          case 'WATCH_100':
            notificationTitle = 'Conteúdo concluído! 🎉';
            notificationMessage = `Parabéns! Você completou o conteúdo e ganhou ${userPoints} pontos e R$ ${userValue.toFixed(2)}!`;
            break;
          case 'LIKE_CONTENT':
            notificationTitle = 'Recompensa por curtir!';
            notificationMessage = `Você ganhou ${userPoints} pontos e R$ ${userValue.toFixed(2)} por curtir o conteúdo!`;
            break;
          default:
            notificationTitle = 'Nova recompensa!';
            notificationMessage = `Você ganhou ${userPoints} pontos e R$ ${userValue.toFixed(2)}!`;
        }

        const { data: notification } = await supabase
          .from('notifications')
          .insert({
            user_id: userId,
            type: 'reward',
            title: notificationTitle,
            message: notificationMessage,
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

    // Process creator reward
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

      const { data: creatorReward } = await supabase
        .from('reward_events')
        .insert({
          user_id: creatorId,
          related_user_id: userId,
          content_id: contentId,
          action_key: actionKey,
          points: creatorPoints,
          value: creatorValue,
          metadata: { ...metadata, as_creator: true },
        })
        .select()
        .single();

      if (creatorReward) {
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

        // Get content title
        const { data: content } = await supabase
          .from('contents')
          .select('title')
          .eq('id', contentId)
          .single();

        const contentTitle = content?.title || 'seu conteúdo';

        // Create notification for creator
        let creatorNotificationTitle = '';
        let creatorNotificationMessage = '';

        switch (actionKey) {
          case 'CONTENT_APPROVED':
            creatorNotificationTitle = 'Conteúdo aprovado! ✅';
            creatorNotificationMessage = `Seu conteúdo "${contentTitle}" foi aprovado e você ganhou ${creatorPoints} pontos e R$ ${creatorValue.toFixed(2)}!`;
            break;
          case 'VIEW_15S':
            creatorNotificationTitle = 'Nova visualização!';
            creatorNotificationMessage = `Seu conteúdo "${contentTitle}" recebeu uma nova visualização. +${creatorPoints} pontos e R$ ${creatorValue.toFixed(2)}`;
            break;
          case 'WATCH_100':
            creatorNotificationTitle = 'Conteúdo completado!';
            creatorNotificationMessage = `Alguém completou "${contentTitle}"! Você ganhou ${creatorPoints} pontos e R$ ${creatorValue.toFixed(2)}`;
            break;
          case 'LIKE_CONTENT':
            creatorNotificationTitle = 'Nova curtida! ❤️';
            creatorNotificationMessage = `Seu conteúdo "${contentTitle}" recebeu uma curtida. +${creatorPoints} pontos e R$ ${creatorValue.toFixed(2)}`;
            break;
          default:
            creatorNotificationTitle = 'Nova recompensa!';
            creatorNotificationMessage = `Você ganhou ${creatorPoints} pontos e R$ ${creatorValue.toFixed(2)} pelo seu conteúdo!`;
        }

        const { data: creatorNotification } = await supabase
          .from('notifications')
          .insert({
            user_id: creatorId,
            type: 'reward',
            title: creatorNotificationTitle,
            message: creatorNotificationMessage,
            related_content_id: contentId,
            related_reward_id: creatorReward.id,
          })
          .select()
          .single();

        if (creatorNotification) {
          notifications.push(creatorNotification);
        }
      }
    }

    // FRAUD PREVENTION: Track this action
    await supabase
      .from('reward_action_tracking')
      .insert({
        user_id: userId,
        content_id: contentId || null,
        action_key: actionKey,
        metadata: metadata
      });

    console.log('Rewards processed:', rewards.length, 'notifications created:', notifications.length);

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
