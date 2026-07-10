import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Read .env.local
const envFile = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf-8');
const supabaseUrl = envFile.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)?.[1]?.trim();
const supabaseAnonKey = envFile.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)?.[1]?.trim();

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase env vars not found in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching profile:', error);
    process.exit(1);
  }

  if (!data) {
    console.log('No profiles found in database.');
  } else {
    console.log('Profile columns:', Object.keys(data));
  }
}

run();
