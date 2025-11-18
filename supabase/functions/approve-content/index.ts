import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Check if user is admin
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!roles) {
      throw new Error('User is not admin');
    }

    const { contentId } = await req.json();

    if (!contentId) {
      throw new Error('Content ID is required');
    }

    console.log('Approving content:', contentId);

    // Get content details
    const { data: content, error: contentError } = await supabase
      .from('contents')
      .select('*, creator_id, title')
      .eq('id', contentId)
      .single();

    if (contentError || !content) {
      throw new Error('Content not found');
    }

    // Update content status to approved using service role
    const { error: updateError } = await supabase
      .from('contents')
      .update({ 
        status: 'approved',
        published_at: new Date().toISOString()
      })
      .eq('id', contentId);

    if (updateError) {
      console.error('Error updating content:', updateError);
      throw updateError;
    }

    console.log('Content approved successfully');

    // Process reward for content approval
    const { data: rewardData, error: rewardError } = await supabase.functions.invoke('process-reward', {
      body: {
        actionKey: 'CONTENT_APPROVED',
        userId: content.creator_id,
        contentId: contentId,
        metadata: { content_title: content.title }
      }
    });

    if (rewardError) {
      console.error('Error processing reward:', rewardError);
    } else {
      console.log('Reward processed:', rewardData);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Content approved successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
