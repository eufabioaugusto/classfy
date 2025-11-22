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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { contentId, creatorId } = await req.json();

    console.log('Checking milestones for content:', { contentId, creatorId });

    // Get current views count from content
    const { data: contentData, error: contentError } = await supabase
      .from('contents')
      .select('views_count')
      .eq('id', contentId)
      .single();

    if (contentError) {
      console.error('Error fetching content:', contentError);
      throw contentError;
    }

    const currentViews = contentData.views_count || 0;
    console.log('Current views:', currentViews);

    const milestones = [
      { views: 100, actionKey: 'MILESTONE_100_VIEWS' },
      { views: 500, actionKey: 'MILESTONE_500_VIEWS' },
      { views: 1000, actionKey: 'MILESTONE_1000_VIEWS' },
      { views: 5000, actionKey: 'MILESTONE_5000_VIEWS' },
      { views: 10000, actionKey: 'MILESTONE_10000_VIEWS' },
    ];

    // Check each milestone
    for (const milestone of milestones) {
      if (currentViews >= milestone.views) {
        // Check if milestone was already rewarded
        const { data: existingReward } = await supabase
          .from('reward_action_tracking')
          .select('id')
          .eq('user_id', creatorId)
          .eq('content_id', contentId)
          .eq('action_key', milestone.actionKey)
          .maybeSingle();

        if (!existingReward) {
          console.log(`Milestone reached: ${milestone.actionKey}`);
          
          // Process reward via process-reward function
          const { error: rewardError } = await supabase.functions.invoke('process-reward', {
            body: {
              actionKey: milestone.actionKey,
              userId: creatorId,
              contentId: contentId,
              metadata: { views: currentViews },
            },
          });

          if (rewardError) {
            console.error(`Error processing reward for ${milestone.actionKey}:`, rewardError);
          }
        } else {
          console.log(`Milestone ${milestone.actionKey} already rewarded`);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, views: currentViews }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
