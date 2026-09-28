import { beforeEach, describe, expect, it } from "vitest";
import { clearPendingGoogleLogin, readLastLoginMethod, rememberCompletedGoogleLogin, rememberLoginMethod, startPendingGoogleLogin } from "./lastLoginMethod";

describe("último método de login", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it("não sugere método antes do primeiro login", () => {
    expect(readLastLoginMethod()).toBeNull();
  });

  it("mantém o método anterior quando Google é cancelado", () => {
    rememberLoginMethod("email");
    startPendingGoogleLogin();
    clearPendingGoogleLogin();
    expect(readLastLoginMethod()).toBe("email");
  });

  it("registra Google somente após retorno autenticado recente", () => {
    startPendingGoogleLogin();
    rememberCompletedGoogleLogin(new Date().toISOString());
    expect(readLastLoginMethod()).toBe("google");
    rememberLoginMethod("email");
    expect(readLastLoginMethod()).toBe("email");
  });

  it("não confunde sessão antiga com um novo login Google", () => {
    rememberLoginMethod("email");
    startPendingGoogleLogin();
    rememberCompletedGoogleLogin(new Date(Date.now() - 60000).toISOString());
    expect(readLastLoginMethod()).toBe("email");
  });
});
