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
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!serviceKey || req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
      return new Response(
        JSON.stringify({ error: 'Service authorization required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceKey
    );

    const { revenue_type, amount, source_id, user_id, metadata } = await req.json();

    const numericAmount = Number(amount);
    const allowedRevenueTypes = new Set([
      'subscription_pro', 'subscription_premium', 'content_purchase', 'boost', 'other',
    ]);
    if (!allowedRevenueTypes.has(revenue_type) || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return new Response(
        JSON.stringify({ error: 'Valid revenue_type and positive amount are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const now = new Date();
    const year_month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Idempotência: se source_id já existe, retorna o registro existente sem inserir de novo
    if (source_id) {
      const { data: existing } = await supabase
        .from('revenue_entries')
        .select()
        .eq('source_id', source_id)
        .maybeSingle();

      if (existing) {
        console.log('Revenue already recorded for source_id:', source_id);
        return new Response(
          JSON.stringify({ success: true, data: existing, idempotent: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const { data, error } = await supabase
      .from('revenue_entries')
      .insert({
        year_month,
        revenue_type,
        amount: numericAmount,
        source_id: source_id || null,
        user_id: user_id || null,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (error) {
      // unique_violation = race entre dois requests com mesmo source_id → idempotente
      if ((error as any).code === '23505') {
        console.log('Duplicate revenue entry blocked by UNIQUE constraint for source_id:', source_id);
        return new Response(
          JSON.stringify({ success: true, idempotent: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.error('Error recording revenue:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log('Revenue recorded:', { revenue_type, amount: numericAmount, year_month, source_id });

    return new Response(
      JSON.stringify({ success: true, data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
