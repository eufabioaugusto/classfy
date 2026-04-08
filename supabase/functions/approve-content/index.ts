import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1'
import { emailCard, ctaButton, rewardBox, sendEmail, APP_URL } from '../_shared/email-template.ts'

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

    console.log('Approving item:', contentId, 'type:', itemType);

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

    // Update item status to approved using service role
    const { error: updateError } = await supabase
      .from(tableName)
      .update({ 
        status: 'approved',
        published_at: new Date().toISOString()
      })
      .eq('id', contentId);

    if (updateError) {
      console.error('Error updating item:', updateError);
      throw updateError;
    }

    console.log(`${itemType} approved successfully`);

    // Get reward config to calculate points and value
    const { data: rewardConfig } = await supabase
      .from('reward_actions_config')
      .select('*')
      .eq('action_key', 'CONTENT_APPROVED')
      .eq('active', true)
      .single();

    const pointsAmount = rewardConfig?.points_creator || 50;
    const valueAmount = rewardConfig?.value_creator || 5.00;

    // ALWAYS create notification for content approval (independent of reward)
      const itemLabel = itemType === 'course' ? 'curso' : 'conteúdo';
      const { error: notificationError } = await supabase
      .from('notifications')
      .insert({
        user_id: content.creator_id,
        type: 'admin',
        title: itemType === 'course' ? 'Curso aprovado! ✅' : 'Conteúdo aprovado! ✅',
        message: `Seu ${itemLabel} "${content.title}" foi aprovado e publicado! Você ganhou ${pointsAmount} pontos e R$ ${valueAmount.toFixed(2)}!`,
        related_content_id: contentId,
        is_read: false
      });

    if (notificationError) {
      console.error('Error creating notification:', notificationError);
    } else {
      console.log('Approval notification created successfully');
    }

    // Send email notification to creator
    try {
      const { data: creatorAuth } = await supabase.auth.admin.getUserById(content.creator_id);
      const { data: creatorProfile } = await supabase.from('profiles').select('display_name').eq('id', content.creator_id).single();
      if (creatorAuth?.user?.email) {
        const name = creatorProfile?.display_name || creatorAuth.user.email.split('@')[0];
        const itemLabel = itemType === 'course' ? 'curso' : 'conteúdo';
        const subject = `Seu ${itemLabel} foi aprovado! — Classfy`;
        const html = emailCard(subject, `"${content.title}" está publicado e gerando recompensas`, `
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#09090b;">Conteúdo aprovado! ✅</h1>
          <p style="margin:0 0 4px;font-size:15px;color:#52525b;line-height:1.6;">
            Olá, <strong>${name}</strong>! Seu ${itemLabel} <strong>"${content.title}"</strong> foi aprovado e já está disponível na plataforma.
          </p>
          ${rewardBox(pointsAmount, valueAmount)}
          ${ctaButton('Ver meu conteúdo', `${APP_URL}/studio/contents`)}
          <p style="margin:0;font-size:13px;color:#71717a;">Continue criando! Cada conteúdo aprovado gera pontos e saldo na sua carteira.</p>
        `);
        await sendEmail(RESEND_API_KEY, creatorAuth.user.email, subject, html);
      }
    } catch (emailErr) {
      console.error('Error sending approval email:', emailErr);
    }

    // Process reward (don't block response if it fails)
    try {
      // Check if this is the first approved content
      const { count: approvedCount } = await supabase
        .from('contents')
        .select('*', { count: 'exact', head: true })
        .eq('creator_id', content.creator_id)
        .eq('status', 'approved');

      const isFirstApproval = approvedCount === 1; // Including the one we just approved

      // Process CONTENT_APPROVED reward
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

      // Process FIRST_UPLOAD reward if this is the first approval
      if (isFirstApproval) {
        console.log('First upload detected for creator:', content.creator_id);
        const { error: firstUploadError } = await supabase.functions.invoke('process-reward', {
          body: {
            actionKey: 'FIRST_UPLOAD',
            userId: content.creator_id,
            contentId: contentId,
            metadata: { first_content_title: content.title }
          }
        });

        if (firstUploadError) {
          console.error('Error processing first upload reward:', firstUploadError);
        } else {
          console.log('First upload reward processed');
        }
      }
    } catch (err) {
      console.error('Exception processing reward:', err);
    }

    // Auto-generate transcription for video/audio content (don't block response)
    if (content.content_type === 'aula' || content.content_type === 'podcast') {
      console.log('Starting auto-transcription for content:', contentId);
      
      // Use EdgeRuntime.waitUntil to run transcription in background
      try {
        supabase.functions.invoke('transcribe-content', {
          body: { contentId: contentId }
        }).then(({ data, error }) => {
          if (error) {
            console.error('Error auto-generating transcription:', error);
          } else {
            console.log('Auto-transcription completed:', data);
          }
        }).catch(err => {
          console.error('Exception in auto-transcription:', err);
        });
      } catch (err) {
        console.error('Failed to start auto-transcription:', err);
      }
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
