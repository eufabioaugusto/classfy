const messages: Record<string, string> = {
  approved_creator_required: "O autor precisa ser um creator aprovado para publicar este conteúdo.",
  admin_required: "Somente administradores podem aprovar conteúdos.",
  Unauthorized: "Sua sessão expirou. Entre novamente para continuar.",
  reason_required: "Informe o motivo da decisão.",
  submission_not_found: "Esta submissão já foi analisada ou não está mais disponível. Atualize a página.",
};

export async function moderationErrorMessage(error: unknown, fallback: string) {
  let message = typeof error === "object" && error !== null && "message" in error
    && typeof error.message === "string" ? error.message : fallback;
  if (typeof error === "object" && error !== null && "context" in error && error.context instanceof Response) {
    const payload = await error.context.clone().json().catch(() => null);
    if (typeof payload?.error === "string") message = payload.error;
  }
  return messages[message] ?? (message === "Edge Function returned a non-2xx status code" || message === "Unknown error" ? fallback : message);
}
