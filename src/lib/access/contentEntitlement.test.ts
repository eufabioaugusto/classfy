import { describe, expect, it } from "vitest";
import { evaluateContentEntitlement } from "./contentEntitlement";

describe("controle de acesso a conteúdo", () => {
  it("bloqueia conteúdo Pro para conta Free", () => {
    expect(
      evaluateContentEntitlement({
        visibility: "pro",
        userPlan: "free",
        isAuthenticated: true,
      }),
    ).toEqual({
      hasAccess: false,
      reason: "plan",
      requiredPlan: "pro",
    });
  });

  it("faz o admin respeitar o plano no consumo normal", () => {
    expect(
      evaluateContentEntitlement({
        visibility: "premium",
        userPlan: "free",
        isAuthenticated: true,
        isAdmin: true,
      }).hasAccess,
    ).toBe(false);
  });

  it("mantém o acesso administrativo na moderação", () => {
    expect(
      evaluateContentEntitlement({
        visibility: "premium",
        userPlan: "free",
        isAuthenticated: true,
        isAdmin: true,
        isModerationPreview: true,
      }).hasAccess,
    ).toBe(true);
  });

  it("libera conteúdo pago somente após a compra", () => {
    const base = {
      visibility: "paid" as const,
      userPlan: "premium",
      isAuthenticated: true,
    };

    expect(evaluateContentEntitlement(base).reason).toBe("purchase");
    expect(
      evaluateContentEntitlement({ ...base, isPurchased: true }).hasAccess,
    ).toBe(true);
  });
});
