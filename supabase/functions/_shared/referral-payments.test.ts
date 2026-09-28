import { creditReferralPurchase, reverseReferralPurchase } from './referral-payments.ts';
import type Stripe from 'https://esm.sh/stripe@18.5.0';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
function fixture(status='succeeded', refunded=0) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const query = { select: () => query, eq: () => query, maybeSingle: () => Promise.resolve({data:{id:'conversion'},error:null}) };
  const client = {from: () => query, rpc: (name: string,args: Record<string,unknown>) => { calls.push({name,args}); return Promise.resolve({data:{},error:null}); }} as unknown as SupabaseClient;
  const stripe = {paymentIntents:{retrieve: () => Promise.resolve({status,latest_charge:{id:'ch_test',amount_refunded:refunded}})}} as unknown as Stripe;
  return {client,stripe,calls};
}
function assert(value: boolean) { if(!value) throw new Error('Assertion failed'); }
Deno.test('does not commission free or incomplete payments', async () => {
  const f=fixture('processing');
  await creditReferralPurchase(f.client,f.stripe,'user',100,'payment','pi_test');
  await creditReferralPurchase(f.client,f.stripe,'user',0,'subscription','pi_trial');
  await creditReferralPurchase(f.client,f.stripe,'user',100,'subscription',null);
  assert(f.calls.length===0);
});
Deno.test('paid subscription uses payment intent and reconciles an earlier refund', async () => {
  const f=fixture('succeeded',3000);
  await creditReferralPurchase(f.client,f.stripe,'user',100,'subscription','pi_test');
  assert(f.calls[0].name==='process_referral_commission_v1');
  assert(f.calls[0].args.p_stripe_charge_id==='pi_test');
  assert(f.calls[1].name==='reverse_referral_commission_v1' && f.calls[1].args.p_gross_amount===30);
});
Deno.test('chargebacks send their amount to the atomic reversal', async () => {
  const f=fixture();
  await reverseReferralPurchase(f.client,'pi_test','chargeback',100,'evt_test');
  assert(f.calls[0].args.p_reversal_type==='chargeback' && f.calls[0].args.p_event_id==='evt_test');
});
