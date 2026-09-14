import { assertEquals } from "jsr:@std/assert@1/equals";
import { getVerifiedUserId } from "./auth.ts";

Deno.test("getVerifiedUserId retorna o subject de um JWT verificado", async () => {
  const client = {
    auth: {
      getClaims: async (token: string) => ({
        data: token === "valid-token" ? { claims: { sub: "user-123" } } : null,
        error: null,
      }),
    },
  };

  assertEquals(
    await getVerifiedUserId(client, "Bearer valid-token"),
    "user-123",
  );
});

Deno.test("getVerifiedUserId rejeita header ou claims invalidos", async () => {
  const client = {
    auth: {
      getClaims: async () => ({
        data: { claims: {} },
        error: null,
      }),
    },
  };

  assertEquals(await getVerifiedUserId(client, ""), null);
  assertEquals(await getVerifiedUserId(client, "Bearer invalid-token"), null);
});
