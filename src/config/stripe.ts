// Stripe Products Configuration
export const STRIPE_PRODUCTS = {
  pro: {
    name: "Classfy Pro",
    priceId: "price_1SWKSDBW0e1s8a6ZRbWZI6Fm",
    productId: "prod_TTH0TCgKCJn5QS",
    amount: 2990, // R$ 29,90
    currency: "brl",
    interval: "month",
  },
  premium: {
    name: "Classfy Premium",
    priceId: "price_1SWKT6BW0e1s8a6ZGKTT7wTV",
    productId: "prod_TTH12wU8lOauHD",
    amount: 4990, // R$ 49,90
    currency: "brl",
    interval: "month",
  },
} as const;

export type PlanType = keyof typeof STRIPE_PRODUCTS;
