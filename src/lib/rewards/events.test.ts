import { describe, expect, it, vi } from "vitest";
import { dispatchRewardEarned, subscribeToRewardEarned } from "./events";

describe("feedback de recompensas", () => {
  it("entrega o ganho ao avatar que monta depois do crédito", async () => {
    const reward = { eventId: "login-first-user", actionKey: "DAILY_LOGIN", userId: "first-user", points: 2, pointType: "user" as const };
    dispatchRewardEarned(reward);

    const listener = vi.fn();
    const unsubscribe = subscribeToRewardEarned(listener, "first-user");
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith(reward);
    unsubscribe();

    const otherUser = vi.fn();
    const unsubscribeOther = subscribeToRewardEarned(otherUser, "unrelated-user");
    await Promise.resolve();
    expect(otherUser).not.toHaveBeenCalled();
    unsubscribeOther();
  });

  it("não reapresenta o mesmo evento vindo da resposta local e do realtime", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRewardEarned(listener);
    const reward = { eventId: "login-second-user", actionKey: "DAILY_LOGIN", userId: "second-user", points: 3, pointType: "user" as const };

    dispatchRewardEarned(reward);
    dispatchRewardEarned(reward);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
