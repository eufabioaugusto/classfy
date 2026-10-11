import {
  MobileSubscriptionError,
  type MobileSubscriptionRepository,
} from "./mobile-subscription.ts";

interface RpcClient {
  from(table: string): any;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: any; error: any }>;
}
export function createMobileSubscriptionRepository(
  client: RpcClient,
): MobileSubscriptionRepository {
  return {
    async purchaseAllowed(userId, platform) {
      const { data, error } = await client.from("profiles")
        .select("plan,plan_expires_at,entitlement_source").eq("id", userId)
        .single();
      if (error || !data) {
        throw new MobileSubscriptionError(
          "billing_unavailable",
          "Não foi possível conferir seu plano.",
          503,
        );
      }
      const paid = ["pro", "premium"].includes(data.plan) &&
        (!data.plan_expires_at ||
          Date.parse(data.plan_expires_at) > Date.now());
      return !paid || data.entitlement_source === platform;
    },
    async sync(snapshot) {
      const { data, error } = await client.rpc(
        "sync_mobile_subscription_state_v1",
        {
          p_user_id: snapshot.userId,
          p_provider: snapshot.platform,
          p_original_id: snapshot.originalId,
          p_product_id: snapshot.productId,
          p_plan: snapshot.plan,
          p_status: snapshot.status,
          p_period_end: snapshot.periodEnd,
          p_auto_renew: snapshot.autoRenew,
          p_event_id: snapshot.eventId,
          p_event_at: snapshot.eventAt,
          p_environment: snapshot.environment,
          p_transaction_id: snapshot.transactionId ?? null,
          p_purchase_token: snapshot.purchaseToken ?? null,
          p_replaced_original_id: snapshot.replacedOriginalId ?? null,
        },
      );
      if (error) {
        if (/subscription_provider_conflict/i.test(String(error.message))) {
          throw new MobileSubscriptionError(
            "subscription_managed_elsewhere",
            "Sua assinatura já é gerenciada por outro meio de pagamento.",
            409,
          );
        }
        if (
          /owned_by_another_account|ownership_conflict|owner_mismatch/i.test(
            String(error.message),
          )
        ) {
          throw new MobileSubscriptionError(
            "purchase_owned_by_another_account",
            "Esta assinatura pertence a outra conta Classfy.",
            409,
          );
        }
        throw new MobileSubscriptionError(
          "subscription_sync_unavailable",
          "Não foi possível atualizar sua assinatura. Tente restaurar a compra.",
          503,
        );
      }
      if (!data || !["free", "pro", "premium"].includes(data.plan)) {
        throw new MobileSubscriptionError(
          "subscription_sync_unavailable",
          "Não foi possível atualizar sua assinatura. Tente restaurar a compra.",
          503,
        );
      }
      return {
        plan: data.plan,
        status: data.status,
        subscriptionEnd: data.subscriptionEnd ?? null,
        entitlementSource: data.entitlementSource ?? "",
        duplicate: data.duplicate === true,
        ignored_stale_event: data.ignored_stale_event === true,
        ignored_replaced_subscription:
          data.ignored_replaced_subscription === true,
      };
    },
  };
}
