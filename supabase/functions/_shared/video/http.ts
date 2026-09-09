import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

export async function requireUser(req: Request) {
  const authorization = req.headers.get('Authorization');
  if (!authorization) throw new Error('Unauthorized');
  const client = serviceClient();
  const { data: { user }, error } = await client.auth.getUser(authorization.replace('Bearer ', ''));
  if (error || !user) throw new Error('Unauthorized');
  return { user, client };
}
