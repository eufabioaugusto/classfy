import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Sync View Milestones
 * 
 * This function checks all contents and processes any missing milestone rewards.
 * Should be called periodically (e.g., daily via cron) to catch any missed milestones.
 * 
 * Use case: If a milestone reward fails to process in real-time, this function
 * will catch it on the next sync run.
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting milestone sync...');

    const milestones = [
      { views: 100, actionKey: 'MILESTONE_100_VIEWS' },
      { views: 500, actionKey: 'MILESTONE_500_VIEWS' },
      { views: 1000, actionKey: 'MILESTONE_1000_VIEWS' },
      { views: 5000, actionKey: 'MILESTONE_5000_VIEWS' },
      { views: 10000, actionKey: 'MILESTONE_10000_VIEWS' },
    ];

    // Get all approved contents with views
    const { data: contents, error: contentsError } = await supabase
      .from('contents')
      .select('id, creator_id, views_count, title')
      .eq('status', 'approved')
      .gt('views_count', 0);

    if (contentsError) {
      throw contentsError;
    }

    console.log(`Checking ${contents?.length || 0} contents...`);

    let milestonesProcessed = 0;
    let errors = 0;

    for (const content of contents || []) {
      const currentViews = content.views_count || 0;

      for (const milestone of milestones) {
        // Skip if not reached yet
        if (currentViews < milestone.views) {
          continue;
        }

        // Check if already rewarded
        const { data: existingReward } = await supabase
          .from('reward_action_tracking')
          .select('id')
          .eq('user_id', content.creator_id)
          .eq('content_id', content.id)
          .eq('action_key', milestone.actionKey)
          .maybeSingle();

        if (!existingReward) {
          console.log(`Processing missing milestone: ${content.title} - ${milestone.actionKey}`);
          
          try {
            // Process reward
            const { error: rewardError } = await supabase.functions.invoke('process-reward', {
              body: {
                actionKey: milestone.actionKey,
                userId: content.creator_id,
                contentId: content.id,
                metadata: { 
                  views: currentViews,
                  syncedAt: new Date().toISOString(),
                  note: 'Processed by sync function'
                },
              },
            });

            if (rewardError) {
              console.error(`Error processing ${milestone.actionKey} for ${content.id}:`, rewardError);
              errors++;
            } else {
              milestonesProcessed++;
            }
          } catch (error) {
            console.error(`Exception processing ${milestone.actionKey} for ${content.id}:`, error);
            errors++;
          }

          // Small delay to avoid overwhelming the system
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    console.log('Sync complete:', { 
      contentsChecked: contents?.length || 0,
      milestonesProcessed,
      errors 
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        contentsChecked: contents?.length || 0,
        milestonesProcessed,
        errors,
        message: `Processed ${milestonesProcessed} missing milestones with ${errors} errors`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sync error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
