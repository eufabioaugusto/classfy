// PostgreSQL real e temporário; nunca conecta ao banco da Classfy.
// Uso: node scripts/qa/mobile-store-concurrency.mjs [diretório dos binários PostgreSQL]
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const bin = process.argv[2] ?? '/opt/homebrew/opt/postgresql@18/bin';
// macOS usa TMPDIR longo; sockets Unix do PostgreSQL precisam de um caminho curto.
const temporary = await mkdtemp('/tmp/classfy-iap-');
const data = join(temporary, 'data');
const socket = join(temporary, 'socket');
const port = String(30000 + Math.floor(Math.random() * 20000));
const env = { ...process.env, PGHOST: socket, PGPORT: port, PGUSER: 'mobile_qa', PGDATABASE: 'postgres', PGPASSWORD: '' };
// Remove libpq defaults that could redirect a temporary fixture to another host.
for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGHOSTADDR', 'PGPASSFILE']) delete env[key];
const command = (name, args, options = {}) => execute(join(bin, name), args, { env, timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...options });
const sql = (query, name = 'mobile-qa-controller') => command('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], { env: { ...env, PGAPPNAME: name } });
let started = false;
let gate;
let contenders = [];
const gateKey = 987654321;
const users = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(test, description) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (await test()) return;
    await pause(50);
  }
  throw new Error(`Timeout: ${description}`);
}

try {
  await mkdir(socket);
  await command('initdb', ['-D', data, '-U', 'mobile_qa', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8']);
  try {
    await command('pg_ctl', ['-D', data, '-l', join(temporary, 'postgres.log'), '-w', 'start', '-o', `-k ${socket} -h '' -p ${port}`]);
  } catch (error) {
    error.message += `\n${await readFile(join(temporary, 'postgres.log'), 'utf8').catch(() => '')}`;
    throw error;
  }
  started = true;
  await sql(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
    CREATE TYPE public.plan_type AS ENUM ('free','pro','premium');
    CREATE TABLE public.platform_settings(key text PRIMARY KEY,value jsonb);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, plan public.plan_type DEFAULT 'free', plan_expires_at timestamptz,
      billing_id text, stripe_subscription_id text, subscription_status text DEFAULT 'free', subscription_plan public.plan_type,
      subscription_grace_until timestamptz, pending_plan public.plan_type, pending_plan_effective_at timestamptz,
      entitlement_source text DEFAULT 'free', subscription_state_event_at timestamptz, updated_at timestamptz, creator_status text DEFAULT 'none');
  `);
  const original = await readFile(join(root, 'supabase/migrations/20260911120000_complete_economia_classfy_v1.sql'), 'utf8');
  await sql(original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.protect_profile_operational_fields()'), original.indexOf('DROP FUNCTION IF EXISTS public.sync_subscription_state_v1(')));
  await sql('CREATE TRIGGER protect_profile BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_operational_fields();');
  await sql(original.slice(original.indexOf('CREATE FUNCTION public.sync_subscription_state_v1('), original.indexOf('CREATE OR REPLACE FUNCTION public.expire_subscription_entitlements_v1()')));
  await sql(await readFile(join(root, 'supabase/migrations/20261011210000_mobile_store_subscriptions.sql'), 'utf8'));
  await sql(`INSERT INTO profiles(id) VALUES ('${users[0]}'),('${users[1]}');`);
  // A barreira roda depois da leitura do titular e antes do INSERT real. Assim,
  // ambas as conexões veem a ausência inicial, sem alterar a função em teste.
  await sql(`
    CREATE FUNCTION qa_wait_before_store_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      PERFORM pg_advisory_xact_lock(${gateKey}); RETURN NEW;
    END $$;
    CREATE TRIGGER qa_store_gate BEFORE INSERT ON mobile_store_subscriptions
      FOR EACH ROW EXECUTE FUNCTION qa_wait_before_store_insert();
  `);
  gate = spawn(join(bin, 'psql'), ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { env: { ...env, PGAPPNAME: 'mobile-qa-gate' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let gateOutput = '';
  gate.stdout.on('data', (chunk) => { gateOutput += chunk.toString(); });
  gate.stdin.write(`SELECT pg_advisory_lock(${gateKey}); SELECT 'gate-held';\n`);
  await waitFor(() => gateOutput.includes('gate-held'), 'barreira inicial');
  const ownerAttempt = (owner, index) => sql(`
    SET statement_timeout = '15s';
    SELECT set_config('request.jwt.claim.role','service_role',false);
    SELECT sync_mobile_subscription_state_v1('${owner}','apple','racing-original','br.com.classfy.pro.monthly',
      'pro','active',now()+interval '1 day',true,'racing-event-${index}',now(),'Production','1',NULL,NULL);
  `, `mobile-qa-owner-${index}`);
  contenders = users.map((owner, index) => ownerAttempt(owner, index));
  // Attach error handlers immediately; the loser is deliberately expected to fail.
  const finished = Promise.allSettled(contenders);
  await waitFor(async () => {
    const result = await sql("SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('mobile-qa-owner-0','mobile-qa-owner-1') AND wait_event='advisory';");
    return Number(result.stdout.trim()) === 2;
  }, 'duas conexões após lookup vazio');
  gate.stdin.end(`SELECT pg_advisory_unlock(${gateKey});\n\\q\n`);
  const outcomes = await finished;
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1, 'somente um perfil pode adquirir o original_id');
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.match(rejected.reason.stderr, /store_subscription_owner_mismatch/);
  const winnerIndex = outcomes.findIndex((result) => result.status === 'fulfilled');
  const owner = (await sql("SELECT user_id FROM mobile_store_subscriptions WHERE provider='apple' AND original_id='racing-original';")).stdout.trim();
  assert.equal(owner, users[winnerIndex]);
  assert.equal(Number((await sql('SELECT count(*) FROM mobile_store_events;')).stdout.trim()), 1, 'transação rejeitada não grava evento');
  const profiles = (await sql("SELECT json_agg(json_build_object('id',id,'plan',plan) ORDER BY id) FROM profiles;")).stdout.trim();
  const records = JSON.parse(profiles);
  assert.equal(records.find((record) => record.id === owner).plan, 'pro');
  assert.equal(records.find((record) => record.id !== owner).plan, 'free', 'perdedor não recebe acesso pago');
  console.log('PASS: PostgreSQL real, duas transações após lookup vazio; um titular vence, outro é rejeitado e permanece Free, com apenas um evento gravado.');
} finally {
  if (gate && !gate.stdin.writableEnded) gate.stdin.end('\\q\n');
  if (started) await command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  await Promise.allSettled(contenders);
  await rm(temporary, { recursive: true, force: true });
}
