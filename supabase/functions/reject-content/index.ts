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

    console.log('Rejecting content:', contentId);

    // Get content details
    const { data: content, error: contentError } = await supabase
      .from('contents')
      .select('*, creator_id, title')
      .eq('id', contentId)
      .single();

    if (contentError || !content) {
      throw new Error('Content not found');
    }

    // Update content status to rejected using service role
    const { error: updateError } = await supabase
      .from('contents')
      .update({ status: 'rejected' })
      .eq('id', contentId);

    if (updateError) {
      console.error('Error updating content:', updateError);
      throw updateError;
    }

    console.log('Content rejected successfully');

    // Create notification for creator
    const { error: notificationError } = await supabase
      .from('notifications')
      .insert({
        user_id: content.creator_id,
        type: 'admin',
        title: 'Conteúdo Reprovado',
        message: `Seu conteúdo "${content.title}" foi reprovado pela moderação.`,
        related_content_id: contentId,
        is_read: false
      });

    if (notificationError) {
      console.error('Error creating notification:', notificationError);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Content rejected successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
