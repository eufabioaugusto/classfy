export type Plan = "free" | "pro" | "premium";
export type PointType = "user" | "creator";

export interface EconomySettings {
  version: 1;
  pool_percentage: number;
  user_points_multipliers: Record<Plan, number>;
  reward_maturation_days: Record<Plan, number>;
  minimum_withdrawal_amount: number;
  sales_commission_percent: number;
  creator_sales_hold_days: number;
  subscription_grace_period_days: number;
  referral_commission_percent: number;
}

export const DEFAULT_ECONOMY_SETTINGS: EconomySettings = {
  version: 1,
  pool_percentage: 40,
  user_points_multipliers: { free: 1, pro: 1.5, premium: 2 },
  reward_maturation_days: { free: 30, pro: 7, premium: 2 },
  minimum_withdrawal_amount: 10,
  sales_commission_percent: 20,
  creator_sales_hold_days: 7,
  subscription_grace_period_days: 3,
  referral_commission_percent: 10,
};

export function normalizePlan(value: unknown): Plan {
  return value === "pro" || value === "premium" ? value : "free";
}

export function mergeEconomySettings(value: unknown): EconomySettings {
  const raw = value && typeof value === "object"
    ? value as Partial<EconomySettings>
    : {};
  return {
    ...DEFAULT_ECONOMY_SETTINGS,
    ...raw,
    version: 1,
    user_points_multipliers: {
      ...DEFAULT_ECONOMY_SETTINGS.user_points_multipliers,
      ...(raw.user_points_multipliers || {}),
    },
    reward_maturation_days: {
      ...DEFAULT_ECONOMY_SETTINGS.reward_maturation_days,
      ...(raw.reward_maturation_days || {}),
    },
  };
}

export function calculatePoints(options: {
  basePoints: number;
  pointType: PointType;
  actorPlan: Plan;
  isOwnContent?: boolean;
}) {
  if (options.isOwnContent) return 0;
  const multiplier = options.pointType === "user"
    ? DEFAULT_ECONOMY_SETTINGS.user_points_multipliers[options.actorPlan]
    : 1;
  return roundPoints(Math.max(0, options.basePoints) * multiplier);
}

export function calculatePointsWithSettings(options: {
  basePoints: number;
  pointType: PointType;
  actorPlan: Plan;
  settings: EconomySettings;
  isOwnContent?: boolean;
}) {
  if (options.isOwnContent) return 0;
  const multiplier = options.pointType === "user"
    ? options.settings.user_points_multipliers[options.actorPlan]
    : 1;
  return roundPoints(Math.max(0, options.basePoints) * multiplier);
}

export function calculateSaleSplit(
  grossAmount: number,
  commissionPercent: number,
) {
  const gross = roundMoney(Math.max(0, grossAmount));
  const safePercent = Math.min(100, Math.max(0, commissionPercent));
  const classfyAmount = roundMoney(gross * safePercent / 100);
  return {
    grossAmount: gross,
    classfyPercent: safePercent,
    classfyAmount,
    creatorPercent: 100 - safePercent,
    creatorAmount: roundMoney(gross - classfyAmount),
  };
}

export function calculatePoolAmount(
  eligibleNetRevenue: number,
  poolPercentage: number,
) {
  const safeRevenue = Math.max(0, eligibleNetRevenue);
  const safePercentage = Math.min(100, Math.max(0, poolPercentage));
  return roundMoney(safeRevenue * safePercentage / 100);
}

export function allocatePool<T extends { id: string; points: number }>(
  poolAmount: number,
  participants: T[],
) {
  const valid = participants.filter((participant) => participant.points > 0);
  const totalPoints = valid.reduce(
    (sum, participant) => sum + participant.points,
    0,
  );
  const poolCents = Math.round(Math.max(0, poolAmount) * 100);
  if (totalPoints === 0 || poolCents === 0) {
    return valid.map((participant) => ({ ...participant, amount: 0 }));
  }

  const allocations = valid.map((participant) => {
    const rawCents = participant.points / totalPoints * poolCents;
    const cents = Math.floor(rawCents);
    return { ...participant, cents, remainder: rawCents - cents };
  });
  let remaining = poolCents -
    allocations.reduce((sum, allocation) => sum + allocation.cents, 0);
  allocations.sort((a, b) =>
    b.remainder - a.remainder || a.id.localeCompare(b.id)
  );
  for (const allocation of allocations) {
    if (remaining <= 0) break;
    allocation.cents += 1;
    remaining -= 1;
  }
  return allocations.map((
    { cents, remainder: _remainder, ...participant },
  ) => ({
    ...participant,
    amount: cents / 100,
  }));
}

export function resolveSubscriptionPlan(options: {
  status: string;
  stripePlan: Plan | null;
  currentPlan: Plan;
  periodEnd: Date | null;
  graceUntil: Date | null;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  if (options.status === "active" || options.status === "trialing") {
    return options.stripePlan ?? "free";
  }
  if (
    options.status === "past_due" && options.graceUntil &&
    options.graceUntil > now
  ) {
    return options.stripePlan ?? options.currentPlan;
  }
  if (
    options.status === "canceled" && options.periodEnd &&
    options.periodEnd > now
  ) {
    return options.stripePlan ?? options.currentPlan;
  }
  return "free";
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundPoints(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
