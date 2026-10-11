import {
  assertStripeSubscriptionProvider,
  findStripeCustomer,
  getOrCreateStripeCustomer,
  getPlanFromProduct,
  getSubscriptionPeriodEnd,
  STRIPE_PLANS,
  StripeSubscriptionProviderError,
} from "./stripe-subscription.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(message ?? `Esperado ${right}, recebido ${left}`);
  }
}

Deno.test("resolve plano pelos IDs Stripe configurados", () => {
  assertEquals(getPlanFromProduct(STRIPE_PLANS.pro.productId), "pro");
  assertEquals(getPlanFromProduct(STRIPE_PLANS.premium.productId), "premium");
});

Deno.test("aceita current_period_end no item de assinatura Stripe Basil", () => {
  assertEquals(
    getSubscriptionPeriodEnd({
      id: "sub_test",
      status: "active",
      items: {
        data: [
          { current_period_end: 1_791_721_383 },
          { current_period_end: 1_791_721_000 },
        ],
      },
    }),
    "2026-10-11T12:23:03.000Z",
  );
});

Deno.test("prioriza current_period_end legado no objeto raiz", () => {
  assertEquals(
    getSubscriptionPeriodEnd({
      id: "sub_test",
      status: "active",
      current_period_end: 1_700_000_000,
      items: { data: [{ current_period_end: 1_800_000_000 }] },
    }),
    "2023-11-14T22:13:20.000Z",
  );
});

function customerFixture(
  provider: "apple" | "google",
  billingId: string | null,
) {
  const profile = {
    billing_id: billingId,
    plan: "premium",
    entitlement_source: provider,
    plan_expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  const calls: string[] = [];
  const updates: Record<string, unknown>[] = [];
  let listed: { id: string }[] = [];
  const stripe = {
    customers: {
      retrieve: async (id: string) => {
        calls.push("retrieve");
        return { id };
      },
      list: async (_params: { email: string; limit: number }) => {
        calls.push("list");
        return { data: listed };
      },
      create: async (
        _params: { email: string; metadata: Record<string, string> },
      ) => {
        calls.push("create");
        return { id: "cus_created" };
      },
    },
    subscriptions: { list: async () => ({ data: [] }) },
  };
  const supabase = {
    from: (table: string) => {
      assertEquals(table, "profiles");
      return {
        select: () => ({
          eq: (_key: string, _owner: string) => ({
            maybeSingle: async () => ({ data: { ...profile }, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            updates.push(patch);
            Object.assign(profile, patch);
            return { error: null };
          },
        }),
      };
    },
  };
  return {
    stripe,
    supabase,
    profile,
    calls,
    updates,
    setListed: (customers: { id: string }[]) => {
      listed = customers;
    },
  };
}
const user = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "fixture@example.invalid",
};

Deno.test("compras avulsas mantêm cliente Stripe existente para assinantes Apple e Google", async () => {
  for (const provider of ["apple", "google"] as const) {
    const f = customerFixture(provider, "cus_existing");
    assertEquals(
      await getOrCreateStripeCustomer(f.stripe, f.supabase, user),
      "cus_existing",
    );
    assertEquals(f.calls, ["retrieve"]);
    assertEquals(f.updates, []);
  }
});
Deno.test("compras avulsas podem criar cliente sem alterar acesso da loja", async () => {
  for (const provider of ["apple", "google"] as const) {
    const f = customerFixture(provider, null);
    const expiry = f.profile.plan_expires_at;
    assertEquals(
      await getOrCreateStripeCustomer(f.stripe, f.supabase, user),
      "cus_created",
    );
    assertEquals(f.calls, ["list", "create"]);
    assertEquals(f.updates, [{ billing_id: "cus_created" }]);
    assertEquals([
      f.profile.plan,
      f.profile.entitlement_source,
      f.profile.plan_expires_at,
    ], ["premium", provider, expiry]);
  }
});
Deno.test("busca genérica Stripe preserva clientes de assinantes das lojas", async () => {
  for (const provider of ["apple", "google"] as const) {
    const f = customerFixture(provider, "cus_existing");
    assertEquals(
      (await findStripeCustomer(f.stripe, f.supabase, user)).customerId,
      "cus_existing",
    );
    const email = customerFixture(provider, null);
    email.setListed([{ id: "cus_by_email" }]);
    assertEquals(
      (await findStripeCustomer(email.stripe, email.supabase, user)).customerId,
      "cus_by_email",
    );
    assertEquals(email.updates, [{ billing_id: "cus_by_email" }]);
  }
});
Deno.test("operações de assinatura bloqueiam lojas ativas e aceitam acesso vencido", () => {
  const now = Date.now();
  for (const provider of ["apple", "google"] as const) {
    const profile = customerFixture(provider, null).profile;
    try {
      assertStripeSubscriptionProvider(profile, now);
      throw new Error(
        "Assinatura nativa deveria impedir checkout/gerenciamento Stripe",
      );
    } catch (error) {
      if (!(error instanceof StripeSubscriptionProviderError)) throw error;
      assertEquals([error.provider, error.code, error.status], [
        provider,
        "subscription_managed_elsewhere",
        409,
      ]);
    }
    assertStripeSubscriptionProvider({
      ...profile,
      plan_expires_at: new Date(now - 1).toISOString(),
    }, now);
    assertStripeSubscriptionProvider({
      ...profile,
      entitlement_source: "stripe",
    }, now);
  }
});
