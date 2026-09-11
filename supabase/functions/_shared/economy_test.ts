import {
  allocatePool,
  calculatePoints,
  calculatePoolAmount,
  calculateSaleSplit,
  resolveSubscriptionPlan,
} from "./economy.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(message ?? `Esperado ${right}, recebido ${left}`);
}

Deno.test("Points de usuario respeitam o plano e Creator Points nao recebem multiplicador", () => {
  assertEquals(calculatePoints({ basePoints: 10, pointType: "user", actorPlan: "free" }), 10);
  assertEquals(calculatePoints({ basePoints: 10, pointType: "user", actorPlan: "pro" }), 15);
  assertEquals(calculatePoints({ basePoints: 10, pointType: "user", actorPlan: "premium" }), 20);
  assertEquals(calculatePoints({ basePoints: 10, pointType: "creator", actorPlan: "premium" }), 10);
  assertEquals(calculatePoints({ basePoints: 10, pointType: "user", actorPlan: "premium", isOwnContent: true }), 0);
});

Deno.test("pool usa 40 por cento da receita liquida elegivel", () => {
  assertEquals(calculatePoolAmount(10_000, 40), 4_000);
});

Deno.test("rateio conserva todos os centavos e desempata deterministicamente", () => {
  const result = allocatePool(10, [
    { id: "b", points: 1 },
    { id: "a", points: 1 },
    { id: "c", points: 1 },
  ]);
  assertEquals(result.reduce((sum, item) => sum + item.amount, 0), 10);
  assertEquals(result.find((item) => item.id === "a")?.amount, 3.34);
});

Deno.test("venda avulsa congela split 20/80", () => {
  assertEquals(calculateSaleSplit(100, 20), {
    grossAmount: 100,
    classfyPercent: 20,
    classfyAmount: 20,
    creatorPercent: 80,
    creatorAmount: 80,
  });
});

Deno.test("entitlement cobre ativo, grace, cancelado e expirado", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const future = new Date("2026-09-13T12:00:00Z");
  const past = new Date("2026-09-09T12:00:00Z");
  assertEquals(resolveSubscriptionPlan({ status: "active", stripePlan: "pro", currentPlan: "free", periodEnd: future, graceUntil: null, now }), "pro");
  assertEquals(resolveSubscriptionPlan({ status: "past_due", stripePlan: "premium", currentPlan: "premium", periodEnd: future, graceUntil: future, now }), "premium");
  assertEquals(resolveSubscriptionPlan({ status: "past_due", stripePlan: "premium", currentPlan: "premium", periodEnd: future, graceUntil: past, now }), "free");
  assertEquals(resolveSubscriptionPlan({ status: "canceled", stripePlan: "pro", currentPlan: "pro", periodEnd: future, graceUntil: null, now }), "pro");
  assertEquals(resolveSubscriptionPlan({ status: "canceled", stripePlan: "pro", currentPlan: "pro", periodEnd: past, graceUntil: null, now }), "free");
  assertEquals(resolveSubscriptionPlan({ status: "expired", stripePlan: "premium", currentPlan: "premium", periodEnd: future, graceUntil: future, now }), "free");
});
