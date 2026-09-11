import {
  getPlanFromProduct,
  getSubscriptionPeriodEnd,
  STRIPE_PLANS,
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
