export interface RewardEventPresentationInput {
  action_key: string;
  point_type: string;
  metadata?: unknown;
}

const actionLabels: Record<string, string> = {
  LIKE: "Curtiu um conteúdo",
  SAVE: "Salvou um conteúdo",
  FAVORITE: "Favoritou um conteúdo",
  COMMENT: "Comentou em um conteúdo",
  WATCH_50: "Assistiu à metade",
  WATCH_100: "Concluiu o conteúdo",
  VIEW_15S: "Assistiu aos primeiros 15 segundos",
  SHARE: "Compartilhou um conteúdo",
  COMPLETE_COURSE: "Concluiu um curso",
  DAILY_LOGIN: "Acessou a Classfy no dia",
  WEEKLY_STREAK: "Completou 7 dias seguidos",
  FIRST_CONTENT_WEEK: "Assistiu ao primeiro conteúdo da semana",
  BINGE_WATCH: "Completou uma maratona",
  PROFILE_COMPLETE: "Completou o perfil",
  SUBSCRIBE_CREATOR: "Começou a seguir um creator",
  FOLLOW_CREATOR: "Começou a seguir um creator",
  CREATOR_APPROVED: "Teve o perfil de creator aprovado",
  FIRST_UPLOAD: "Enviou o primeiro conteúdo",
  CONTENT_APPROVED: "Teve um conteúdo aprovado",
  CREATOR_MILESTONE: "Alcançou uma meta de creator",
  LIKE_CONTENT: "Curtiu um conteúdo (registro antigo)",
  SAVE_CONTENT: "Salvou um conteúdo (registro antigo)",
  FAVORITE_CONTENT: "Favoritou um conteúdo (registro antigo)",
  COMMENT_CONTENT: "Comentou em um conteúdo (registro antigo)",
  SHARE_CONTENT: "Compartilhou um conteúdo (registro antigo)",
  MILESTONE_100_VIEWS: "Alcançou 100 visualizações",
  MILESTONE_500_VIEWS: "Alcançou 500 visualizações",
  MILESTONE_1000_VIEWS: "Alcançou 1.000 visualizações",
  MILESTONE_5000_VIEWS: "Alcançou 5.000 visualizações",
  MILESTONE_10000_VIEWS: "Alcançou 10.000 visualizações",
};

const creatorEngagementLabels: Record<string, string> = {
  LIKE: "Seu conteúdo recebeu uma curtida",
  SAVE: "Seu conteúdo foi salvo",
  FAVORITE: "Seu conteúdo foi favoritado",
  COMMENT: "Seu conteúdo recebeu um comentário",
  WATCH_50: "Seu conteúdo foi assistido até a metade",
  WATCH_100: "Seu conteúdo foi concluído",
  VIEW_15S: "Seu conteúdo reteve a atenção por 15 segundos",
  SHARE: "Seu conteúdo foi compartilhado",
  COMPLETE_COURSE: "Seu curso foi concluído",
  SUBSCRIBE_CREATOR: "Você ganhou um novo assinante",
  FOLLOW_CREATOR: "Você ganhou um novo seguidor",
};

const actionFilterLabels: Record<string, string> = {
  LIKE: "Curtida",
  SAVE: "Conteúdo salvo",
  FAVORITE: "Conteúdo favoritado",
  COMMENT: "Comentário",
  WATCH_50: "50% assistido",
  WATCH_100: "Conteúdo concluído",
  VIEW_15S: "Primeiros 15 segundos",
  SHARE: "Compartilhamento",
  COMPLETE_COURSE: "Curso concluído",
  DAILY_LOGIN: "Acesso diário",
  WEEKLY_STREAK: "Sequência semanal",
  FIRST_CONTENT_WEEK: "Primeiro conteúdo assistido na semana",
  BINGE_WATCH: "Maratona",
  PROFILE_COMPLETE: "Perfil completo",
  SUBSCRIBE_CREATOR: "Nova assinatura",
  FOLLOW_CREATOR: "Novo seguidor",
  CREATOR_APPROVED: "Creator aprovado",
  FIRST_UPLOAD: "Primeiro envio",
  CONTENT_APPROVED: "Conteúdo aprovado",
  CREATOR_MILESTONE: "Meta de creator",
};

const hasCreatorPerspectiveMetadata = (metadata: unknown) =>
  Boolean(
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    "as_creator" in metadata &&
    metadata.as_creator === true,
  );

export const isCreatorEngagementEvent = (event: RewardEventPresentationInput) =>
  event.point_type === "creator" &&
  (hasCreatorPerspectiveMetadata(event.metadata) ||
    event.action_key in creatorEngagementLabels);

export const getRewardActionLabel = (event: RewardEventPresentationInput) => {
  if (isCreatorEngagementEvent(event)) {
    return (
      creatorEngagementLabels[event.action_key] ||
      "Seu conteúdo gerou engajamento"
    );
  }

  return (
    actionLabels[event.action_key] || event.action_key.replaceAll("_", " ")
  );
};

export const getRewardActionFilterLabel = (actionKey: string) =>
  actionFilterLabels[actionKey] ||
  actionLabels[actionKey] ||
  actionKey.replaceAll("_", " ");

export const getRewardPointTypeLabel = (
  event: RewardEventPresentationInput,
) => {
  if (event.point_type !== "creator") return "Estudo e participação";
  return isCreatorEngagementEvent(event)
    ? "Creator · engajamento recebido"
    : "Creator · conquista";
};

export const getRewardPointUnit = (event: RewardEventPresentationInput) =>
  event.point_type === "creator" ? "Creator Points" : "Points";

export interface UserRewardSummaryEvent {
  action_key: string;
  points: number;
}

export interface UserRewardSummaryConfig {
  action_key: string;
  points_user: number;
  active?: boolean;
}

export interface UserRewardActionSummary {
  actionKey: string;
  label: string;
  count: number;
  points: number;
}

export const buildUserRewardActionSummary = (
  events: UserRewardSummaryEvent[],
  configs: UserRewardSummaryConfig[],
): UserRewardActionSummary[] => {
  const totals = new Map<string, { count: number; points: number }>();

  events.forEach((event) => {
    const current = totals.get(event.action_key) || { count: 0, points: 0 };
    totals.set(event.action_key, {
      count: current.count + 1,
      points: current.points + Number(event.points || 0),
    });
  });

  const actionKeys = new Set([
    ...configs
      .filter((config) => config.active !== false && config.points_user > 0)
      .map((config) => config.action_key),
    ...events.map((event) => event.action_key),
  ]);

  return [...actionKeys]
    .map((actionKey) => ({
      actionKey,
      label: getRewardActionFilterLabel(actionKey),
      count: totals.get(actionKey)?.count || 0,
      points: totals.get(actionKey)?.points || 0,
    }))
    .sort(
      (a, b) =>
        Number(b.points > 0) - Number(a.points > 0) ||
        b.points - a.points ||
        a.label.localeCompare(b.label, "pt-BR"),
    );
};
