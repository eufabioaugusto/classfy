import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Autenticar usuário via JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { milestoneId, creatorId } = await req.json();

    if (!milestoneId || !creatorId) {
      return new Response(JSON.stringify({ error: 'milestoneId e creatorId são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Autorização: só o próprio creator pode resgatar o próprio milestone
    if (user.id !== creatorId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Buscar o milestone e verificar que está elegível
    const { data: milestone, error: msError } = await supabase
      .from('creator_milestones')
      .select('id, title, points_reward, milestone_type, milestone_value')
      .eq('id', milestoneId)
      .single();

    if (msError || !milestone) {
      return new Response(JSON.stringify({ error: 'Milestone não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Idempotência: verificar se já foi resgatado
    const { data: alreadyClaimed } = await supabase
      .from('reward_action_tracking')
      .select('id')
      .eq('user_id', creatorId)
      .eq('action_key', `CREATOR_MILESTONE_CLAIM_${milestoneId}`)
      .maybeSingle();

    if (alreadyClaimed) {
      return new Response(JSON.stringify({ success: false, alreadyClaimed: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Inserir tracking PRIMEIRO (UNIQUE garante atomicidade contra concorrência)
    const { error: trackingError } = await supabase
      .from('reward_action_tracking')
      .insert({
        user_id:    creatorId,
        action_key: `CREATOR_MILESTONE_CLAIM_${milestoneId}`,
        metadata:   { milestoneId, milestoneTitle: milestone.title },
      });

    if (trackingError) {
      // UNIQUE violation = outro request chegou ao mesmo tempo
      return new Response(JSON.stringify({ success: false, alreadyClaimed: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Obter ciclo atual
    const { data: cycleId } = await supabase.rpc('get_or_create_current_cycle');
    const ppAmount = milestone.points_reward;

    // Acumular PP atomicamente
    if (cycleId) {
      await supabase.rpc('increment_cycle_user_points', {
        p_cycle_id: cycleId,
        p_user_id:  creatorId,
        p_points:   ppAmount,
      });
    }

    // Registrar reward_event
    await supabase.from('reward_events').insert({
      user_id:            creatorId,
      action_key:         'CREATOR_MILESTONE_CLAIM',
      points:             ppAmount,
      value:              0,
      performance_points: ppAmount,
      cycle_id:           cycleId,
      metadata: {
        milestoneId,
        milestoneTitle: milestone.title,
        milestoneType:  milestone.milestone_type,
        milestoneValue: milestone.milestone_value,
      },
    });

    // Notificação
    await supabase.from('notifications').insert({
      user_id: creatorId,
      type:    'reward',
      title:   '🎉 Meta alcançada!',
      message: `Você resgatou "${milestone.title}" e ganhou +${ppAmount} PP no pool mensal!`,
    });

    console.log(`Milestone claimed: ${milestoneId} by creator ${creatorId.slice(0, 8)}, PP: ${ppAmount}`);

    return new Response(
      JSON.stringify({ success: true, performance_points: ppAmount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Error claiming milestone:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
