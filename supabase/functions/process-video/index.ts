import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Verify user is creator or admin
    const { data: roles } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['creator', 'admin']);

    if (!roles || roles.length === 0) {
      throw new Error('User must be creator or admin');
    }

    const formData = await req.formData();
    const videoFile = formData.get('video') as File;
    const courseId = formData.get('courseId') as string;
    const lessonId = formData.get('lessonId') as string;

    if (!videoFile || !courseId || !lessonId) {
      throw new Error('Missing required fields');
    }

    console.log('Processing video:', {
      name: videoFile.name,
      size: videoFile.size,
      type: videoFile.type,
      courseId,
      lessonId
    });

    // Validate video file
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (videoFile.size > maxSize) {
      throw new Error('Video file is too large. Maximum size is 500MB');
    }

    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowedTypes.includes(videoFile.type)) {
      throw new Error('Invalid video format. Only MP4, WebM, and MOV are allowed');
    }

    // Generate unique filename
    const timestamp = Date.now();
    const fileExt = videoFile.name.split('.').pop();
    const fileName = `${user.id}/${courseId}/${lessonId}_${timestamp}.${fileExt}`;

    // Upload original video
    const { data: uploadData, error: uploadError } = await supabaseClient.storage
      .from('courses')
      .upload(fileName, videoFile, {
        contentType: videoFile.type,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw uploadError;
    }

    console.log('Video uploaded successfully:', uploadData.path);

    // Get public URL
    const { data: { publicUrl } } = supabaseClient.storage
      .from('courses')
      .getPublicUrl(uploadData.path);

    // TODO: Implement video compression with external service
    // For now, we'll use the original video
    // Future integration: Cloudflare Stream, Mux, or FFmpeg-based service
    
    // Queue video for processing (background task)
    Promise.resolve().then(async () => {
      console.log('Queuing video for compression:', uploadData.path);
      
      // Insert processing job record
      const { error: jobError } = await supabaseClient
        .from('video_processing_jobs')
        .insert({
          user_id: user.id,
          course_id: courseId,
          lesson_id: lessonId,
          original_path: uploadData.path,
          status: 'queued',
          file_size: videoFile.size,
          metadata: {
            original_name: videoFile.name,
            mime_type: videoFile.type
          }
        });

      if (jobError) {
        console.error('Failed to create processing job:', jobError);
      }
    }).catch(err => {
      console.error('Background task error:', err);
    });

    return new Response(
      JSON.stringify({
        success: true,
        videoUrl: publicUrl,
        path: uploadData.path,
        message: 'Video uploaded successfully. Compression will be processed in background.'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error processing video:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to process video'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});