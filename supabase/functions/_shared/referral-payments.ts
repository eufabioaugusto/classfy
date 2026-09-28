import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
// The conversion row lock in the RPC makes all paid-event paths idempotent.
export async function creditReferralPurchase(client: SupabaseClient, stripe: Stripe,
  userId: string | undefined, amount: number, kind: string, paymentIntentId: string | null) {
  if (!userId || amount <= 0 || !paymentIntentId) return;
  const { data: conversion, error } = await client.from("referral_conversions")
    .select("id").eq("referred_user_id", userId).maybeSingle();
  if (error) throw new Error("Unable to look up referral purchase");
  if (!conversion) return;
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  if (intent.status !== "succeeded") return;
  const { error: commissionError } = await client.rpc("process_referral_commission_v1", {
    p_conversion_id: conversion.id, p_purchase_amount: amount,
    p_purchase_type: kind, p_stripe_charge_id: paymentIntentId,
  });
  if (commissionError) throw new Error("Unable to credit referral purchase");
  // Reconcile an earlier refund when Stripe delivers payment events out of order.
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  if (charge?.amount_refunded) await reverseReferralPurchase(client, paymentIntentId,
    "refund", charge.amount_refunded / 100, `referral_reconcile_${charge.id}`);
}
export async function reverseReferralPurchase(client: SupabaseClient, paymentIntentId: string,
  kind: "refund" | "chargeback", amount: number, eventId: string) {
  const { error } = await client.rpc("reverse_referral_commission_v1", {
    p_payment_intent_id: paymentIntentId, p_reversal_type: kind,
    p_gross_amount: amount, p_event_id: eventId,
  });
  if (error) throw new Error("Unable to reverse referral commission");
}
