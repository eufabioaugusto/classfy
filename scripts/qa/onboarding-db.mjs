import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { PGlite } = await import(process.argv[2]);
const db = new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'authenticated'::text$$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE profiles(id uuid PRIMARY KEY,created_at timestamptz DEFAULT now(),display_name text,interests jsonb,bio text);
CREATE TABLE platform_settings(key text PRIMARY KEY,value jsonb);
CREATE TABLE economic_cycles(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,year_month text UNIQUE,status text DEFAULT 'open',pool_percentage numeric,economy_version int,updated_at timestamptz);
CREATE TABLE reward_actions_config(action_key text,active bool,daily_limit integer);
CREATE TABLE reward_action_tracking(id uuid DEFAULT gen_random_uuid(),user_id uuid,content_id uuid,action_key text,metadata jsonb,UNIQUE(user_id,action_key));
CREATE TABLE reward_events(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,user_id uuid,related_user_id uuid,content_id uuid,action_key text,points numeric,value numeric,performance_points numeric,cycle_points numeric,point_type text,cycle_id uuid,metadata jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE economic_cycle_users(cycle_id uuid,user_id uuid,performance_points numeric DEFAULT 0,user_points numeric DEFAULT 0,creator_points numeric DEFAULT 0,cycle_points numeric DEFAULT 0,qualified_for_pool bool,qualification_points numeric,qualification_details jsonb,updated_at timestamptz,UNIQUE(cycle_id,user_id));`);
const economics = await readFile(
  "supabase/migrations/20260911120000_complete_economia_classfy_v1.sql",
  "utf8",
);
for (const name of ["get_or_create_current_cycle", "commit_reward_award"]) {
  const start = economics.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = economics.indexOf("$$;", start) + 3;
  await db.exec(economics.slice(start, end));
}
await db.exec(
  await readFile(
    "supabase/migrations/20260928180000_guided_onboarding.sql",
    "utf8",
  ),
);
await db.exec(
  await readFile(
    "supabase/migrations/20260928190000_onboarding_demo_share.sql",
    "utf8",
  ),
);
const uid = "00000000-0000-4000-8000-000000000001";
await db.query("INSERT INTO auth.users VALUES($1)", [uid]);
await db.query("INSERT INTO profiles(id,display_name) VALUES($1,$2)", [
  uid,
  "Antes",
]);
await assert.rejects(
  db.query("SELECT onboarding_state_v1()"),
  /authentication_required/,
);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
assert.equal(
  (await db.query("SELECT onboarding_state_v1() s")).rows[0].s.required,
  true,
);
assert.equal(
  (
    await db.query(
      "SELECT has_table_privilege('authenticated','user_onboarding','UPDATE') p",
    )
  ).rows[0].p,
  false,
);
assert.equal(
  (
    await db.query(
      "SELECT has_function_privilege('anon','save_onboarding_v1(integer,jsonb,text)','EXECUTE') p",
    )
  ).rows[0].p,
  false,
);
await assert.rejects(
  db.query("SELECT save_onboarding_v1(5,'{}')"),
  /step_out_of_order/,
);
await db.query(
  `SELECT save_onboarding_v1(1,'{"name":"Pessoa","interests":["Tecnologia e IA"],"journey":"creator"}')`,
);
await db.query("SELECT save_onboarding_v1(2,'{}')");
await assert.rejects(
  db.query("SELECT save_onboarding_v1(3,'{}')"),
  /demo_incomplete/,
);
await assert.rejects(
  db.query("SELECT save_onboarding_v1(2,'{}','save')"),
  /action_out_of_order/,
);
await assert.rejects(
  db.query("SELECT save_onboarding_v1(2,'{}','share')"),
  /action_out_of_order/,
);
for (const action of ["view", "like", "save", "share", "study"])
  await db.query("SELECT save_onboarding_v1(2,'{}',$1)", [action]);
await db.query("SELECT save_onboarding_v1(2,'{}','study')");
assert.equal(
  (await db.query("SELECT cardinality(demo_actions) n FROM user_onboarding"))
    .rows[0].n,
  5,
);
await db.query("SELECT save_onboarding_v1(3,'{}')");
await db.query("SELECT save_onboarding_v1(4,'{}')");
await assert.rejects(
  db.query(`SELECT save_onboarding_v1(5,'{"interests":[]}')`),
  /profile_incomplete/,
);
for (let i = 0; i < 4; i++) await db.query("SELECT save_onboarding_v1(5,'{}')");
assert.equal(
  (await db.query("SELECT count(*)::int n FROM reward_events")).rows[0].n,
  1,
);
assert.equal(
  Number((await db.query("SELECT points FROM reward_events")).rows[0].points),
  20,
);
assert.equal(
  Number(
    (await db.query("SELECT user_points FROM economic_cycle_users")).rows[0]
      .user_points,
  ),
  20,
);
assert.equal(
  (await db.query("SELECT onboarding_state_v1() s")).rows[0].s.required,
  false,
);
assert.equal(
  (await db.query("SELECT display_name FROM profiles")).rows[0].display_name,
  "Pessoa",
);
// Old clients and saved journeys can still complete their original four-action flow.
const legacy = "00000000-0000-4000-8000-000000000003";
await db.query("INSERT INTO auth.users VALUES($1)", [legacy]);
await db.query("INSERT INTO profiles(id) VALUES($1)", [legacy]);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [legacy]);
await db.query(
  `SELECT save_onboarding_v1(1,'{"name":"Legado","interests":["Carreira"]}')`,
);
await db.query("SELECT save_onboarding_v1(2,'{}')");
for (const action of ["view", "like", "save", "study"])
  await db.query("SELECT save_onboarding_v1(2,'{}',$1)", [action]);
await db.query("SELECT save_onboarding_v1(3,'{}')");
await db.query("SELECT save_onboarding_v1(2,'{}','share')");
await db.query("SELECT save_onboarding_v1(4,'{}')");
await db.query("SELECT save_onboarding_v1(5,'{}')");
await db.query("SELECT save_onboarding_v1(5,'{}','share')");
assert.equal(
  (
    await db.query(
      "SELECT count(*)::int n FROM reward_events WHERE user_id=$1",
      [legacy],
    )
  ).rows[0].n,
  1,
);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
await db.exec("SET ROLE authenticated");
assert.equal(
  (await db.query("SELECT count(*)::int n FROM user_onboarding")).rows[0].n,
  1,
);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
  "00000000-0000-4000-8000-000000000002",
]);
assert.equal(
  (await db.query("SELECT count(*)::int n FROM user_onboarding")).rows[0].n,
  0,
);
await db.exec("RESET ROLE");
console.log(
  "PASS: own auth, RPC permissions, ordered steps, resumed actions, duplicate completion, one 20-point ledger award, profile persistence.",
);
await db.close();
