export type SubscriptionPlan = "pro" | "premium";

export const STRIPE_PLANS: Record<SubscriptionPlan, { name: string; priceId: string; productId: string }> = {
  pro: {
    name: "Classfy Pro",
    priceId: "price_1SWKSDBW0e1s8a6ZRbWZI6Fm",
    productId: "prod_TTH0TCgKCJn5QS",
  },
  premium: {
    name: "Classfy Premium",
    priceId: "price_1SWKT6BW0e1s8a6ZGKTT7wTV",
    productId: "prod_TTH12wU8lOauHD",
  },
};

const PRODUCT_TO_PLAN: Record<string, SubscriptionPlan> = Object.fromEntries(
  Object.entries(STRIPE_PLANS).map(([plan, config]) => [config.productId, plan])
) as Record<string, SubscriptionPlan>;

const BILLABLE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

interface StripeCustomer {
  id: string;
  deleted?: boolean;
}

interface StripeSubscription {
  id: string;
  status: string;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items: {
    data: Array<{
      id?: string;
      price?: {
        product?: string;
      };
    }>;
  };
}

interface StripeClient {
  customers: {
    retrieve: (customerId: string) => Promise<StripeCustomer>;
    list: (params: { email: string; limit: number }) => Promise<{ data: StripeCustomer[] }>;
    create: (params: { email: string; metadata: Record<string, string> }) => Promise<StripeCustomer>;
  };
  subscriptions: {
    list: (params: { customer: string; status: string; limit: number }) => Promise<{ data: StripeSubscription[] }>;
  };
}

interface ProfileBillingState {
  billing_id: string | null;
  plan?: string | null;
  plan_expires_at?: string | null;
}

interface SupabaseQueryBuilder {
  select: (columns: string) => SupabaseQueryBuilder;
  update: (values: Record<string, unknown>) => SupabaseQueryBuilder;
  eq: (column: string, value: string) => SupabaseQueryBuilder;
  maybeSingle: () => Promise<{ data: ProfileBillingState | null }>;
}

interface SupabaseAdminClient {
  from: (table: string) => SupabaseQueryBuilder;
}

export function isSubscriptionPlan(plan: unknown): plan is SubscriptionPlan {
  return plan === "pro" || plan === "premium";
}

export function getPlanFromProduct(productId?: string | null, fallback?: string | null): SubscriptionPlan {
  if (productId && PRODUCT_TO_PLAN[productId]) return PRODUCT_TO_PLAN[productId];
  return isSubscriptionPlan(fallback) ? fallback : "pro";
}

export function getSubscriptionPeriodEnd(subscription: StripeSubscription | null | undefined): string | null {
  const currentPeriodEnd = subscription?.current_period_end;
  return typeof currentPeriodEnd === "number"
    ? new Date(currentPeriodEnd * 1000).toISOString()
    : null;
}

export function getRequestOrigin(req: Request): string {
  return req.headers.get("origin") || Deno.env.get("APP_URL") || "https://classfy.com.br";
}

export async function getOrCreateStripeCustomer(
  stripe: StripeClient,
  supabase: SupabaseAdminClient,
  user: { id: string; email: string }
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("billing_id, plan, plan_expires_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.billing_id) {
    try {
      const customer = await stripe.customers.retrieve(profile.billing_id);
      if (!customer?.deleted) return customer.id;
    } catch (error) {
      console.warn("[STRIPE] Stored billing_id is invalid, searching by email:", error);
    }
  }

  const customers = await stripe.customers.list({ email: user.email, limit: 1 });
  let customerId = customers.data[0]?.id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
  }

  await supabase
    .from("profiles")
    .update({ billing_id: customerId })
    .eq("id", user.id);

  return customerId;
}

export async function findStripeCustomer(
  stripe: StripeClient,
  supabase: SupabaseAdminClient,
  user: { id: string; email: string }
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("billing_id, plan, plan_expires_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.billing_id) {
    try {
      const customer = await stripe.customers.retrieve(profile.billing_id);
      if (!customer?.deleted) return { customerId: customer.id, profile };
    } catch (error) {
      console.warn("[STRIPE] Stored billing_id is invalid, searching by email:", error);
    }
  }

  const customers = await stripe.customers.list({ email: user.email, limit: 1 });
  const customerId = customers.data[0]?.id ?? null;

  if (customerId && customerId !== profile?.billing_id) {
    await supabase
      .from("profiles")
      .update({ billing_id: customerId })
      .eq("id", user.id);
  }

  return { customerId, profile };
}

export async function findBillableSubscription(stripe: StripeClient, customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });

  return subscriptions.data.find((subscription) =>
    BILLABLE_SUBSCRIPTION_STATUSES.has(subscription.status)
  ) ?? null;
}
