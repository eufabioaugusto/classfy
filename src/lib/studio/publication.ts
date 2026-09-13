import { supabase } from "@/integrations/supabase/client";

export type PublicationKind = "aula" | "podcast" | "short" | "curso";
export type PublicationVisibility = "free" | "pro" | "premium" | "paid";
export type PublicationSaveState =
  "loading" | "saved" | "saving" | "offline" | "error";
export type MediaUploadState =
  | "idle"
  | "preparing"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled"
  | "abandoned";

export interface StandalonePublicationDraft {
  title: string;
  description: string;
  visibility: PublicationVisibility;
  price: string;
  discount: string;
  tags: string[];
  fileName?: string;
  fileUrl: string;
  thumbnailUrl: string;
  duration: number;
  mediaAssetId: string | null;
  videoProvider: string | null;
  uploadState: MediaUploadState;
}

export interface PublicationDraftRecord<TPayload = unknown> {
  id: string;
  owner_id: string;
  draft_key: string;
  kind: PublicationKind;
  source_type: "content" | "course" | null;
  source_id: string | null;
  payload: TPayload;
  revision: number;
  state: "draft" | "submitted" | "discarded";
  updated_at: string;
}

export const publicationRules = {
  aula: {
    label: "Aula",
    description: "Publique uma aula completa para sua audiência.",
    accept: "video/mp4,video/webm,video/quicktime",
    mediaType: "video" as const,
    maxDurationSeconds: null,
    coverRatio: "16:9",
  },
  podcast: {
    label: "Podcast",
    description: "Envie um episódio em áudio com capa e descrição.",
    accept: "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg",
    mediaType: "audio" as const,
    maxDurationSeconds: null,
    coverRatio: "1:1 ou 16:9",
  },
  short: {
    label: "Short",
    description: "Compartilhe um vídeo vertical de até 3 minutos.",
    accept: "video/mp4,video/webm,video/quicktime",
    mediaType: "video" as const,
    maxDurationSeconds: 180,
    coverRatio: "9:16",
  },
  curso: {
    label: "Curso",
    description: "Organize uma experiência completa de aprendizagem.",
    accept:
      "video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg",
    mediaType: "video" as const,
    maxDurationSeconds: null,
    coverRatio: "16:9",
  },
} satisfies Record<
  PublicationKind,
  {
    label: string;
    description: string;
    accept: string;
    mediaType: "video" | "audio";
    maxDurationSeconds: number | null;
    coverRatio: string;
  }
>;

export const visibilityOptions = [
  {
    id: "free" as const,
    label: "Gratuito",
    description: "Qualquer pessoa pode acessar",
  },
  {
    id: "pro" as const,
    label: "Pro",
    description: "Disponível para assinantes Pro",
  },
  {
    id: "premium" as const,
    label: "Premium",
    description: "Disponível para assinantes Premium",
  },
  { id: "paid" as const, label: "Pago", description: "Vendido separadamente" },
];

export function createNewPublicationDraftKey(
  kind: PublicationKind,
  id = crypto.randomUUID(),
) {
  return `${kind}:new:${id}`;
}

export function isNewPublicationDraftKey(
  kind: PublicationKind,
  draftKey: string | null | undefined,
) {
  return Boolean(
    draftKey &&
    (draftKey === `${kind}:new` || draftKey.startsWith(`${kind}:new:`)),
  );
}

export function getStandaloneDraftIssues(
  kind: Exclude<PublicationKind, "curso">,
  draft: StandalonePublicationDraft,
) {
  const issues: string[] = [];
  if (!draft.fileUrl || !draft.mediaAssetId)
    issues.push(kind === "podcast" ? "Envie o áudio" : "Envie o vídeo");
  if (draft.uploadState !== "ready")
    issues.push("Aguarde o processamento da mídia");
  if (!draft.title.trim()) issues.push("Informe o título");
  if (!draft.description.trim() && kind !== "short")
    issues.push("Escreva uma descrição");
  if (!draft.thumbnailUrl) issues.push("Escolha uma capa");
  if (kind === "short" && draft.duration > 180)
    issues.push("Reduza o short para até 3 minutos");
  if (
    draft.visibility === "paid" &&
    (!Number.isFinite(Number(draft.price)) || Number(draft.price) <= 0)
  ) {
    issues.push("Informe um preço válido");
  }
  return Array.from(new Set(issues));
}

const localKey = (ownerId: string, draftKey: string) =>
  `classfy:publication:${ownerId}:${draftKey}`;

export const publicationDraftService = {
  async load<TPayload>(
    ownerId: string,
    draftKey: string,
  ): Promise<PublicationDraftRecord<TPayload> | null> {
    const local = localStorage.getItem(localKey(ownerId, draftKey));
    let localDraft: PublicationDraftRecord<TPayload> | null = null;
    if (local) {
      try {
        localDraft = JSON.parse(local) as PublicationDraftRecord<TPayload>;
      } catch {
        localStorage.removeItem(localKey(ownerId, draftKey));
      }
    }

    const { data, error } = await (supabase as any)
      .from("publication_drafts")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("draft_key", draftKey)
      .eq("state", "draft")
      .maybeSingle();

    if (error) return localDraft;
    const remote = data as PublicationDraftRecord<TPayload> | null;
    if (!remote) return localDraft;
    if (
      !localDraft ||
      new Date(remote.updated_at).getTime() >=
        new Date(localDraft.updated_at).getTime()
    )
      return remote;
    return localDraft;
  },

  async save<TPayload>({
    ownerId,
    draftKey,
    kind,
    sourceType,
    sourceId,
    payload,
  }: {
    ownerId: string;
    draftKey: string;
    kind: PublicationKind;
    sourceType?: "content" | "course" | null;
    sourceId?: string | null;
    payload: TPayload;
  }): Promise<{ record: PublicationDraftRecord<TPayload>; remote: boolean }> {
    const optimistic = {
      id: `local:${crypto.randomUUID()}`,
      owner_id: ownerId,
      draft_key: draftKey,
      kind,
      source_type: sourceType ?? null,
      source_id: sourceId ?? null,
      payload,
      revision: 1,
      state: "draft" as const,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(
      localKey(ownerId, draftKey),
      JSON.stringify(optimistic),
    );

    const { data, error } = await (supabase as any).rpc(
      "save_publication_draft",
      {
        p_draft_key: draftKey,
        p_kind: kind,
        p_payload: payload,
        p_source_type: sourceType ?? null,
        p_source_id: sourceId ?? null,
      },
    );
    if (error || !data)
      return {
        record: optimistic as PublicationDraftRecord<TPayload>,
        remote: false,
      };
    const record = (
      Array.isArray(data) ? data[0] : data
    ) as PublicationDraftRecord<TPayload>;
    localStorage.setItem(localKey(ownerId, draftKey), JSON.stringify(record));
    return { record, remote: true };
  },

  async discard(ownerId: string, draftKey: string) {
    localStorage.removeItem(localKey(ownerId, draftKey));
    const { data } = await (supabase as any)
      .from("publication_drafts")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("draft_key", draftKey)
      .eq("state", "draft")
      .maybeSingle();
    if (data?.id) {
      const { error } = await (supabase as any).rpc(
        "discard_publication_draft",
        {
          p_draft_id: data.id,
        },
      );
      if (error) throw error;
      return;
    }
    const { error } = await (supabase as any)
      .from("publication_drafts")
      .update({ state: "discarded", updated_at: new Date().toISOString() })
      .eq("owner_id", ownerId)
      .eq("draft_key", draftKey)
      .eq("state", "draft");
    if (error) throw error;
  },

  clearLocal(ownerId: string, draftKey: string) {
    localStorage.removeItem(localKey(ownerId, draftKey));
  },
};

export function formatSaveStatus(
  state: PublicationSaveState,
  savedAt: Date | null,
) {
  if (state === "loading") return "Carregando rascunho...";
  if (state === "saving") return "Salvando...";
  if (state === "offline") return "Salvo neste dispositivo";
  if (state === "error") return "Não foi possível salvar";
  if (!savedAt) return "Rascunho pronto";
  return "Salvo agora";
}

export function isPersistedPublicationDraft(
  record: PublicationDraftRecord | null | undefined,
) {
  return Boolean(record?.id && !record.id.startsWith("local:"));
}
