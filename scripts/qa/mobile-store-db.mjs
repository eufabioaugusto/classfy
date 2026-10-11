// PostgreSQL isolado: informe o dist/index.js do @electric-sql/pglite instalado fora do projeto.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.argv[2]);
const db = new PGlite();
await db.exec(`
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
const original = await readFile('supabase/migrations/20260911120000_complete_economia_classfy_v1.sql','utf8');
await db.exec(original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.protect_profile_operational_fields()'), original.indexOf('DROP FUNCTION IF EXISTS public.sync_subscription_state_v1(')));
await db.exec(`CREATE TRIGGER protect_profile BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_operational_fields();`);
await db.exec(original.slice(original.indexOf('CREATE FUNCTION public.sync_subscription_state_v1('),original.indexOf('CREATE OR REPLACE FUNCTION public.expire_subscription_entitlements_v1()')));
await db.exec(await readFile('supabase/migrations/20261011210000_mobile_store_subscriptions.sql','utf8'));
const user = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const third = '10000000-0000-4000-8000-000000000003';
await db.query('INSERT INTO profiles(id) VALUES ($1),($2),($3)',[user,other,third]);
await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)");
const now = Date.now(), eventAt = new Date(now).toISOString(), expires = new Date(now+86400000).toISOString();
let seq = 0;
async function sync(patch={}) {
  const p = {owner:user,provider:'apple',id:'original-1',product:'br.com.classfy.pro.monthly',plan:'pro',status:'active',expires,
    renew:true,event:`evt-${++seq}`,at:eventAt,environment:'Production',transaction:'transaction-1',token:null,replaces:null,...patch};
  const {rows} = await db.query('SELECT sync_mobile_subscription_state_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) result',
    [p.owner,p.provider,p.id,p.product,p.plan,p.status,p.expires,p.renew,p.event,p.at,p.environment,p.transaction,p.token,p.replaces]);
  return rows[0].result;
}
assert.equal((await sync({event:'initial'})).plan,'pro');
assert.equal((await sync({event:'initial'})).duplicate,true);
assert.equal((await sync({at:new Date(now-10000).toISOString(),status:'expired'})).ignored_stale_event,true);
await assert.rejects(sync({owner:other}),/owner_mismatch/);
await assert.rejects(sync({event:'initial',id:'different'}),/event_owner_mismatch/);
await assert.rejects(sync({environment:'Sandbox'}),/owner_mismatch/);
await assert.rejects(sync({provider:'google',id:'google-double'}),/provider_conflict/);
await assert.rejects(sync({at:new Date(now+600000).toISOString()}),/invalid_mobile_subscription_state/);
const stripe = await db.query("SELECT sync_subscription_state_v1($1,'free',NULL,NULL,NULL,NULL) result",[user]);
assert.equal(stripe.rows[0].result.store_entitlement_preserved,true);
assert.equal(stripe.rows[0].result.plan,'pro');
assert.equal((await sync({status:'canceled',renew:false})).plan,'pro');
assert.equal((await sync({status:'revoked',expires:null})).plan,'free');
// Stripe continua funcionando para quem não tem uma compra nas lojas.
await db.query("SELECT sync_subscription_state_v1($1,'active','premium',$2,'sub-fixture','cus-fixture')",[other,expires]);
await assert.rejects(sync({owner:other,id:'other-mobile'}),/provider_conflict/);
// Troca de token Google: o anterior nunca recupera o plano antigo.
assert.equal((await sync({owner:third,provider:'google',id:'token-hash-1',plan:'premium'})).plan,'premium');
assert.equal((await sync({owner:third,provider:'google',id:'token-hash-2',plan:'pro',replaces:'token-hash-1'})).plan,'pro');
assert.equal((await sync({owner:third,provider:'google',id:'token-hash-1',plan:'premium'})).ignored_replaced_subscription,true);
assert.equal((await sync({owner:third,provider:'google',id:'token-hash-2',status:'paused'})).plan,'free');
await db.query("UPDATE profiles SET plan='premium', entitlement_source='admin', plan_expires_at=NULL WHERE id=$1",[third]);
await assert.rejects(sync({owner:third,provider:'google',id:'admin-double'}),/provider_conflict/);
// Uma restauração mais recente de Pro não reduz outro Premium ainda pago.
assert.equal((await sync({id:'independent-premium',plan:'premium'})).plan,'premium');
assert.equal((await sync({id:'independent-pro',at:new Date(now+1000).toISOString()})).plan,'premium');
// Vencimento atua também quando a última notificação não chegou.
await db.query("UPDATE mobile_store_subscriptions SET period_end=now()-interval '1 second' WHERE user_id=$1 AND plan='premium'",[user]);
await db.query("UPDATE profiles SET plan_expires_at=now()-interval '1 second' WHERE id=$1",[user]);
await db.exec('SELECT expire_subscription_entitlements_v1()');
assert.equal((await db.query('SELECT plan FROM profiles WHERE id=$1',[user])).rows[0].plan,'pro');
await db.query("UPDATE mobile_store_subscriptions SET period_end=now()-interval '1 second' WHERE user_id=$1",[user]);
await db.query("UPDATE profiles SET plan_expires_at=now()-interval '1 second' WHERE id=$1",[user]);
await db.exec('SELECT expire_subscription_entitlements_v1()');
assert.equal((await db.query('SELECT plan FROM profiles WHERE id=$1',[user])).rows[0].plan,'free');
await db.exec("SELECT set_config('request.jwt.claim.role','authenticated',false)");
await assert.rejects(sync({id:'tamper'}),/service_role_required/);
await assert.rejects(db.query("UPDATE profiles SET entitlement_source='apple', plan='premium' WHERE id=$1",[user]),/server_managed/);
assert.equal((await db.query("SELECT has_table_privilege('authenticated','mobile_store_subscriptions','SELECT') allowed")).rows[0].allowed,false);
assert.equal((await db.query("SELECT has_table_privilege('anon','mobile_store_events','SELECT') allowed")).rows[0].allowed,false);
assert.equal((await db.query("SELECT has_function_privilege('authenticated','sync_mobile_subscription_state_v1(uuid,text,text,text,plan_type,text,timestamptz,boolean,text,timestamptz,text,text,text,text)','EXECUTE') allowed")).rows[0].allowed,false);
console.log('PASS: migração real, permissões, titularidade, replay, ordem dos eventos, conflito entre provedores, cancelamento, revogação, substituição Google, expiração e preservação Stripe/lojas.');
await db.close();
