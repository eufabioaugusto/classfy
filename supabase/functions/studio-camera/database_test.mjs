// Native PostgreSQL fixture. Never uses the live Classfy database.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
const execute = promisify(execFile);
const bin = process.argv[2] ?? '/opt/homebrew/opt/postgresql@18/bin';
const temporary = await mkdtemp('/tmp/classfy-remote-db-');
const data = join(temporary, 'data'); const socket = join(temporary, 'socket');
const port = String(30000 + Math.floor(Math.random() * 20000));
const env = { ...process.env, PGHOST: socket, PGPORT: port, PGUSER: 'remote_qa', PGDATABASE: 'postgres', PGPASSWORD: '' };
for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGHOSTADDR', 'PGPASSFILE']) delete env[key];
const command = (name, args, options = {}) => execute(join(bin, name), args, { env, timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...options });
const sql = (query) => command('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query]);
const migration = await readFile(new URL('../../migrations/20261012220000_studio_remote_camera.sql', import.meta.url), 'utf8');
const proMigration = await readFile(new URL('../../migrations/20261012224500_studio_remote_camera_pro_state.sql', import.meta.url), 'utf8');
const resumeMigration = await readFile(new URL('../../migrations/20261012233000_studio_remote_camera_resume.sql', import.meta.url), 'utf8');
let started = false;
try {
 await mkdir(socket);
 await command('initdb', ['-D', data, '-U', 'remote_qa', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8']);
 await command('pg_ctl', ['-D', data, '-l', join(temporary, 'postgres.log'), '-w', 'start', '-o', `-k ${socket} -h '' -p ${port}`]); started = true;
 await sql(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE SCHEMA storage;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE TYPE public.app_role AS ENUM('admin','creator','user');
  CREATE TABLE public.profiles(id uuid PRIMARY KEY,plan text,plan_expires_at timestamptz,subscription_status text,subscription_grace_until timestamptz,creator_status text,entitlement_source text DEFAULT 'stripe');
  CREATE TABLE public.user_roles(user_id uuid,role app_role);
  CREATE FUNCTION public.has_role(p_user uuid,p_role app_role) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=p_user AND role=p_role) $$;
  CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb,UNIQUE(bucket_id,name));
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE POLICY legacy_open ON storage.objects FOR ALL USING(true) WITH CHECK(true);
  GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;
  GRANT ALL ON storage.objects TO authenticated;
  INSERT INTO auth.users VALUES('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
  INSERT INTO profiles(id,plan,plan_expires_at,subscription_status,subscription_grace_until,creator_status) VALUES('10000000-0000-4000-8000-000000000001','premium',now()+interval '1 day','active',NULL,'approved'),
   ('10000000-0000-4000-8000-000000000002','free',NULL,'free',NULL,'approved');
  INSERT INTO user_roles VALUES('10000000-0000-4000-8000-000000000001','creator'),('10000000-0000-4000-8000-000000000002','admin');
 `);
 await sql(migration);
 await sql(migration); // Migration is safe to reapply in the rollback QA workflow.
 await sql(proMigration);
 await sql(proMigration);
 await sql(resumeMigration);
 await sql(resumeMigration);
 const fixture = await readFile(new URL('database_test.sql', import.meta.url), 'utf8');
 await sql(fixture);
 // Two simultaneous joins may consume the same QR only for one device.
 const user = '10000000-0000-4000-8000-000000000001';
 const hash = 'a'.repeat(64);
 const created = JSON.parse((await sql(`SELECT set_config('request.jwt.claim.role','service_role',false); SELECT studio_camera_action('${user}','create','{"kind":"aula","controllerId":"20000000-0000-4000-8000-000000000001","pairingHash":"${hash}"}');`)).stdout.trim().split('\n').at(-1));
 const session = created.session.id;
 const joins = await Promise.allSettled([1, 2].map(n => sql(`SELECT set_config('request.jwt.claim.role','service_role',false); SELECT studio_camera_action('${user}','join','{"pairingHash":"${hash}","deviceId":"30000000-0000-4000-8000-00000000000${n}"}');`)));
 assert.equal(joins.filter(result => result.status === 'fulfilled').length, 1);
 assert.match(joins.find(result => result.status === 'rejected').reason.stderr, /studio_camera_pairing_unavailable/);
 const commandId = '40000000-0000-4000-8000-000000000001'; const takeId = '50000000-0000-4000-8000-000000000001';
 const commands = await Promise.all([1, 2].map(() => sql(`SELECT set_config('request.jwt.claim.role','service_role',false); SELECT studio_camera_action('${user}','command','{"sessionId":"${session}","commandId":"${commandId}","type":"start","payload":{"takeId":"${takeId}"}}');`)));
 assert.equal(commands.length, 2);
 assert.equal(Number((await sql(`SELECT count(*) FROM studio_camera_commands WHERE session_id='${session}';`)).stdout.trim()), 1);
 assert.equal(Number((await sql(`SELECT count(*) FROM studio_camera_takes WHERE session_id='${session}';`)).stdout.trim()), 1);
 const pairingMigration = await readFile(new URL('../../migrations/20261013000000_studio_remote_camera_pairings.sql', import.meta.url), 'utf8');
 await sql(pairingMigration);
 await sql(pairingMigration);
 const imageMigration=await readFile(new URL('../../migrations/20261013010000_studio_remote_camera_image_grade.sql',import.meta.url),'utf8');
 await sql(imageMigration);await sql(imageMigration);
 await sql(await readFile(new URL('pairings_test.sql', import.meta.url), 'utf8'));
 await sql(pairingMigration); // Reapplying never revives a revoked pairing.
 assert.equal(Number((await sql(`SELECT count(*) FROM studio_camera_pairings WHERE controller_id='20000000-0000-4000-8000-000000000090' AND revoked_at IS NOT NULL;`)).stdout.trim()), 1);
 await sql(`DO $$ DECLARE u uuid:='10000000-0000-4000-8000-000000000001'; s uuid; BEGIN
  INSERT INTO studio_camera_sessions(owner_id,controller_id,kind,configuration,pairing_hash,pairing_expires_at)
   VALUES(u,'20000000-0000-4000-8000-000000000099','aula','{"resolution":"4k","fps":30,"cameraFacing":"back","pro":{"autoExposure":false,"iso":200}}',repeat('9',64),now()+interval '1 hour') RETURNING id INTO s;
  UPDATE studio_camera_sessions SET configuration=configuration||'{"imageGrade":{"preset":"studio","intensity":0.8,"exposure":0.2,"contrast":0,"saturation":0,"temperature":0},"pro":{"focusPoint":{"x":0.2,"y":0.8,"locked":false}}}'::jsonb WHERE id=s;
  IF EXISTS(SELECT 1 FROM studio_camera_sessions WHERE id=s AND configuration#>'{pro,focusPoint}' IS NOT NULL) OR
   NOT EXISTS(SELECT 1 FROM studio_camera_sessions WHERE id=s AND configuration#>>'{pro,iso}'='200' AND configuration#>>'{imageGrade,preset}'='studio') THEN RAISE EXCEPTION 'focus intent replayed or image grade lost'; END IF;
 END $$;`);
 console.log('PostgreSQL QA passed: entitlement, ownership, expiry, one-use/retry, ACK order, multipart recovery, restrictive RLS, concurrent idempotency and durable pairings.');
} finally {
 if (started) await command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']).catch(() => undefined);
 await rm(temporary, { recursive: true, force: true });
}
