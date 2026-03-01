import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Allow CRON (no auth) or admin users
    const authHeader = req.headers.get('Authorization');
    if (authHeader && !authHeader.includes('anon')) {
      const authClient = createClient(supabaseUrl, supabaseAnonKey);
      const { data: { user }, error: authError } = await authClient.auth.getUser(
        authHeader.replace('Bearer ', '')
      );
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        );
      }
      // Check admin role
      const adminClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: roleData } = await adminClient
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();
      if (!roleData) {
        return new Response(
          JSON.stringify({ error: 'Admin access required' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
      console.log('Manual trigger by admin:', user.id);
    } else {
      console.log('CRON trigger (no auth or anon key)');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Determine which month to close (default: previous month)
    const body = await req.json().catch(() => ({}));
    let targetYearMonth = body.year_month;

    if (!targetYearMonth) {
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      targetYearMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    }

    console.log(`Closing economic cycle for: ${targetYearMonth}`);

    // 1. Get or verify the cycle exists
    const { data: cycle, error: cycleError } = await supabase
      .from('economic_cycles')
      .select('*')
      .eq('year_month', targetYearMonth)
      .single();

    if (cycleError || !cycle) {
      console.log('No cycle found for', targetYearMonth);
      return new Response(
        JSON.stringify({ error: 'No cycle found for ' + targetYearMonth }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    if (cycle.status === 'closed') {
      console.log('Cycle already closed:', targetYearMonth);
      return new Response(
        JSON.stringify({ error: 'Cycle already closed', cycle }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // 2. Calculate RBM from revenue_entries
    const { data: revenueData } = await supabase
      .from('revenue_entries')
      .select('amount')
      .eq('year_month', targetYearMonth);

    const rbm = revenueData?.reduce((sum, entry) => sum + parseFloat(String(entry.amount)), 0) || 0;

    // 3. Get pool_percentage from platform_settings
    const { data: settings } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'economic')
      .single();

    const poolPercentage = settings?.value?.pool_percentage || cycle.pool_percentage || 40;

    // 4. Calculate PRM
    const prm = rbm * (poolPercentage / 100);

    // 5. Get all users with performance points in this cycle
    const { data: cycleUsers } = await supabase
      .from('economic_cycle_users')
      .select('*')
      .eq('cycle_id', cycle.id)
      .gt('performance_points', 0);

    const totalPP = cycleUsers?.reduce((sum, u) => sum + parseFloat(String(u.performance_points)), 0) || 0;

    console.log(`RBM: ${rbm}, Pool%: ${poolPercentage}, PRM: ${prm}, Total PP: ${totalPP}, Users: ${cycleUsers?.length || 0}`);

    let distributedAmount = 0;

    if (totalPP > 0 && prm > 0 && cycleUsers && cycleUsers.length > 0) {
      // 6. Calculate each user's share and credit wallet
      for (const cycleUser of cycleUsers) {
        const userPP = parseFloat(String(cycleUser.performance_points));
        const userShare = (userPP / totalPP) * prm;
        const roundedShare = parseFloat(userShare.toFixed(2));

        if (roundedShare <= 0) continue;

        // Update calculated_share
        await supabase
          .from('economic_cycle_users')
          .update({
            calculated_share: roundedShare,
            payout_status: 'paid',
          })
          .eq('id', cycleUser.id);

        // Credit wallet
        const { data: wallet } = await supabase
          .from('wallets')
          .select('balance, total_earned')
          .eq('user_id', cycleUser.user_id)
          .single();

        if (wallet) {
          await supabase
            .from('wallets')
            .update({
              balance: parseFloat(String(wallet.balance)) + roundedShare,
              total_earned: parseFloat(String(wallet.total_earned)) + roundedShare,
            })
            .eq('user_id', cycleUser.user_id);
        }

        // Record wallet transaction (wallet_transactions uses wallet_id)
        const { data: walletRecord } = await supabase
          .from('wallets')
          .select('id')
          .eq('user_id', cycleUser.user_id)
          .single();

        if (walletRecord) {
          await supabase
            .from('wallet_transactions')
            .insert({
              wallet_id: walletRecord.id,
              type: 'pool_distribution',
              amount: roundedShare,
              description: `Distribuição do pool - ${targetYearMonth}`,
            });
        }

        // Notify user
        await supabase
          .from('notifications')
          .insert({
            user_id: cycleUser.user_id,
            type: 'reward',
            title: '💰 Recompensa Mensal!',
            message: `Você recebeu R$ ${roundedShare.toFixed(2)} referente ao pool de recompensas de ${targetYearMonth}. Seus ${userPP.toFixed(0)} pontos de performance representaram ${((userPP / totalPP) * 100).toFixed(1)}% do pool.`,
          });

        distributedAmount += roundedShare;
      }
    }

    // 7. Close the cycle
    await supabase
      .from('economic_cycles')
      .update({
        rbm,
        pool_percentage: poolPercentage,
        prm,
        total_performance_points: totalPP,
        distributed_amount: distributedAmount,
        status: 'closed',
        closed_at: new Date().toISOString(),
      })
      .eq('id', cycle.id);

    const result = {
      success: true,
      year_month: targetYearMonth,
      rbm,
      pool_percentage: poolPercentage,
      prm,
      total_performance_points: totalPP,
      users_paid: cycleUsers?.length || 0,
      distributed_amount: distributedAmount,
    };

    console.log('Cycle closed successfully:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error closing cycle:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
