import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get('X-BunnyStream-Signature');

    const readOnlyApiKey = Deno.env.get('BUNNY_STREAM_READ_ONLY_API_KEY') || Deno.env.get('BUNNY_STREAM_API_KEY');
    
    // 1. Verify webhook signature if secret key is present
    if (signatureHeader && readOnlyApiKey) {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(readOnlyApiKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      
      const calculatedSigBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(rawBody)
      );
      
      const calculatedSig = Array.from(new Uint8Array(calculatedSigBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      if (calculatedSig !== signatureHeader.toLowerCase()) {
        console.warn('Webhook signature mismatch! Calculated:', calculatedSig, 'Header:', signatureHeader);
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      console.log('Webhook signature check skipped (no signature header or no API key configured).');
    }

    const payload = JSON.parse(rawBody);
    const videoGuid = payload.VideoGuid;
    const libraryId = payload.VideoLibraryId;
    const status = payload.Status;

    console.log(`Received Bunny webhook. Library: ${libraryId}, Video: ${videoGuid}, Status: ${status}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Map Bunny status codes to our status strings
    // 3: Finished, 4: ResolutionFinished -> ready
    // 5: Failed -> failed
    // 0, 1, 2: processing
    let bunnyStatus = 'processing';
    if (status === 3 || status === 4) {
      bunnyStatus = 'ready';
    } else if (status === 5) {
      bunnyStatus = 'failed';
    }

    const cdnHostname = Deno.env.get('BUNNY_STREAM_CDN_HOSTNAME') || 'vz-42560f79-6f8.b-cdn.net';
    const hlsUrl = `https://${cdnHostname}/${videoGuid}/playlist.m3u8`;
    const thumbnailUrl = `https://${cdnHostname}/${videoGuid}/thumbnail.jpg`;

    // 2. Fetch duration from Bunny API if status is ready
    let durationSeconds = null;
    const apiKey = Deno.env.get('BUNNY_STREAM_API_KEY');
    
    if (bunnyStatus === 'ready' && apiKey) {
      try {
        console.log(`Fetching video details from Bunny for duration: ${videoGuid}`);
        const getRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${videoGuid}`, {
          method: 'GET',
          headers: {
            'AccessKey': apiKey,
            'Content-Type': 'application/json',
          }
        });

        if (getRes.ok) {
          const videoData = await getRes.json();
          // videoData.length is duration in seconds
          if (videoData.length) {
            durationSeconds = videoData.length;
            console.log(`Retrieved video duration: ${durationSeconds} seconds`);
          }
        } else {
          console.error(`Failed to fetch video length from Bunny: ${getRes.status}`);
        }
      } catch (err: any) {
        console.error('Error fetching video metadata from Bunny:', err.message);
      }
    }

    // Fetch current content to avoid overwriting custom uploaded thumbnails
    const { data: currentContent } = await supabase
      .from('contents')
      .select('thumbnail_url')
      .eq('bunny_video_id', videoGuid)
      .maybeSingle();

    // 3. Update database
    const updateData: any = {
      bunny_status: bunnyStatus,
      bunny_hls_url: hlsUrl,
      bunny_thumbnail_url: thumbnailUrl,
    };

    if (bunnyStatus === 'ready') {
      // In ready state, we also point file_url to the HLS playlist
      updateData.file_url = hlsUrl;
      // Only set generic Bunny thumbnail if the user hasn't uploaded a custom one
      if (!currentContent?.thumbnail_url) {
        updateData.thumbnail_url = thumbnailUrl;
      }
      if (durationSeconds !== null) {
        updateData.duration_seconds = durationSeconds;
      }
    }

    console.log(`Updating contents table for video: ${videoGuid}`);
    const { data, error } = await supabase
      .from('contents')
      .update(updateData)
      .eq('bunny_video_id', videoGuid)
      .select();

    if (error) {
      console.error('Database update error:', error);
      throw error;
    }

    console.log('Database updated successfully. Rows updated:', data?.length);

    return new Response(JSON.stringify({ success: true, updated: data?.length }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error in bunny-webhook function:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
