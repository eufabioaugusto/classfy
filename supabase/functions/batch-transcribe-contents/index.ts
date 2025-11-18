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

    const { limit = 10 } = await req.json();

    console.log('Starting batch transcription process...');

    // Find approved contents (aula or podcast) that don't have transcriptions
    const { data: contentsWithoutTranscription, error: fetchError } = await supabase
      .from('contents')
      .select('id, title, content_type, file_url')
      .eq('status', 'approved')
      .in('content_type', ['aula', 'podcast'])
      .not('file_url', 'is', null)
      .limit(limit);

    if (fetchError) {
      console.error('Error fetching contents:', fetchError);
      throw fetchError;
    }

    if (!contentsWithoutTranscription || contentsWithoutTranscription.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No contents found without transcription',
          processed: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter out contents that already have transcriptions
    const { data: existingTranscriptions } = await supabase
      .from('transcriptions')
      .select('content_id')
      .in('content_id', contentsWithoutTranscription.map(c => c.id));

    const existingIds = new Set(existingTranscriptions?.map(t => t.content_id) || []);
    const contentsToProcess = contentsWithoutTranscription.filter(c => !existingIds.has(c.id));

    console.log(`Found ${contentsToProcess.length} contents to process`);

    // Process transcriptions in background (non-blocking)
    const processTranscriptions = async () => {
      const results = {
        total: contentsToProcess.length,
        started: [] as string[],
        errors: [] as { id: string; title: string; error: string }[]
      };

      for (const content of contentsToProcess) {
        try {
          console.log(`Starting transcription for: ${content.title} (${content.id})`);
          
          // Call transcribe-content function (non-blocking)
          supabase.functions.invoke('transcribe-content', {
            body: { contentId: content.id }
          }).then(({ error }) => {
            if (error) {
              console.error(`Error transcribing ${content.title}:`, error);
            } else {
              console.log(`Successfully transcribed: ${content.title}`);
            }
          }).catch(err => {
            console.error(`Exception transcribing ${content.title}:`, err);
          });

          results.started.push(content.id);
          
          // Small delay between starting transcriptions to avoid overwhelming the system
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Failed to start transcription for ${content.title}:`, error);
          results.errors.push({
            id: content.id,
            title: content.title,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      console.log('Batch transcription processing summary:', results);
    };

    // Start processing in background
    processTranscriptions();

    // Return immediate response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Started transcription for ${contentsToProcess.length} content(s)`,
        total: contentsToProcess.length,
        contentIds: contentsToProcess.map(c => c.id)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in batch transcribe:', error);
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
