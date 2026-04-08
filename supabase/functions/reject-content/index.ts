import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1'
import { emailCard, ctaButton, sendEmail } from '../_shared/email-template.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

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

    const { contentId, itemType = 'content' } = await req.json();

    if (!contentId) {
      throw new Error('Content ID is required');
    }

    console.log('Rejecting item:', contentId, 'type:', itemType);

    const tableName = itemType === 'course' ? 'courses' : 'contents';

    // Get item details
    const { data: content, error: contentError } = await supabase
      .from(tableName)
      .select('*, creator_id, title')
      .eq('id', contentId)
      .single();

    if (contentError || !content) {
      throw new Error(`${itemType} not found`);
    }

    // Update item status to rejected using service role
    const { error: updateError } = await supabase
      .from(tableName)
      .update({ status: 'rejected' })
      .eq('id', contentId);

    if (updateError) {
      console.error('Error updating item:', updateError);
      throw updateError;
    }

    console.log(`${itemType} rejected successfully`);

    // Create notification for creator
    const itemLabel = itemType === 'course' ? 'curso' : 'conteúdo';
    const { error: notificationError } = await supabase
      .from('notifications')
      .insert({
        user_id: content.creator_id,
        type: 'admin',
        title: itemType === 'course' ? 'Curso Reprovado ❌' : 'Conteúdo Reprovado ❌',
        message: `Seu ${itemLabel} "${content.title}" foi reprovado pela moderação. Entre em contato para mais detalhes.`,
        related_content_id: contentId,
        is_read: false
      });

    if (notificationError) {
      console.error('Error creating notification:', notificationError);
    } else {
      console.log('Rejection notification created successfully');
    }

    // Send email notification to creator
    try {
      const { data: creatorAuth } = await supabase.auth.admin.getUserById(content.creator_id);
      const { data: creatorProfile } = await supabase.from('profiles').select('display_name').eq('id', content.creator_id).single();
      if (creatorAuth?.user?.email) {
        const name = creatorProfile?.display_name || creatorAuth.user.email.split('@')[0];
        const itemLabel = itemType === 'course' ? 'curso' : 'conteúdo';
        const subject = `Conteúdo não aprovado — Classfy`;
        const html = emailCard(subject, `Seu ${itemLabel} "${content.title}" precisa de ajustes`, `
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Conteúdo não aprovado</h1>
          <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
            Olá, <strong>${name}</strong>. Seu ${itemLabel} <strong>"${content.title}"</strong> foi analisado e não pôde ser aprovado pela moderação.
          </p>
          <div style="margin:20px 0;padding:16px;background:#f4f4f5;border-radius:8px;border-left:3px solid #dc2626;">
            <p style="margin:0;font-size:14px;color:#52525b;line-height:1.6;">
              Entre em contato com nosso suporte para entender o motivo e como ajustar seu conteúdo para uma nova submissão.
            </p>
          </div>
          ${ctaButton('Ir para o Studio', 'https://app.classfy.com.br/studio/contents')}
          <p style="margin:0;font-size:13px;color:#71717a;">Você pode editar e reenviar o conteúdo para nova revisão.</p>
        `);
        await sendEmail(RESEND_API_KEY, creatorAuth.user.email, subject, html);
      }
    } catch (emailErr) {
      console.error('Error sending rejection email:', emailErr);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Content rejected successfully' }),
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
