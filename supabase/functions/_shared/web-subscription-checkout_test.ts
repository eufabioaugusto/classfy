import {
  type CheckoutOperation,
  createWebSubscriptionCheckoutService,
  parseWebCheckoutRequest,
  pendingWebDowngrade,
  WebCheckoutError,
  type WebCheckoutRepository,
  type WebCheckoutStripe,
} from "./web-subscription-checkout.ts";
import { createWebCheckoutRepository } from "./web-checkout-repository.ts";
import { STRIPE_PLANS } from "./stripe-subscription.ts";

const clone = <T>(value: T): T => structuredClone(value);
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Esperado ${JSON.stringify(expected)}, recebido ${
        JSON.stringify(actual)
      }`,
    );
  }
}
function assert(
  value: unknown,
  message = "Condição não atendida",
): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(work: Promise<unknown>, code?: string) {
  try {
    await work;
  } catch (error) {
    if (code) equal((error as WebCheckoutError).code, code);
    return;
  }
  throw new Error("Esperava falha");
}
const owner = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "fixture@example.invalid",
};
const other = {
  id: "10000000-0000-4000-8000-000000000002",
  email: "other@example.invalid",
};
Deno.test('assinatura Apple/Google vigente impede checkout Stripe antes de qualquer cobrança', async () => {
  for (const provider of ['apple', 'google']) {
    const f = fixture();
    f.profiles.set(owner.id, {plan:'premium',plan_expires_at:'2027-11-11T00:00:00Z',entitlement_source:provider});
    const result = await f.prepare('pro');
    equal(result.kind,'manage');
    equal([f.effects.created,f.effects.updated,f.effects.expired,f.effects.synced],[0,0,0,0]);
    assert(String(result.message).includes(provider === 'apple' ? 'App Store' : 'Google Play'));
  }
});
const request = (n: number) =>
    `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture() {
  let time = 1_800_000_000_000, sequence = 0;
  const profiles = new Map<string, Record<string, any>>([[owner.id, {
    billing_id: "cus_owner",
    plan: "free",
  }], [other.id, { billing_id: "cus_other", plan: "free" }]]);
  const ledger = new Map<string, CheckoutOperation>(),
    leases = new Map<string, { token: string; expires: number }>();
  const subscriptions = new Map<string, any>(),
    sessions = new Map<string, any>(),
    invoices = new Map<string, any>(),
    intents = new Map<string, any>();
  const effects = { created: 0, updated: 0, expired: 0, synced: 0 };
  const failures = {
    createLost: false,
    updateLost: false,
    savePrepared: false,
    savePending: false,
  };
  let blockCreate: Promise<void> | undefined,
    updatePaid = false,
    previewAmount = 1350,
    syncAllowed = true;
  const idempotent = new Map<string, { params: string; result: any }>();
  const repo: WebCheckoutRepository = {
    claim: async (id, token) => {
      const existing = leases.get(id);
      if (existing && existing.expires > time && existing.token !== token) {
        return false;
      }
      leases.set(id, { token, expires: time + 90_000 });
      return true;
    },
    release: async (id, token) => {
      if (leases.get(id)?.token === token) leases.delete(id);
    },
    profile: async (id) => clone(profiles.get(id)!),
    saveCustomer: async (id, customer) => {
      profiles.get(id)!.billing_id = customer;
    },
    operations: async (id) =>
      Array.from(ledger.values()).filter((op) => op.ownerId === id).reverse()
        .map(clone),
    save: async (id, token, op) => {
      const lease = leases.get(id);
      if (lease?.token !== token || lease.expires <= time) {
        throw new Error("lease_expired");
      }
      if (op.state === "prepared" && failures.savePrepared) {
        failures.savePrepared = false;
        throw new Error("disk unavailable after Stripe created");
      }
      if (op.state === "pending" && failures.savePending) {
        failures.savePending = false;
        throw new Error("db unavailable after upgrade");
      }
      assert(op.ownerId === id);
      ledger.set(op.id, clone(op));
    },
    sync: async (id, sub, plan) => {
      effects.synced++;
      if (!syncAllowed) return false;
      profiles.get(id)!.plan = plan;
      profiles.get(id)!.subscription_status = sub.status;
      return true;
    },
  };
  const memo = (key: string, params: any, create: () => any) => {
    const previous = idempotent.get(key);
    if (previous) {
      equal(previous.params, JSON.stringify(params));
      return clone(previous.result);
    }
    const result = create();
    idempotent.set(key, {
      params: JSON.stringify(params),
      result: clone(result),
    });
    return clone(result);
  };
  const stripe: WebCheckoutStripe = {
    customers: {
      retrieve: async (id) => ({
        id,
        metadata: { user_id: id === "cus_owner" ? owner.id : other.id },
      }),
      list: async () => ({ data: [] }),
      create: async (params) => ({
        id: "cus_created",
        metadata: params.metadata,
      }),
    },
    prices: {
      retrieve: async (id) => {
        const plan = id === STRIPE_PLANS.pro.priceId ? "pro" : "premium";
        return {
          id,
          active: true,
          currency: "brl",
          unit_amount: plan === "pro" ? 2990 : 4990,
          product: STRIPE_PLANS[plan].productId,
          recurring: { interval: "month", interval_count: 1 },
        };
      },
    },
    subscriptions: {
      list: async (params) => ({
        data: Array.from(subscriptions.values()).filter((sub) =>
          sub.customer === params.customer
        ).map(clone),
      }),
      retrieve: async (id) => {
        assert(subscriptions.has(id));
        return clone(subscriptions.get(id));
      },
      update: async (id, params, options) => {
        const result = memo(options.idempotencyKey, params, () => {
          effects.updated++;
          const sub = subscriptions.get(id);
          assert(sub);
          const invoiceId = `in_upgrade${effects.updated}`,
            intentId = `pi_upgrade${effects.updated}`;
          const intent = {
            id: intentId,
            customer: sub.customer,
            status: updatePaid ? "succeeded" : "requires_action",
            client_secret: `${intentId}_secret_fixture`,
            metadata: {},
          };
          intents.set(intentId, intent);
          invoices.set(invoiceId, {
            id: invoiceId,
            customer: sub.customer,
            status: updatePaid ? "paid" : "open",
            parent: { subscription_details: { subscription: id } },
            payments: {
              data: [{
                payment: { type: "payment_intent", payment_intent: intentId },
              }],
            },
            confirmation_secret: { client_secret: intent.client_secret },
          });
          sub.latest_invoice = invoiceId;
          sub.pending_update = updatePaid
            ? null
            : { expires_at: Math.floor(time / 1000) + 82_800 };
          if (updatePaid) {
            sub.items.data[0].price = {
              id: STRIPE_PLANS.premium.priceId,
              product: STRIPE_PLANS.premium.productId,
            };
          }
          return sub;
        });
        if (failures.updateLost) {
          failures.updateLost = false;
          throw new Error("response lost after charge operation");
        }
        return result;
      },
    },
    checkout: {
      sessions: {
        list: async (params) => ({
          data: Array.from(sessions.values()).filter((session) =>
            session.customer === params.customer &&
            session.status === params.status
          ).map(clone),
        }),
        create: async (params, options) => {
          if (blockCreate) await blockCreate;
          const result = memo(options.idempotencyKey, params, () => {
            effects.created++;
            const plan = params.metadata.plan_type;
            const session = {
              id: `cs_test_take${effects.created}`,
              customer: params.customer,
              metadata: params.metadata,
              mode: params.mode,
              ui_mode: params.ui_mode,
              status: "open",
              payment_status: "unpaid",
              client_secret: params.ui_mode === "custom"
                ? "cs_fixture_secret"
                : null,
              subscription: null,
              invoice: null,
              payment_intent: null,
              setup_intent: null,
              currency: "brl",
              client_reference_id: params.client_reference_id,
              line_items: {
                has_more: false,
                data: [{
                  quantity: 1,
                  price: {
                    id: STRIPE_PLANS[plan as "pro" | "premium"].priceId,
                    product: STRIPE_PLANS[plan as "pro" | "premium"].productId,
                  },
                }],
              },
              url: "https://checkout.stripe.com/fixture",
              amount_total: plan === "pro" ? 2990 : 4990,
              expires_at: params.expires_at,
            };
            sessions.set(session.id, session);
            return session;
          });
          if (failures.createLost) {
            failures.createLost = false;
            throw new Error("response lost after session create");
          }
          return result;
        },
        retrieve: async (id) => {
          assert(sessions.has(id));
          return clone(sessions.get(id));
        },
        expire: async (id) => {
          effects.expired++;
          const session = sessions.get(id);
          session.status = "expired";
          return clone(session);
        },
      },
    },
    invoices: {
      createPreview: async () => ({
        amount_due: previewAmount,
        currency: "brl",
      }),
      retrieve: async (id) => {
        assert(invoices.has(id));
        return clone(invoices.get(id));
      },
    },
    paymentIntents: {
      retrieve: async (id) => {
        assert(intents.has(id));
        return clone(intents.get(id));
      },
    },
  };
  function addSubscription(plan: "pro" | "premium" = "pro", status = "active") {
    const sub = {
      id: "sub_owner",
      customer: "cus_owner",
      metadata: { user_id: owner.id } as Record<string, string>,
      status,
      collection_method: "charge_automatically",
      cancel_at_period_end: false,
      schedule: null,
      pending_update: null,
      latest_invoice: "in_previous",
      items: {
        data: [{
          id: "si_owner",
          quantity: 1,
          current_period_end: Math.floor(time / 1000) + 86400,
          price: {
            id: STRIPE_PLANS[plan].priceId,
            product: STRIPE_PLANS[plan].productId,
          },
        }],
      },
    };
    subscriptions.set(sub.id, sub);
    profiles.get(owner.id)!.plan = plan;
    return sub;
  }
  function addSession(
    sessionId = "cs_test_old",
    plan: "pro" | "premium" = "pro",
    mode: "custom" | "hosted" = "hosted",
  ) {
    const session = {
      id: sessionId,
      customer: "cus_owner",
      metadata: { user_id: owner.id, plan_type: plan } as Record<
        string,
        string
      >,
      mode: "subscription",
      ui_mode: mode,
      status: "open",
      payment_status: "unpaid",
      subscription: null,
      invoice: null,
      payment_intent: null,
      setup_intent: null,
      currency: "brl",
      line_items: {
        has_more: false,
        data: [{
          quantity: 1,
          price: {
            id: STRIPE_PLANS[plan].priceId,
            product: STRIPE_PLANS[plan].productId,
          },
        }],
      },
      client_secret: mode === "custom" ? `${sessionId}_secret_fixture` : null,
      url: "https://checkout.stripe.com/old",
      amount_total: plan === "pro" ? 2990 : 4990,
      expires_at: Math.floor(time / 1000) + 3600,
    };
    sessions.set(sessionId, session);
    return session;
  }
  const makeService = (mode: "custom" | "hosted" = "custom") =>
    createWebSubscriptionCheckoutService({
      repository: repo,
      stripe,
      publishableKey: mode === "custom" ? "pk_test_fixture" : "",
      uiMode: mode,
      now: () => time,
      uuid: () =>
        `30000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      returnOrigin: "https://classfy.example",
    });
  const prepare = (plan: "pro" | "premium" = "pro", n = 1) =>
    makeService().execute(owner, {
      action: "prepare",
      plan,
      operationId: request(n),
    });
  return {
    repo,
    stripe,
    makeService,
    prepare,
    ledger,
    leases,
    profiles,
    subscriptions,
    sessions,
    invoices,
    intents,
    effects,
    failures,
    addSubscription,
    addSession,
    advance: (ms: number) => {
      time += ms;
    },
    setBlock: (promise: Promise<void> | undefined) => {
      blockCreate = promise;
    },
    setPreview: (value: number) => {
      previewAmount = value;
    },
    setPaid: () => {
      updatePaid = true;
    },
    setSync: (value: boolean) => {
      syncAllowed = value;
    },
  };
}

Deno.test("Elements prepara preços fixos BRL sem criar assinatura ou cobrar; retries reutilizam sessão", async () => {
  const f = fixture();
  const first = await f.prepare();
  equal(first.kind, "checkout");
  equal(first.amountDue, 2990);
  equal(first.recurringAmount, 2990);
  equal(first.currency, "brl");
  const op = Array.from(f.ledger.values())[0];
  equal(op.params!.ui_mode, "custom");
  assert(!("success_url" in op.params!));
  assert(
    op.params!.return_url.includes("billing_session_id={CHECKOUT_SESSION_ID}"),
  );
  const again = await f.prepare("pro", 2);
  equal(again.sessionId, first.sessionId);
  equal(f.effects, { created: 1, updated: 0, expired: 0, synced: 0 });
});
Deno.test("duas instâncias/abas concorrentes usam lease por conta e criam somente uma sessão", async () => {
  const f = fixture(), gate = deferred<void>();
  f.setBlock(gate.promise);
  const first = f.prepare();
  await new Promise((done) => setTimeout(done, 0));
  await rejects(
    f.makeService().execute(owner, {
      action: "prepare",
      plan: "premium",
      operationId: request(2),
    }),
    "checkout_busy",
  );
  gate.resolve();
  await first;
  equal(f.effects.created, 1);
});
Deno.test("resposta Stripe perdida e falha de persistência depois da criação não duplicam sessão", async () => {
  for (const failure of ["createLost", "savePrepared"] as const) {
    const f = fixture();
    f.failures[failure] = true;
    await rejects(f.prepare());
    const result = await f.prepare("pro", 2);
    equal(result.kind, "checkout");
    equal(f.effects.created, 1);
    equal(f.ledger.size, 1);
  }
});
Deno.test("lease expirada não aceita escrita tardia nem libera a reserva da aba mais nova", async () => {
  const f = fixture(), gate = deferred<void>();
  f.setBlock(gate.promise);
  const first = f.prepare();
  await new Promise((done) => setTimeout(done, 0));
  f.advance(90_001);
  const second = f.prepare("pro", 2);
  await new Promise((done) => setTimeout(done, 0));
  gate.resolve();
  await rejects(first);
  await second;
  equal(f.effects.created, 1);
  equal(f.ledger.size, 1);
});
Deno.test("upgrade mostra quote sem mutação, confirma uma vez e só concede após invoice paga e assinatura efetiva", async () => {
  const f = fixture(), sub = f.addSubscription();
  const quote = await f.prepare("premium");
  equal(quote.kind, "upgrade_quote");
  equal(quote.amountDue, 1350);
  equal(quote.recurringAmount, 4990);
  equal(f.effects.updated, 0);
  assert(!("subscriptionFingerprint" in quote));
  const confirmation = {
    action: "confirm_upgrade",
    quoteToken: quote.quoteToken,
    operationId: request(3),
  };
  const payment = await f.makeService().execute(owner, confirmation);
  equal(payment.status, "requires_action");
  equal(f.effects.updated, 1);
  equal(f.effects.synced, 0);
  equal(f.profiles.get(owner.id)!.plan, "pro");
  const retry = await f.makeService().execute(owner, confirmation);
  equal(retry.paymentIntentId, payment.paymentIntentId);
  equal(f.effects.updated, 1);
  sub.items.data[0].price = {
    id: STRIPE_PLANS.premium.priceId,
    product: STRIPE_PLANS.premium.productId,
  };
  sub.pending_update = null;
  f.invoices.get(sub.latest_invoice).status = "paid";
  f.intents.get(payment.paymentIntentId).status = "succeeded";
  const result = await f.makeService().execute(owner, {
    action: "status",
    paymentIntentId: payment.paymentIntentId,
    subscriptionId: sub.id,
  });
  equal(result, {
    kind: "status",
    state: "active",
    plan: "premium",
    operationId: payment.operationId,
    subscriptionId: sub.id,
    paymentIntentId: payment.paymentIntentId,
    effectivePlan: "premium",
  });
  equal(
    (await f.makeService().execute(owner, {
      action: "status",
      subscriptionId: sub.id,
    })).state,
    "active",
  );
  equal(
    (await f.makeService().execute(owner, {
      action: "status",
      operationId: payment.operationId,
    })).state,
    "active",
  );
  await rejects(
    f.makeService().execute(other, {
      action: "status",
      subscriptionId: sub.id,
    }),
    "not_found",
  );
});
Deno.test("quote de outra conta, alterada, expirada e moeda/plano adulterados falham antes da cobrança", async () => {
  const f = fixture();
  f.addSubscription();
  const quote = await f.prepare("premium");
  await rejects(
    f.makeService().execute(other, {
      action: "confirm_upgrade",
      quoteToken: quote.quoteToken,
      operationId: request(2),
    }),
    "not_found",
  );
  f.setPreview(1600);
  await rejects(
    f.makeService().execute(owner, {
      action: "confirm_upgrade",
      quoteToken: quote.quoteToken,
      operationId: request(2),
    }),
    "quote_changed",
  );
  equal(f.effects.updated, 0);
  f.advance(300_001);
  await rejects(
    f.makeService().execute(owner, {
      action: "confirm_upgrade",
      quoteToken: quote.quoteToken,
      operationId: request(2),
    }),
    "quote_expired",
  );
  equal(f.effects.updated, 0);
});
Deno.test("upgrade com resposta perdida ou banco indisponível depois da mutação recupera a mesma invoice/intent", async () => {
  for (const failure of ["updateLost", "savePending"] as const) {
    const f = fixture();
    f.addSubscription();
    const quote = await f.prepare("premium");
    f.failures[failure] = true;
    const confirmation = {
      action: "confirm_upgrade",
      quoteToken: quote.quoteToken,
      operationId: request(3),
    };
    await rejects(f.makeService().execute(owner, confirmation));
    const result = await f.makeService().execute(owner, confirmation);
    equal(result.status, "requires_action");
    equal(f.effects.updated, 1);
    equal(f.invoices.size, 1);
    equal(f.effects.synced, 0);
  }
});
Deno.test("mesmo plano ativo não abre checkout; past_due/incomplete sem receipt exigem gestão sem nova cobrança", async () => {
  for (
    const status of ["active", "past_due", "incomplete", "unpaid", "paused"]
  ) {
    const f = fixture();
    f.addSubscription("pro", status);
    const result = await f.prepare();
    equal(result.kind, status === "active" ? "active" : "manage");
    equal(f.effects.created, 0);
    equal(f.effects.updated, 0);
  }
});
Deno.test("assinatura incomplete originada do próprio Elements retoma a sessão existente", async () => {
  const f = fixture();
  const first = await f.prepare();
  f.addSubscription("pro", "incomplete");
  const second = await f.prepare("pro", 2);
  equal(second.sessionId, first.sessionId);
  equal(f.effects.created, 1);
});
Deno.test("assinatura admin vigente é respeitada; sync recusado não informa active", async () => {
  const f = fixture();
  Object.assign(f.profiles.get(owner.id)!, {
    plan: "premium",
    entitlement_source: "admin",
    plan_expires_at: "2030-01-01T00:00:00Z",
  });
  equal((await f.prepare("premium")).kind, "active");
  equal(f.effects.created, 0);
  const g = fixture();
  g.addSubscription("pro");
  g.setSync(false);
  equal((await g.prepare()).kind, "manage");
});
Deno.test("status/cancel são owner-scoped e expirar checkout não cancela assinatura", async () => {
  const f = fixture(), first = await f.prepare();
  await rejects(
    f.makeService().execute(other, {
      action: "status",
      sessionId: first.sessionId,
    }),
    "not_found",
  );
  await rejects(
    f.makeService().execute(owner, {
      action: "status",
      sessionId: first.sessionId,
      plan: "premium",
    }),
    "plan_mismatch",
  );
  equal(
    (await f.makeService().execute(owner, {
      action: "cancel",
      sessionId: first.sessionId,
    })).kind,
    "canceled",
  );
  equal(f.effects.expired, 1);
  equal(f.effects.updated, 0);
});
Deno.test("status de checkout completo não concede unpaid/past_due nem aceita produto inesperado", async () => {
  const f = fixture(),
    first = await f.prepare(),
    session = f.sessions.get(first.sessionId);
  const sub = f.addSubscription("pro", "past_due");
  Object.assign(session, {
    status: "complete",
    payment_status: "paid",
    subscription: sub.id,
  });
  equal(
    (await f.makeService().execute(owner, {
      action: "status",
      sessionId: first.sessionId,
    })).state,
    "pending",
  );
  equal(f.effects.synced, 0);
  sub.status = "active";
  sub.items.data[0].price.id = "price_unexpected";
  equal(
    (await f.makeService().execute(owner, {
      action: "status",
      sessionId: first.sessionId,
    })).state,
    "pending",
  );
  equal(f.effects.synced, 0);
  sub.items.data[0].price.id = STRIPE_PLANS.pro.priceId;
  equal(
    (await f.makeService().execute(owner, {
      action: "status",
      sessionId: first.sessionId,
    })).state,
    "active",
  );
  equal(f.effects.synced, 1);
});
Deno.test("legado e Elements compartilham receipt: hosted não iniciado migra para custom antes de trocar plano", async () => {
  const f = fixture();
  const legacy = await f.makeService("hosted").execute(owner, {
    action: "prepare",
    plan: "pro",
    operationId: request(1),
  });
  assert(legacy.url);
  const integrated = await f.prepare("pro", 2);
  equal(integrated.kind, "checkout");
  equal(f.sessions.get("cs_test_take1").status, "expired");
  equal((await f.prepare("pro", 4)).sessionId, integrated.sessionId);
  const premium = await f.prepare("premium", 3);
  equal([premium.kind, premium.plan], ["checkout", "premium"]);
  equal(f.sessions.get(integrated.sessionId).status, "expired");
  equal(f.effects.created, 3);
  equal(f.effects.expired, 2);
  const g = fixture();
  await g.prepare();
  await rejects(
    g.makeService("hosted").execute(owner, {
      action: "prepare",
      plan: "pro",
      operationId: request(2),
    }).then((result) => {
      if (!result.url) throw new Error("legacy must report in-progress");
    }),
  );
  equal(g.effects.created, 1);
});
Deno.test("sessão hospedada anterior ao ledger é validada e encerrada antes de substituir", async () => {
  const f = fixture();
  f.addSession();
  equal((await f.prepare()).kind, "checkout");
  equal(f.effects.created, 1);
  equal(f.effects.expired, 1);
  equal(f.sessions.get("cs_test_old").status, "expired");
  const adopted = Array.from(f.ledger.values()).find((op) =>
    op.sessionId === "cs_test_old"
  )!;
  equal(adopted.state, "canceled");
  equal(
    (await f.makeService().execute(owner, {
      action: "status",
      sessionId: "cs_test_old",
    })).state,
    "expired",
  );
});
Deno.test("receipt terminal conserva referências e intenção nova não reaproveita criação expirada", async () => {
  const f = fixture(), first = await f.prepare();
  await f.makeService().execute(owner, {
    action: "cancel",
    sessionId: first.sessionId,
  });
  const resumed = await f.prepare();
  equal(resumed.kind, "status");
  equal(resumed.state, "expired");
  equal(resumed.operationId, first.operationId);
  equal(resumed.sessionId, first.sessionId);
  equal(f.effects.created, 1);
  const next = await f.prepare("pro", 2);
  equal(next.kind, "checkout");
  assert(next.sessionId !== first.sessionId);
  equal(f.effects.created, 2);

  const g = fixture();
  // Simulate a durable pre-create receipt followed by a transport failure,
  // with no Stripe side effect. This never claims an ambiguous charge succeeded.
  const originalCreate = g.stripe.checkout.sessions.create;
  g.stripe.checkout.sessions.create = async () => {
    throw new Error("request never reached Stripe");
  };
  await rejects(g.prepare());
  const receipt = Array.from(g.ledger.values())[0];
  equal(receipt.state, "creating");
  g.advance(3_600_001);
  const expired = await g.prepare();
  equal(expired.kind, "status");
  equal(expired.state, "failed");
  equal(expired.operationId, receipt.id);
  equal(g.effects.created, 0);
  g.stripe.checkout.sessions.create = originalCreate;
  equal((await g.prepare("pro", 2)).kind, "checkout");
  equal(g.effects.created, 1);
});
Deno.test("upgrade recupera Basil confirmation_secret sem payments e pagamento imediato só ativa após sync", async () => {
  const f = fixture();
  f.addSubscription("pro");
  const quote = await f.prepare("premium");
  const payment = await f.makeService().execute(owner, {
    action: "confirm_upgrade",
    quoteToken: quote.quoteToken,
    operationId: request(2),
  });
  const invoice = Array.from(f.invoices.values())[0];
  delete invoice.payments;
  const resumed = await f.prepare("premium", 3);
  equal(resumed.kind, "upgrade_payment");
  equal(resumed.paymentIntentId, payment.paymentIntentId);
  equal(resumed.clientSecret, payment.clientSecret);
  equal(f.effects.updated, 1);

  const g = fixture();
  g.addSubscription("pro");
  g.setPaid();
  const paidQuote = await g.prepare("premium");
  equal(g.effects.updated, 0);
  const paid = await g.makeService().execute(owner, {
    action: "confirm_upgrade",
    quoteToken: paidQuote.quoteToken,
    operationId: request(2),
  });
  equal(paid.status, "active");
  equal(paid.clientSecret, null);
  equal(g.effects.updated, 1);
  equal(g.effects.synced, 1);
  equal(g.profiles.get(owner.id)!.plan, "premium");
});
Deno.test("downgrade futuro mantém Premium pago e não oferece outra cobrança em nenhum plano", async () => {
  for (const target of ["pro", "premium"] as const) {
    const f = fixture(), sub = f.addSubscription("pro");
    sub.metadata.pending_plan = "pro";
    Object.assign(f.profiles.get(owner.id)!, {
      plan: "premium",
      pending_plan: "pro",
      pending_plan_effective_at: new Date(
        sub.items.data[0].current_period_end * 1000,
      ).toISOString(),
    });
    equal((await f.prepare(target)).kind, "manage");
    equal(f.effects.created, 0);
    equal(f.effects.updated, 0);
    equal(f.effects.synced, 0);
  }
  // Lost downgrade response: Stripe already changed its price, while the
  // protected profile still records the paid Premium period.
  const lost = fixture(), sub = lost.addSubscription("pro");
  sub.metadata.pending_plan = "pro";
  lost.profiles.get(owner.id)!.plan = "premium";
  equal((await lost.prepare("premium")).kind, "manage");
  equal(lost.effects.updated, 0);
});
Deno.test("data do downgrade é fixa: renovação não estende Premium e upgrade efetivo libera pending", () => {
  const f = fixture(), sub = f.addSubscription("pro"), now = 1_800_000_000_000;
  sub.metadata.pending_plan = "pro";
  const effectiveAt = new Date(now + 60_000).toISOString();
  const profile = {
    plan: "premium",
    pending_plan: "pro",
    pending_plan_effective_at: effectiveAt,
  };
  equal(pendingWebDowngrade(profile, sub, now), effectiveAt);
  sub.items.data[0].current_period_end += 2_592_000;
  equal(pendingWebDowngrade(profile, sub, now + 60_001), null);
  sub.items.data[0].price = {
    id: STRIPE_PLANS.premium.priceId,
    product: STRIPE_PLANS.premium.productId,
  };
  equal(pendingWebDowngrade(profile, sub, now), null);
});
Deno.test("status de receipt Pro antigo usa adapter real sem apagar downgrade Premium futuro", async () => {
  const f = fixture(),
    first = await f.prepare(),
    sub = f.addSubscription("pro");
  sub.items.data[0].current_period_end = Math.floor(
    Math.max(1_800_000_000_000, Date.now()) / 1000,
  ) + 86_400;
  sub.metadata.pending_plan = "pro";
  const effectiveAt = new Date(
    sub.items.data[0].current_period_end * 1000,
  ).toISOString();
  Object.assign(f.profiles.get(owner.id)!, {
    plan: "premium",
    pending_plan: "pro",
    pending_plan_effective_at: effectiveAt,
  });
  Object.assign(f.sessions.get(first.sessionId), {
    status: "complete",
    payment_status: "paid",
    subscription: sub.id,
  });
  const calls: Record<string, any>[] = [];
  const adapter = createWebCheckoutRepository({
    from: (table: string) => {
      equal(table, "profiles");
      return {
        select: (columns: string) => {
          assert(columns.includes("pending_plan_effective_at"));
          return {
            eq: (_key: string, value: string) => ({
              single: () => {
                equal(value, owner.id);
                return Promise.resolve({
                  data: clone(f.profiles.get(value)),
                  error: null,
                });
              },
            }),
          };
        },
      };
    },
    rpc: (name: string, params: Record<string, any>) => {
      equal(name, "sync_subscription_state_v1");
      calls.push(params);
      // Real RPC's authoritative output: Premium remains during the paid period.
      return Promise.resolve({
        data: { plan: "premium", status: "active" },
        error: null,
      });
    },
  });
  f.repo.sync = adapter.sync;
  const result = await f.makeService().execute(owner, {
    action: "status",
    sessionId: first.sessionId,
  });
  equal(result.state, "pending");
  equal(result.effectivePlan, "premium");
  equal(calls.length, 1);
  equal(calls[0].p_pending_plan, "pro");
  equal(calls[0].p_pending_effective_at, effectiveAt);
  equal(f.profiles.get(owner.id)!.plan, "premium");
  equal(f.effects.updated, 0);
});
Deno.test("request inválido e configuração ausente falham sem IO/cobrança", async () => {
  for (
    const value of [
      { action: "prepare", plan: "free", operationId: request(1) },
      { action: "prepare", plan: "pro", operationId: "random" },
      {
        action: "status",
        sessionId: "cs_test_take1",
        paymentIntentId: "pi_bad",
      },
      { action: "cancel", paymentIntentId: "pi_bad" },
    ]
  ) {
    try {
      parseWebCheckoutRequest(value);
      throw new Error("invalid accepted");
    } catch (error) {
      assert(error instanceof WebCheckoutError);
    }
  }
  const f = fixture();
  const service = createWebSubscriptionCheckoutService({
    repository: f.repo,
    stripe: f.stripe,
    publishableKey: "",
    returnOrigin: "https://classfy.example",
  });
  await rejects(
    service.execute(owner, {
      action: "prepare",
      plan: "pro",
      operationId: request(1),
    }),
    "checkout_not_configured",
  );
  equal(f.effects.created, 0);
});

Deno.test("custom órfão do mesmo plano é adotado duravelmente e retomado sem cache nem novo create", async () => {
  for (const metadataReceipt of [false, true]) {
    const f = fixture(), session = f.addSession("cs_orphan", "pro", "custom");
    if (metadataReceipt) session.metadata.web_checkout_operation = request(50);
    const first = await f.prepare("pro", 1);
    equal([first.kind, first.sessionId, first.clientSecret], [
      "checkout",
      session.id,
      session.client_secret,
    ]);
    const receipt = f.ledger.get(first.operationId)!;
    equal([receipt.ownerId, receipt.sessionId, receipt.state], [
      owner.id,
      session.id,
      "prepared",
    ]);
    equal((await f.prepare("pro", 2)).sessionId, session.id);
    equal([f.effects.created, f.effects.expired], [0, 0]);
    equal(
      (await f.makeService().execute(owner, {
        action: "status",
        sessionId: session.id,
      })).state,
      "pending",
    );
    await rejects(
      f.makeService().execute(other, {
        action: "status",
        sessionId: session.id,
      }),
      "not_found",
    );
  }
});

Deno.test("falha ao gravar adoção não expõe segredo nem cria outra cobrança; retry usa a mesma sessão", async () => {
  const f = fixture();
  f.addSession("cs_orphan", "pro", "custom");
  f.failures.savePrepared = true;
  await rejects(f.prepare());
  equal([f.effects.created, f.effects.expired, f.ledger.size], [0, 0, 0]);
  equal((await f.prepare()).sessionId, "cs_orphan");
  equal(f.ledger.size, 1);
});

Deno.test("troca de plano encerra todas as sessões próprias não iniciadas e ignora compras avulsas", async () => {
  const f = fixture();
  f.addSession("cs_old1", "pro", "hosted");
  f.addSession("cs_old2", "pro", "custom");
  const purchase = f.addSession("cs_course", "pro", "hosted");
  purchase.mode = "payment";
  const seen: string[] = [], expire = f.stripe.checkout.sessions.expire;
  f.stripe.checkout.sessions.expire = async (id, params, options) => {
    equal(f.effects.created, 0);
    seen.push(id);
    return await expire(id, params, options);
  };
  const response = await f.prepare("premium");
  equal([response.kind, response.plan], ["checkout", "premium"]);
  equal(seen, ["cs_old1", "cs_old2"]);
  equal([f.effects.created, f.effects.expired, purchase.status], [
    1,
    2,
    "open",
  ]);
  equal((await f.prepare("premium", 2)).sessionId, response.sessionId);
  equal(f.effects.created, 1);
});

Deno.test("vários custom do mesmo plano preservam um único checkout retomável", async () => {
  const f = fixture();
  f.addSession("cs_keep", "pro", "custom");
  f.addSession("cs_extra", "pro", "custom");
  const resumed = await f.prepare();
  equal(resumed.sessionId, "cs_keep");
  equal([f.sessions.get("cs_keep").status, f.sessions.get("cs_extra").status], [
    "open",
    "expired",
  ]);
  equal([f.effects.created, f.effects.expired], [0, 1]);
});

Deno.test("sessões estrangeiras ou sem ownership/preço comprovado impedem recuperação sem qualquer expiração", async () => {
  const alterations: ((session: any) => void)[] = [
    (session) => {
      session.metadata.user_id = other.id;
    },
    (session) => {
      delete session.metadata.user_id;
    },
    (session) => {
      session.metadata.plan_type = "free";
    },
    (session) => {
      session.line_items.data[0].price.id = "price_foreign";
    },
    (session) => {
      session.line_items.data[0].price.product = "prod_foreign";
    },
    (session) => {
      session.line_items.data[0].quantity = 2;
    },
    (session) => {
      session.line_items.has_more = true;
    },
    (session) => {
      session.currency = "usd";
    },
    (session) => {
      session.client_reference_id = other.id;
    },
    (session) => {
      session.metadata.web_checkout_operation = "invalid";
    },
  ];
  for (const alter of alterations) {
    const f = fixture();
    f.addSession("cs_valid");
    alter(f.addSession("cs_unverified"));
    await rejects(f.prepare());
    equal([f.effects.created, f.effects.expired, f.ledger.size], [0, 0, 0]);
    equal(f.sessions.get("cs_valid").status, "open");
  }
  const f = fixture();
  f.addSession();
  const list = f.stripe.checkout.sessions.list;
  f.stripe.checkout.sessions.list = async (params) => ({
    ...await list(params),
    has_more: true,
  });
  await rejects(f.prepare(), "billing_history_unavailable");
  equal([f.effects.created, f.effects.expired], [0, 0]);
});

Deno.test("pagamento iniciado ou referências desconhecidas nunca são expirados para trocar plano", async () => {
  for (
    const reference of [
      "subscription",
      "invoice",
      "payment_intent",
      "setup_intent",
      "missing",
    ]
  ) {
    const f = fixture();
    f.addSession("cs_safe");
    const protectedSession = f.addSession("cs_started", "pro", "custom") as any;
    if (reference === "missing") delete protectedSession.invoice;
    else protectedSession[reference] = `${reference}_started`;
    const result = await f.prepare("premium");
    equal([result.kind, result.plan], ["manage", "pro"]);
    assert(result.message.includes("ainda precisa ser confirmado"));
    equal([f.effects.created, f.effects.expired], [0, 0]);
    equal(f.sessions.get("cs_safe").status, "open");
  }
});

Deno.test("expire com resposta perdida só libera novo checkout depois de reler expired", async () => {
  const f = fixture();
  f.addSession();
  const expire = f.stripe.checkout.sessions.expire;
  f.stripe.checkout.sessions.expire = async (...args) => {
    await expire(...args);
    throw new Error("Stripe expired but reply was lost");
  };
  equal((await f.prepare()).kind, "checkout");
  equal([f.effects.created, f.effects.expired], [1, 1]);
});

Deno.test("expire recusado ou resposta ainda open não autoriza nova sessão nem receipt cancelado", async () => {
  for (const throws of [true, false]) {
    const f = fixture();
    f.addSession();
    f.stripe.checkout.sessions.expire = async (id) => {
      if (throws) throw new Error("cannot expire now");
      return clone(f.sessions.get(id));
    };
    const result = await f.prepare();
    equal([result.kind, result.state], ["status", "pending"]);
    equal([f.effects.created, f.effects.expired], [0, 0]);
    equal(Array.from(f.ledger.values())[0].state, "prepared");
    equal(f.sessions.get("cs_test_old").status, "open");
  }
});

Deno.test("Checkout complete durante expire é reconciliado e nunca seguido por nova assinatura", async () => {
  for (const paid of [true, false]) {
    const f = fixture();
    f.addSession();
    f.stripe.checkout.sessions.expire = async (id) => {
      const session = f.sessions.get(id);
      session.status = "complete";
      session.payment_status = paid ? "paid" : "unpaid";
      session.subscription =
        f.addSubscription("pro", paid ? "active" : "incomplete").id;
      throw new Error("Checkout completed before expiration");
    };
    const result = await f.prepare("premium");
    equal([result.kind, result.plan], ["manage", "pro"]);
    assert(
      result.message.includes(
        paid ? "foi confirmado" : "ainda precisa ser confirmado",
      ),
    );
    equal([f.effects.created, f.effects.expired, f.effects.synced], [
      0,
      0,
      paid ? 1 : 0,
    ]);
  }
});

Deno.test("assinatura descoberta depois de expire impede create mesmo ausente no primeiro list", async () => {
  const f = fixture();
  f.addSession();
  const expire = f.stripe.checkout.sessions.expire;
  f.stripe.checkout.sessions.expire = async (...args) => {
    const result = await expire(...args);
    f.addSubscription("pro");
    return result;
  };
  const result = await f.prepare("premium");
  equal([result.kind, result.plan], ["manage", "pro"]);
  equal([f.effects.created, f.effects.expired, f.effects.synced], [0, 1, 1]);
});

Deno.test("cancel compatível não expira checkout com pagamento iniciado nem marca complete como cancelado", async () => {
  for (
    const reference of [
      "subscription",
      "invoice",
      "payment_intent",
      "setup_intent",
    ]
  ) {
    const f = fixture(), first = await f.prepare();
    f.sessions.get(first.sessionId)[reference] = `${reference}_started`;
    const result = await f.makeService().execute(owner, {
      action: "cancel",
      sessionId: first.sessionId,
    });
    equal([result.kind, result.state], ["status", "pending"]);
    equal(f.effects.expired, 0);
    equal(f.ledger.get(first.operationId)!.state, "prepared");
  }
  const f = fixture(), first = await f.prepare();
  f.stripe.checkout.sessions.expire = async (id) => {
    const session = f.sessions.get(id);
    session.status = "complete";
    session.payment_status = "paid";
    session.subscription = f.addSubscription().id;
    return clone(session);
  };
  const result = await f.makeService().execute(owner, {
    action: "cancel",
    sessionId: first.sessionId,
  });
  equal([result.kind, result.state], ["status", "active"]);
  equal(f.ledger.get(first.operationId)!.state, "completed");
});

Deno.test("receipt prepared expirado permite nova intenção sem reutilizar params/idempotency antigos", async () => {
  const f = fixture(), first = await f.prepare();
  f.sessions.get(first.sessionId).status = "expired";
  const next = await f.prepare("pro", 2);
  equal(next.kind, "checkout");
  assert(next.sessionId !== first.sessionId);
  equal(f.ledger.get(first.operationId)!.state, "canceled");
  equal([f.effects.created, f.effects.expired], [2, 0]);
  equal((await f.prepare()).state, "expired");
});

Deno.test("lease que expira durante inspeção não pode executar expire nem preparar outro checkout", async () => {
  const f = fixture();
  f.addSession();
  const save = f.repo.save;
  f.repo.save = async (...args) => {
    await save(...args);
    // Canonical ownership is saved, but the worker loses its reservation before
    // the external mutation. The pre-expire fence must catch this exact window.
    f.advance(90_001);
  };
  await rejects(f.prepare());
  equal([f.effects.created, f.effects.expired], [0, 0]);
  equal(f.sessions.get("cs_test_old").status, "open");
});

Deno.test("complete entre list e retrieve confirma o plano existente sem retornar DTO incompatível", async () => {
  const f = fixture();
  f.addSession();
  const list = f.stripe.checkout.sessions.list;
  f.stripe.checkout.sessions.list = async (params) => {
    const listed = await list(params);
    const session = f.sessions.get("cs_test_old");
    session.status = "complete";
    session.payment_status = "paid";
    session.subscription = f.addSubscription("pro").id;
    return listed;
  };
  const result = await f.prepare("premium");
  equal([result.kind, result.plan, f.effects.synced], ["manage", "pro", 1]);
  assert(result.message.includes("foi confirmado"));
  equal([f.effects.created, f.effects.expired], [0, 0]);
});

Deno.test("expire confirmado com falha do ledger é recuperado sem reutilizar checkout expirado", async () => {
  const f = fixture();
  f.addSession();
  const save = f.repo.save;
  let failOnce = true;
  f.repo.save = async (...args) => {
    if (args[2].state === "canceled" && failOnce) {
      failOnce = false;
      throw new Error("DB reply lost after confirmed expiration");
    }
    await save(...args);
  };
  await rejects(f.prepare());
  equal([f.effects.created, f.effects.expired], [0, 1]);
  equal(f.sessions.get("cs_test_old").status, "expired");
  equal((await f.prepare("pro", 2)).kind, "checkout");
  equal([f.effects.created, f.effects.expired], [1, 1]);
  equal(
    Array.from(f.ledger.values()).find((op) => op.sessionId === "cs_test_old")!
      .state,
    "canceled",
  );
});
