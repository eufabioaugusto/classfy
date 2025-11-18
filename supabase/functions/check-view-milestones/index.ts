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

    const { contentId, creatorId, newViews, oldViews } = await req.json();

    console.log('Checking milestones:', { contentId, creatorId, newViews, oldViews });

    const milestones = [
      { views: 100, actionKey: 'MILESTONE_100_VIEWS' },
      { views: 500, actionKey: 'MILESTONE_500_VIEWS' },
      { views: 1000, actionKey: 'MILESTONE_1000_VIEWS' },
    ];

    for (const milestone of milestones) {
      // Check if milestone was just crossed
      if (oldViews < milestone.views && newViews >= milestone.views) {
        console.log(`Milestone reached: ${milestone.actionKey}`);
        
        // Process reward via process-reward function
        await supabase.functions.invoke('process-reward', {
          body: {
            actionKey: milestone.actionKey,
            userId: creatorId,
            contentId: contentId,
            metadata: { views: newViews },
          },
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
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
