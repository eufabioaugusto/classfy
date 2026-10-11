import {
  createSubscriptionBillingService,
  SubscriptionBillingError,
  type SubscriptionBillingStripe,
} from "./subscription-billing.ts";
import {
  createSubscriptionBillingFetch,
  createSubscriptionBillingHandler,
} from "./subscription-billing-http.ts";
import { STRIPE_PLANS } from "./stripe-subscription.ts";

type Json = Record<string, any>;
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
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
function assert(value: unknown): asserts value {
  if (!value) throw new Error("Condição não atendida");
}
async function rejects(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    equal((error as SubscriptionBillingError).code, code);
    return;
  }
  throw new Error("Esperava falha");
}
function fixture() {
  let time = 1_800_000_000_000;
  const calls: { name: string; params: any }[] = [];
  const profiles = new Map<string, any>([[owner, { billing_id: "cus_owner" }], [
    other,
    { billing_id: "cus_other" },
  ]]);
  const customers = new Map<string, any>([["cus_owner", {
    id: "cus_owner",
    metadata: { user_id: owner },
    invoice_settings: { default_payment_method: "pm_customer" },
  }], ["cus_other", {
    id: "cus_other",
    metadata: { user_id: other },
    invoice_settings: { default_payment_method: null },
  }]]);
  const subscriptions = new Map<string, any>();
  const invoices: Json[] = [];
  const methods = new Map<string, any>([["pm_customer", {
    id: "pm_customer",
    customer: "cus_owner",
    type: "card",
    card: {
      brand: "visa",
      last4: "4242",
      exp_month: 12,
      exp_year: 2030,
      fingerprint: "private_fingerprint",
    },
    billing_details: {
      email: "private@example.invalid",
      address: { line1: "private" },
    },
  }]]);
  let preview: any = {
    customer: "cus_owner",
    amount_due: 1290,
    currency: "brl",
  };
  const record = (name: string, params: any) =>
    calls.push({ name, params: clone(params) });
  const stripe: SubscriptionBillingStripe = {
    customers: {
      retrieve: async (id) => {
        record("customer.retrieve", id);
        return clone(customers.get(id));
      },
    },
    subscriptions: {
      list: async (params) => {
        record("subscription.list", params);
        return {
          data: [...subscriptions.values()].filter((sub) =>
            sub.customer === params.customer
          ).map(clone),
          has_more: false,
        };
      },
      retrieve: async (id) => {
        record("subscription.retrieve", id);
        return clone(subscriptions.get(id));
      },
    },
    invoices: {
      list: async (params) => {
        record("invoice.list", params);
        const rows = invoices.filter((invoice) =>
          invoice.customer === params.customer &&
          (!params.status || invoice.status === params.status)
        );
        const start = params.starting_after
          ? rows.findIndex((invoice) => invoice.id === params.starting_after) +
            1
          : 0;
        return {
          data: rows.slice(start, start + params.limit).map(clone),
          has_more: start + params.limit < rows.length,
        };
      },
      createPreview: async (params) => {
        record("invoice.preview", params);
        if (preview instanceof Error) throw preview;
        return clone(preview);
      },
    },
    paymentMethods: {
      retrieve: async (id) => {
        record("method.retrieve", id);
        return clone(methods.get(id));
      },
    },
  };
  const sub = (
    id = "sub_owner",
    plan: "pro" | "premium" = "pro",
    status = "active",
  ) => {
    const result = {
      id,
      customer: "cus_owner",
      metadata: { user_id: owner },
      status,
      cancel_at_period_end: false,
      cancel_at: null,
      pause_collection: null,
      pending_update: null,
      default_payment_method: null,
      items: {
        has_more: false,
        data: [{
          quantity: 1,
          current_period_end: Math.floor(time / 1000) + 86400,
          price: {
            id: STRIPE_PLANS[plan].priceId,
            product: STRIPE_PLANS[plan].productId,
          },
        }],
      },
    };
    subscriptions.set(id, result);
    return result;
  };
  const invoice = (
    status = "paid",
    plan: "pro" | "premium" = "pro",
    subId = "sub_owner",
  ) => {
    const number = invoices.length + 1;
    const result: Json = {
      id: `in_${number}`,
      customer: "cus_owner",
      status,
      number: status === "draft" ? null : `CF-${number}`,
      created: Math.floor(time / 1000) - number,
      due_date: status === "open" ? Math.floor(time / 1000) + 100 : null,
      amount_due: plan === "pro" ? 2990 : 4990,
      amount_paid: status === "paid" ? plan === "pro" ? 2990 : 4990 : 0,
      amount_remaining: status === "paid" ? 0 : plan === "pro" ? 2990 : 4990,
      currency: "brl",
      parent: {
        subscription_details: {
          subscription: subId,
          metadata: { user_id: owner, plan_type: plan },
        },
      },
      lines: {
        has_more: false,
        data: [{
          pricing: {
            price_details: {
              price: STRIPE_PLANS[plan].priceId,
              product: STRIPE_PLANS[plan].productId,
            },
          },
        }],
      },
      status_transitions: {
        paid_at: status === "paid" ? Math.floor(time / 1000) - number : null,
      },
      invoice_pdf: `https://pay.stripe.com/invoice/fixture${number}/pdf`,
      hosted_invoice_url: `https://invoice.stripe.com/i/fixture${number}`,
      customer_email: "private@example.invalid",
      customer_address: { line1: "private" },
      confirmation_secret: { client_secret: "private_secret" },
    };
    invoices.push(result);
    return result;
  };
  const service = () =>
    createSubscriptionBillingService({
      stripe,
      cursorSecret: "fixture_server_secret",
      now: () => time,
      profile: async (id) => {
        record("profile", id);
        return clone(profiles.get(id) ?? null);
      },
    });
  return {
    service,
    stripe,
    sub,
    invoice,
    profiles,
    customers,
    subscriptions,
    invoices,
    methods,
    calls,
    setPreview(value: any) {
      preview = value;
    },
    advance(ms: number) {
      time += ms;
    },
  };
}

Deno.test("conta sem billing_id é vazia e não descobre/cria customer por email", async () => {
  const f = fixture();
  f.profiles.get(owner).billing_id = null;
  equal(await f.service().read(owner, {}), {
    invoices: [],
    nextCursor: null,
    subscription: null,
  });
  equal(f.calls, [{ name: "profile", params: owner }]);
  await rejects(
    f.service().read(other, { customerId: "cus_owner" }),
    "invalid_request",
  );
  f.profiles.delete(owner);
  await rejects(f.service().read(owner, {}), "account_not_found");
});

Deno.test("faturas Basil preservam os cinco estados, PDFs oficiais e somente DTO mínimo", async () => {
  const f = fixture();
  f.sub();
  for (const status of ["paid", "open", "uncollectible", "void", "draft"]) {
    f.invoice(status);
  }
  const result = await f.service().read(owner, {});
  equal(result.invoices.map((row) => row.status), [
    "paid",
    "open",
    "uncollectible",
    "void",
    "draft",
  ]);
  equal([
    result.invoices[0].amountPaid,
    result.invoices[1].amountPaid,
    result.invoices[1].amountRemaining,
  ], [2990, 0, 2990]);
  equal([result.invoices[4].pdfUrl, result.invoices[4].hostedUrl], [
    null,
    null,
  ]);
  assert(result.invoices[0].pdfUrl?.startsWith("https://pay.stripe.com/"));
  equal(result.subscription?.nextRenewal?.amountDue, 1290); // Desconto real do preview; não preço de tabela.
  equal(result.subscription?.paymentMethod, {
    type: "card",
    brand: "visa",
    last4: "4242",
    expMonth: 12,
    expYear: 2030,
  });
  const serialized = JSON.stringify(result);
  for (
    const secret of [
      "cus_owner",
      "private",
      "fingerprint",
      "confirmation_secret",
      "customer_email",
      "billing_details",
    ]
  ) assert(!serialized.includes(secret));
  assert(
    f.calls.every((call) =>
      [
        "profile",
        "customer.retrieve",
        "subscription.list",
        "invoice.list",
        "invoice.preview",
        "method.retrieve",
      ].includes(call.name)
    ),
  );
});

Deno.test("histórico cancelado preserva Premium original mesmo após mudança da assinatura para Pro", async () => {
  const f = fixture();
  f.sub("sub_owner", "pro", "canceled");
  f.invoice("paid", "premium");
  const legacy = f.invoice("paid", "pro");
  legacy.subscription = "sub_owner";
  legacy.parent = null;
  legacy.lines.data = [{
    price: {
      id: STRIPE_PLANS.pro.priceId,
      product: STRIPE_PLANS.pro.productId,
    },
  }];
  const result = await f.service().read(owner, {});
  equal(result.invoices.map((row) => row.plan), ["premium", "pro"]);
  equal(result.subscription, null);
  assert(!f.calls.some((call) => call.name === "invoice.preview"));
});

Deno.test("compras avulsas, metadata de plano e produto estrangeiro não viram faturas da assinatura", async () => {
  const f = fixture();
  f.sub();
  const course = f.invoice();
  course.parent = null;
  const foreign = f.invoice();
  foreign.lines.data[0].pricing.price_details.product = "prod_foreign";
  const price = f.invoice();
  price.lines.data[0].pricing.price_details.price = null;
  const actual = f.invoice("paid", "premium");
  actual.parent.subscription_details.metadata.plan_type = "pro";
  const result = await f.service().read(owner, {});
  equal(result.invoices.map((row) => [row.id, row.plan]), [[
    actual.id,
    "premium",
  ]]);
});

Deno.test("produto canônico preserva fatura de preço antigo sem validar assinatura atual por esse preço", async () => {
  const f = fixture();
  const sub = f.sub("sub_owner", "premium", "active");
  sub.items.data[0].price.id = "price_oldPremium";
  const premium = f.invoice("paid", "premium");
  premium.lines.data[0].pricing.price_details.price = "price_oldPremium";
  premium.amount_due = 3990;
  premium.amount_paid = 3990;
  const pro = f.invoice("paid", "pro");
  pro.lines.data = [{
    price: { id: "price_oldPro", product: STRIPE_PLANS.pro.productId },
  }];
  pro.amount_due = 1990;
  pro.amount_paid = 1990;
  const result = await f.service().read(owner, {});
  equal(result.invoices.map((row) => [row.plan, row.amountPaid]), [
    ["premium", 3990],
    ["pro", 1990],
  ]);
  equal(result.subscription, null);
  assert(!f.calls.some((call) => call.name === "invoice.preview"));
  sub.status = "canceled";
  equal((await f.service().read(owner, {})).invoices.length, 2);
});

Deno.test("proração com Pro e Premium não recebe rótulo inventado de plano único", async () => {
  const f = fixture();
  f.sub();
  const invoice = f.invoice();
  invoice.lines.data.push({
    pricing: {
      price_details: {
        price: STRIPE_PLANS.premium.priceId,
        product: STRIPE_PLANS.premium.productId,
      },
    },
  });
  equal((await f.service().read(owner, {})).invoices[0].plan, null);
});

Deno.test("customer/invoice/subscription/snapshot de outra conta falham fechados sem dados privados", async () => {
  const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.customers.get("cus_owner").metadata.user_id = other;
    },
    (f) => {
      f.customers.get("cus_owner").deleted = true;
    },
    (f) => {
      f.subscriptions.get("sub_owner").metadata.user_id = other;
    },
    (f) => {
      f.invoices[0].metadata = { user_id: other };
    },
    (f) => {
      f.invoices[0].parent.subscription_details.metadata.user_id = other;
    },
    (f) => {
      f.stripe.invoices.list = async () => ({
        data: [{ ...f.invoices[0], customer: "cus_other" }],
        has_more: false,
      });
    },
    (f) => {
      f.stripe.subscriptions.list = async () => ({
        data: [{ ...f.subscriptions.get("sub_owner"), customer: "cus_other" }],
        has_more: false,
      });
    },
  ];
  for (const change of changes) {
    const f = fixture();
    f.sub();
    f.invoice();
    change(f);
    await rejects(f.service().read(owner, {}), "billing_owner_mismatch");
  }
});

Deno.test("assinatura histórica ausente no primeiro list é recuperada por ID do provider com ownership verificado", async () => {
  const f = fixture();
  f.sub("sub_old", "premium", "canceled");
  f.invoice("paid", "premium", "sub_old");
  f.stripe.subscriptions.list = async () => ({ data: [], has_more: false });
  equal((await f.service().read(owner, {})).invoices.length, 1);
  equal(
    f.calls.filter((call) => call.name === "subscription.retrieve").length,
    1,
  );
  f.subscriptions.get("sub_old").customer = "cus_other";
  await rejects(f.service().read(owner, {}), "billing_owner_mismatch");
});

Deno.test("legado sem customer metadata usa billing_id protegido; default card da assinatura precede o customer", async () => {
  const f = fixture();
  f.sub();
  f.customers.get("cus_owner").metadata = {};
  f.subscriptions.get("sub_owner").default_payment_method = "pm_sub";
  f.methods.set("pm_sub", {
    id: "pm_sub",
    customer: "cus_owner",
    type: "card",
    card: { brand: "mastercard", last4: "4444", exp_month: 1, exp_year: 2031 },
  });
  equal(
    (await f.service().read(owner, {})).subscription?.paymentMethod?.last4,
    "4444",
  );
  f.methods.get("pm_sub").customer = "cus_other";
  await rejects(f.service().read(owner, {}), "billing_owner_mismatch");
});

Deno.test("método sem cartão ou metadados incompletos não fabrica número/validade", async () => {
  for (
    const change of [(method: any) => {
      method.type = "pix";
    }, (method: any) => {
      method.card.last4 = "12345678";
    }, (method: any) => {
      method.card.exp_month = 20;
    }]
  ) {
    const f = fixture();
    f.sub();
    change(f.methods.get("pm_customer"));
    equal(
      (await f.service().read(owner, {})).subscription?.paymentMethod,
      null,
    );
  }
});

Deno.test("próxima cobrança só existe em active/trialing futura sem cancelamento/pause/pending", async () => {
  const changes: ((sub: any) => void)[] = [
    (sub) => {
      sub.status = "past_due";
    },
    (sub) => {
      sub.status = "incomplete";
    },
    (sub) => {
      sub.status = "unpaid";
    },
    (sub) => {
      sub.status = "paused";
    },
    (sub) => {
      sub.cancel_at_period_end = true;
    },
    (sub) => {
      sub.cancel_at = 1_800_086_400;
    },
    (sub) => {
      sub.pause_collection = { behavior: "void" };
    },
    (sub) => {
      sub.pending_update = { expires_at: 1_800_086_400 };
    },
    (sub) => {
      sub.items.data[0].current_period_end = 1_700_000_000;
    },
  ];
  for (const change of changes) {
    const f = fixture(), sub = f.sub();
    change(sub);
    equal((await f.service().read(owner, {})).subscription?.nextRenewal, null);
    assert(!f.calls.some((call) => call.name === "invoice.preview"));
  }
  const f = fixture();
  f.sub("sub_owner", "pro", "trialing");
  equal(
    (await f.service().read(owner, {})).subscription?.nextRenewal?.amountDue,
    1290,
  );
});

Deno.test("preview indisponível não apaga histórico nem inventa valor; owner divergente não é tolerado", async () => {
  const f = fixture();
  f.sub();
  f.invoice();
  f.setPreview(new Error("provider private request failed"));
  const result = await f.service().read(owner, {});
  equal(result.invoices.length, 1);
  equal(result.subscription?.nextRenewal, {
    at: new Date(1_800_086_400_000).toISOString(),
    amountDue: null,
    currency: null,
  });
  f.setPreview({ customer: "cus_other", amount_due: 100, currency: "brl" });
  await rejects(f.service().read(owner, {}), "billing_owner_mismatch");
});

Deno.test("filtro pending é global, inclui open/uncollectible e cursor não pula meio da página", async () => {
  const f = fixture();
  f.sub();
  f.invoice("paid");
  const open = f.invoice("open"),
    debt = f.invoice("uncollectible"),
    second = f.invoice("open");
  const first = await f.service().read(owner, { limit: 2, status: "pending" });
  equal(first.invoices.map((row) => [row.id, row.status]), [[open.id, "open"], [
    debt.id,
    "uncollectible",
  ]]);
  assert(first.nextCursor);
  const next = await f.service().read(owner, {
    limit: 2,
    status: "pending",
    cursor: first.nextCursor,
  });
  equal(next.invoices.map((row) => row.id), [second.id]);
  equal(next.nextCursor, null);
  const paid = await f.service().read(owner, { status: "paid" });
  equal(paid.invoices.map((row) => row.status), ["paid"]);
  assert(
    f.calls.some((call) =>
      call.name === "invoice.list" && call.params.status === "paid"
    ),
  );
});

Deno.test("scan limitado pode devolver página vazia com cursor, que preserva pending de páginas posteriores", async () => {
  const f = fixture();
  f.sub();
  for (let index = 0; index < 11; index++) f.invoice("paid");
  const debt = f.invoice("uncollectible");
  const first = await f.service().read(owner, { status: "pending", limit: 2 });
  equal(first.invoices, []);
  assert(first.nextCursor);
  equal(f.calls.filter((call) => call.name === "invoice.list").length, 5);
  const next = await f.service().read(owner, {
    status: "pending",
    limit: 2,
    cursor: first.nextCursor,
  });
  equal(next.invoices.map((row) => row.id), [debt.id]);
  equal(next.nextCursor, null);
});

Deno.test("cursor assinado rejeita conta/customer/filtro diferente, adulteração, formato e expiração antes do provider", async () => {
  const f = fixture();
  f.sub();
  f.invoice();
  f.invoice();
  const result = await f.service().read(owner, { limit: 1 });
  assert(result.nextCursor);
  const cursor = result.nextCursor;
  const providerCalls = () =>
    f.calls.filter((call) => call.name !== "profile").length;
  for (
    const [id, body] of [
      [other, { cursor }],
      [owner, { cursor, status: "paid" }],
      [owner, { cursor: cursor.slice(0, -2) + "xx" }],
      [owner, { cursor: "in_1" }],
    ] as const
  ) {
    const before = providerCalls();
    await rejects(f.service().read(id, body), "invalid_cursor");
    equal(providerCalls(), before);
  }
  f.profiles.get(owner).billing_id = "cus_other";
  await rejects(f.service().read(owner, { cursor }), "invalid_cursor");
  f.profiles.get(owner).billing_id = "cus_owner";
  f.advance(3_600_001);
  await rejects(f.service().read(owner, { cursor }), "invalid_cursor");
});

Deno.test("URLs inesperadas e draft não se tornam links; provider inválido não vira valor zero", async () => {
  for (
    const url of [
      "http://invoice.stripe.com/a",
      "https://invoice.stripe.com.evil.invalid/a",
      "javascript:alert(1)",
      "https://u:p@invoice.stripe.com/a",
      "https://invoice.stripe.com:444/a",
    ]
  ) {
    const f = fixture();
    f.sub();
    const invoice = f.invoice();
    invoice.invoice_pdf = url;
    invoice.hosted_invoice_url = url;
    const dto = (await f.service().read(owner, {})).invoices[0];
    equal([dto.pdfUrl, dto.hostedUrl], [null, null]);
  }
  const f = fixture();
  f.sub();
  f.invoice().amount_paid = "2990";
  await rejects(f.service().read(owner, {}), "billing_unavailable");
});

Deno.test("histórico incompleto/duplicidade e falhas do provider são explícitos, sem update de plano", async () => {
  const f = fixture();
  f.sub();
  f.sub("sub_extra");
  await rejects(f.service().read(owner, {}), "multiple_subscriptions");
  const g = fixture();
  g.stripe.subscriptions.list = async () => ({ data: [], has_more: true });
  await rejects(g.service().read(owner, {}), "billing_unavailable");
  const h = fixture();
  h.stripe.invoices.list = async () => {
    throw new Error("secret provider response private@example.invalid");
  };
  await rejects(h.service().read(owner, {}), "billing_unavailable");
});

Deno.test("requests arbitrários e paginação inválida falham antes de qualquer IO", async () => {
  const f = fixture();
  for (
    const body of [
      null,
      [],
      { invoiceId: "in_1" },
      { customer: "cus_other" },
      { limit: 0 },
      { limit: 26 },
      { limit: 1.5 },
      { status: "void" },
      { cursor: 123 },
    ]
  ) {
    await rejects(f.service().read(owner, body), "invalid_request");
  }
  equal(f.calls, []);
});

Deno.test("HTTP autentica owner server, protege dados e não expõe erro bruto do provider", async () => {
  const f = fixture();
  f.sub();
  f.invoice();
  let authenticated = 0;
  const handler = createSubscriptionBillingHandler({
    authenticate: async (token) => {
      authenticated++;
      return token === "fixture" ? owner : null;
    },
    read: f.service().read,
  });
  const req = (body: any, token = "fixture") =>
    new Request("https://fixture.invalid/billing", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  const denied = await handler(
    new Request("https://fixture.invalid/billing", {
      method: "POST",
      body: "{}",
    }),
  );
  equal([denied.status, authenticated, f.calls.length], [401, 0, 0]);
  equal((await handler(req({}, "expired"))).status, 401);
  equal((await handler(req({ owner: other }))).status, 400);
  const result = await handler(req({}));
  equal(result.status, 200);
  equal(result.headers.get("Cache-Control"), "no-store");
  equal((await result.json()).invoices.length, 1);
  const broken = createSubscriptionBillingHandler({
    authenticate: async () => {
      throw new Error("private_secret");
    },
    read: f.service().read,
  });
  const error = await broken(req({}));
  equal(error.status, 503);
  assert(!(await error.text()).includes("private_secret"));
  equal(
    (await handler(
      new Request("https://fixture.invalid/billing", { method: "OPTIONS" }),
    )).status,
    200,
  );
  equal(
    (await handler(new Request("https://fixture.invalid/billing"))).status,
    405,
  );
});

Deno.test("deadline de IO libera fetch que ignora AbortSignal e cancelamento externo também encerra", async () => {
  let signal: AbortSignal | undefined;
  const neverFetch = ((_input: any, init: any) => {
    signal = init.signal;
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  await rejects(
    createSubscriptionBillingFetch(neverFetch, 5)("https://fixture.invalid"),
    "network_timeout",
  );
  assert(signal?.aborted);
  const controller = new AbortController();
  const pending = createSubscriptionBillingFetch(neverFetch, 50)(
    "https://fixture.invalid",
    { signal: controller.signal },
  );
  controller.abort();
  await rejects(pending, "request_canceled");
  assert(signal?.aborted);
  const fast = createSubscriptionBillingFetch(
    (async () => new Response("{}")) as typeof fetch,
    5,
  );
  equal((await fast("https://fixture.invalid")).status, 200);
});
