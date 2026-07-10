const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read .env.local
const envFile = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8');
const supabaseUrl = envFile.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseAnonKey = envFile.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();

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
