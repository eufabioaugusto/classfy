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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header to verify they are authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { title } = await req.json();
    if (!title) {
      throw new Error('Video title is required');
    }

    const libraryId = Deno.env.get('BUNNY_STREAM_LIBRARY_ID') || '700986';
    const apiKey = Deno.env.get('BUNNY_STREAM_API_KEY');

    if (!apiKey) {
      throw new Error('BUNNY_STREAM_API_KEY not configured');
    }

    // 1. Create the video entry in Bunny Stream
    console.log(`Creating video entry on Bunny Stream for title: "${title}"`);
    const createRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
      method: 'POST',
      headers: {
        'AccessKey': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });

    if (!createRes.ok) {
      const errorText = await createRes.text();
      console.error('Bunny API create error:', errorText);
      throw new Error(`Failed to create video entry on Bunny: ${errorText}`);
    }

    const createData = await createRes.json();
    const videoId = createData.guid; // The Bunny video ID
    console.log(`Video created successfully on Bunny with ID: ${videoId}`);

    // 2. Generate the SHA256 Signature for secure TUS Upload
    // Signature = sha256(libraryId + apiKey + expirationTime + videoId)
    // Expiration: 2 hours from now (in Unix timestamp seconds)
    const expirationTime = Math.floor(Date.now() / 1000) + 7200; 
    
    const message = `${libraryId}${apiKey}${expirationTime}${videoId}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    console.log(`Generated secure upload signature valid until UNIX timestamp: ${expirationTime}`);

    return new Response(
      JSON.stringify({
        videoId,
        libraryId,
        signature,
        expirationTime,
        uploadUrl: 'https://video.bunnycdn.com/tusupload',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('Error in bunny-video-sign function:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
