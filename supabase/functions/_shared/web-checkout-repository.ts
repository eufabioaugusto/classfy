import {
  type CheckoutOperation,
  pendingWebDowngrade,
  WebCheckoutError,
  type WebCheckoutRepository,
} from "./web-subscription-checkout.ts";
import { getSubscriptionPeriodEnd } from "./stripe-subscription.ts";

// The Supabase boundary is structural because historical functions use SDK versions.
export function createWebCheckoutRepository(
  supabase: any,
): WebCheckoutRepository {
  const checked = async (result: any) => {
    if (result.error) {
      throw new WebCheckoutError(
        "billing_state_unavailable",
        "Não foi possível confirmar o estado da assinatura. Tente novamente.",
        503,
      );
    }
    return result.data;
  };
  const repository: WebCheckoutRepository = {
    claim: async (owner, token) =>
      Boolean(
        await checked(
          await supabase.rpc("claim_web_subscription_checkout_v1", {
            p_user_id: owner,
            p_token: token,
          }),
        ),
      ),
    release: async (owner, token) => {
      await checked(
        await supabase.rpc("release_web_subscription_checkout_v1", {
          p_user_id: owner,
          p_token: token,
        }),
      );
    },
    profile: async (owner) => {
      const profile = await checked(
        await supabase.from("profiles").select(
          "billing_id,plan,plan_expires_at,entitlement_source,subscription_status,pending_plan,pending_plan_effective_at",
        ).eq("id", owner).single(),
      );
      if (!profile) {
        throw new WebCheckoutError("not_found", "Conta não encontrada.", 404);
      }
      return profile;
    },
    saveCustomer: async (owner, customer) => {
      await checked(
        await supabase.from("profiles").update({ billing_id: customer }).eq(
          "id",
          owner,
        ),
      );
    },
    operations: async (owner) => {
      const rows = await checked(
        await supabase.from("web_subscription_checkout_operations").select(
          "record",
        ).eq("user_id", owner).order("created_at", { ascending: false }).limit(
          200,
        ),
      );
      return (rows ?? []).map((row: any) => row.record as CheckoutOperation);
    },
    save: async (owner, token, operation) => {
      await checked(
        await supabase.rpc("complete_web_subscription_checkout_v1", {
          p_user_id: owner,
          p_token: token,
          p_record: operation,
        }),
      );
    },
    sync: async (owner, subscription, plan) => {
      const profile = await repository.profile(owner);
      const pendingAt = pendingWebDowngrade(profile, subscription);
      const data = await checked(
        await supabase.rpc("sync_subscription_state_v1", {
          p_user_id: owner,
          p_status: subscription.status,
          p_plan: plan,
          p_period_end: getSubscriptionPeriodEnd(
            subscription as Parameters<typeof getSubscriptionPeriodEnd>[0],
          ),
          p_subscription_id: subscription.id,
          p_customer_id: typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id,
          p_pending_plan: pendingAt ? "pro" : null,
          p_pending_effective_at: pendingAt,
          p_event_created_at: new Date(Math.floor(Date.now() / 1000) * 1000)
            .toISOString(),
        }),
      );
      return data?.plan === plan &&
        ["active", "trialing"].includes(data?.status);
    },
  };
  return repository;
}
