import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 500;
const DEFAULT_MIN_PAYOUT = 0.10; // R$ 0.10 minimum to avoid micro-payments
const BUFFER_PERCENTAGE = 5; // 5% of PRM reserved as transition buffer
const SHARP_DROP_THRESHOLD = 0.40; // 40% drop in value-per-point triggers buffer usage

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

    // 1. Get or create the cycle
    let { data: cycle } = await supabase
      .from('economic_cycles')
      .select('*')
      .eq('year_month', targetYearMonth)
      .maybeSingle();

    if (!cycle) {
      console.log('No cycle found for', targetYearMonth, '- creating one...');
      const { data: newCycle, error: createError } = await supabase
        .from('economic_cycles')
        .insert({ year_month: targetYearMonth, pool_percentage: 40 })
        .select()
        .single();
      if (createError || !newCycle) {
        return new Response(
          JSON.stringify({ error: 'Failed to create cycle: ' + (createError?.message || 'unknown') }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
      cycle = newCycle;
    }

    if (cycle.status === 'closed') {
      return new Response(
        JSON.stringify({ error: 'Cycle already closed', cycle }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // 2. Guard against double-run: mark as 'distributing' before starting
    if (cycle.status === 'distributing') {
      console.log('Cycle already distributing — another process is running, aborting.');
      return new Response(
        JSON.stringify({ error: 'Cycle is already being distributed. Try again later.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
      );
    }

    await supabase
      .from('economic_cycles')
      .update({ status: 'distributing' })
      .eq('id', cycle.id);

    // 3. Fetch RBM and pool_percentage in parallel
    const [revenueResult, settingsResult] = await Promise.all([
      supabase.from('revenue_entries').select('amount').eq('year_month', targetYearMonth),
      supabase.from('platform_settings').select('value').eq('key', 'economic').single(),
    ]);

    const rbm = revenueResult.data?.reduce((sum, entry) => sum + parseFloat(String(entry.amount)), 0) || 0;
    const poolPercentage = settingsResult.data?.value?.pool_percentage || cycle.pool_percentage || 40;
    const minPayout: number = settingsResult.data?.value?.min_payout || DEFAULT_MIN_PAYOUT;
    const prm = rbm * (poolPercentage / 100);

    // 4. Count total PP across ALL users (paginated)
    let totalPP = 0;
    let offset = 0;
    let allCycleUsers: any[] = [];

    while (true) {
      const { data: batch, error: batchErr } = await supabase
        .from('economic_cycle_users')
        .select('*')
        .eq('cycle_id', cycle.id)
        .gt('performance_points', 0)
        .range(offset, offset + BATCH_SIZE - 1);

      if (batchErr) {
        console.error('Error fetching cycle users batch:', batchErr);
        break;
      }
      if (!batch || batch.length === 0) break;

      allCycleUsers = allCycleUsers.concat(batch);
      totalPP += batch.reduce((sum, u) => sum + parseFloat(String(u.performance_points)), 0);

      if (batch.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }

    console.log(`RBM: ${rbm}, Pool%: ${poolPercentage}, PRM: ${prm}, Total PP: ${totalPP}, Users: ${allCycleUsers.length}, Min payout: ${minPayout}`);

    // 4.5. Buffer & smoothing: separate 5% of PRM as transition buffer
    const bufferAmount = prm * (BUFFER_PERCENTAGE / 100);
    let effectivePRM = prm - bufferAmount;
    let bufferUsed = 0;

    // Check previous cycle for value-per-point comparison
    const cycleDate = new Date(`${targetYearMonth}-01`);
    const prevCycleDate = new Date(cycleDate.getFullYear(), cycleDate.getMonth() - 1, 1);
    const prevYearMonth = `${prevCycleDate.getFullYear()}-${String(prevCycleDate.getMonth() + 1).padStart(2, '0')}`;

    const { data: prevCycle } = await supabase
      .from('economic_cycles')
      .select('prm, total_performance_points')
      .eq('year_month', prevYearMonth)
      .eq('status', 'closed')
      .maybeSingle();

    if (prevCycle && prevCycle.total_performance_points > 0 && totalPP > 0) {
      const prevValuePerPoint = prevCycle.prm / prevCycle.total_performance_points;
      const currentValuePerPoint = effectivePRM / totalPP;
      const dropRatio = 1 - (currentValuePerPoint / prevValuePerPoint);

      console.log(`Value-per-point: prev=${prevValuePerPoint.toFixed(4)}, current=${currentValuePerPoint.toFixed(4)}, drop=${(dropRatio * 100).toFixed(1)}%`);

      if (dropRatio > SHARP_DROP_THRESHOLD) {
        // Use buffer to compensate up to 20% of the difference
        const deficit = (prevValuePerPoint - currentValuePerPoint) * totalPP;
        const maxCompensation = deficit * 0.20;
        bufferUsed = Math.min(bufferAmount, maxCompensation);
        effectivePRM += bufferUsed;
        console.log(`⚡ Sharp drop detected (${(dropRatio * 100).toFixed(1)}%), using buffer: R$ ${bufferUsed.toFixed(2)} of R$ ${bufferAmount.toFixed(2)}`);
      } else {
        // No sharp drop: redistribute buffer normally
        effectivePRM += bufferAmount;
        console.log('No sharp drop, buffer redistributed normally');
      }
    } else {
      // No previous cycle to compare: redistribute buffer normally
      effectivePRM += bufferAmount;
      console.log('No previous cycle for comparison, buffer redistributed normally');
    }

    let distributedAmount = 0;
    let usersPaid = 0;
    let usersCarriedOver = 0;
    const errors: string[] = [];

    if (totalPP > 0 && effectivePRM > 0 && allCycleUsers.length > 0) {
      // Determine next cycle for carry-over
      const nextCycleDate = new Date(cycleDate.getFullYear(), cycleDate.getMonth() + 1, 1);
      const nextYearMonth = `${nextCycleDate.getFullYear()}-${String(nextCycleDate.getMonth() + 1).padStart(2, '0')}`;

      // Get or create next cycle ID for carry-over
      let nextCycleId: string | null = null;

      for (const cycleUser of allCycleUsers) {
        const userPP = parseFloat(String(cycleUser.performance_points));
        const userShare = (userPP / totalPP) * effectivePRM;
        const roundedShare = parseFloat(userShare.toFixed(2));

        // Skip users below minimum payout — carry their points forward
        if (roundedShare < minPayout) {
          if (nextCycleId === null) {
            // Lazy-create next cycle
            const { data: nextCycle } = await supabase
              .from('economic_cycles')
              .select('id')
              .eq('year_month', nextYearMonth)
              .maybeSingle();

            if (nextCycle) {
              nextCycleId = nextCycle.id;
            } else {
              const { data: newNextCycle } = await supabase
                .from('economic_cycles')
                .insert({ year_month: nextYearMonth, pool_percentage: poolPercentage })
                .select('id')
                .single();
              nextCycleId = newNextCycle?.id ?? null;
            }
          }

          if (nextCycleId) {
            await supabase.rpc('carryover_cycle_points', {
              p_from_cycle_id: cycle.id,
              p_to_cycle_id: nextCycleId,
              p_min_payout: minPayout,
            }).then(() => { usersCarriedOver++; });
          }
          continue;
        }

        // Distribute atomically via RPC
        const { error: distErr } = await supabase.rpc('distribute_cycle_payout', {
          p_cycle_id: cycle.id,
          p_user_id: cycleUser.user_id,
          p_amount: roundedShare,
          p_year_month: targetYearMonth,
          p_user_pp: userPP,
          p_total_pp: totalPP,
        });

        if (distErr) {
          console.error(`Failed to distribute to user ${cycleUser.user_id}:`, distErr.message);
          errors.push(`${cycleUser.user_id}: ${distErr.message}`);
        } else {
          distributedAmount += roundedShare;
          usersPaid++;
        }
      }
    }

    // 5. Close the cycle
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

    // 6. Reconciliation: verify distributed_amount matches actual wallet_transactions
    const { data: txSumData } = await supabase
      .from('wallet_transactions')
      .select('amount')
      .eq('type', 'pool_distribution')
      .ilike('description', `%${targetYearMonth}%`);

    const actualDistributed = txSumData?.reduce((sum, tx) => sum + parseFloat(String(tx.amount)), 0) || 0;
    const discrepancy = Math.abs(actualDistributed - distributedAmount);

    if (discrepancy > 0.01) {
      console.warn(`⚠️ RECONCILIATION DISCREPANCY: Expected ${distributedAmount}, actual tx sum ${actualDistributed}, diff ${discrepancy}`);
    } else {
      console.log(`✅ Reconciliation OK: distributed ${distributedAmount}, tx sum ${actualDistributed}`);
    }

    const result = {
      success: true,
      year_month: targetYearMonth,
      rbm,
      pool_percentage: poolPercentage,
      prm,
      total_performance_points: totalPP,
      users_paid: usersPaid,
      users_carried_over: usersCarriedOver,
      distributed_amount: distributedAmount,
      reconciliation: {
        expected: distributedAmount,
        actual_tx_sum: actualDistributed,
        discrepancy,
        ok: discrepancy <= 0.01,
      },
      errors: errors.length > 0 ? errors : undefined,
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
