import { describe, expect, it } from "vitest";
import { moderationErrorMessage } from "./moderationError";

describe("erros de moderação", () => {
  it("mostra o motivo retornado pela função em vez do erro HTTP genérico", async () => {
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify({ error: "approved_creator_required" }), { status: 400 }),
    };
    expect(await moderationErrorMessage(error, "Erro ao aprovar")).toBe("O autor precisa ser um creator aprovado para publicar este conteúdo.");
  });
  it("preserva mensagem de processamento e trata resposta inválida", async () => {
    expect(await moderationErrorMessage({ context: new Response(JSON.stringify({ error: "As mídias ainda estão processando." })) }, "Erro ao aprovar")).toBe("As mídias ainda estão processando.");
    expect(await moderationErrorMessage({ message: "Edge Function returned a non-2xx status code", context: new Response("invalid") }, "Erro ao aprovar")).toBe("Erro ao aprovar");
  });
});
