import { describe, expect, it } from "vitest";
import {
  buildUserRewardActionSummary,
  getRewardActionFilterLabel,
  getRewardActionLabel,
  getRewardPointTypeLabel,
  getRewardPointUnit,
  isCreatorEngagementEvent,
} from "./historyPresentation";

describe("apresentação do histórico de recompensas", () => {
  it("descreve a ação de consumo pela perspectiva do aluno", () => {
    const event = { action_key: "LIKE", point_type: "user" };

    expect(getRewardActionLabel(event)).toBe("Curtiu um conteúdo");
    expect(getRewardPointTypeLabel(event)).toBe("Estudo e participação");
    expect(getRewardPointUnit(event)).toBe("Points");
    expect(getRewardActionFilterLabel("LIKE")).toBe("Curtida");
  });

  it("descreve o evento espelhado pela perspectiva do creator", () => {
    const event = {
      action_key: "LIKE",
      point_type: "creator",
      metadata: { as_creator: true },
    };

    expect(isCreatorEngagementEvent(event)).toBe(true);
    expect(getRewardActionLabel(event)).toBe(
      "Seu conteúdo recebeu uma curtida",
    );
    expect(getRewardPointTypeLabel(event)).toBe(
      "Creator · engajamento recebido",
    );
    expect(getRewardPointUnit(event)).toBe("Creator Points");
  });

  it("mantém conquistas de creator separadas de engajamento recebido", () => {
    const event = { action_key: "CONTENT_APPROVED", point_type: "creator" };

    expect(isCreatorEngagementEvent(event)).toBe(false);
    expect(getRewardActionLabel(event)).toBe("Teve um conteúdo aprovado");
    expect(getRewardPointTypeLabel(event)).toBe("Creator · conquista");
  });

  it("reconhece registros antigos de engajamento mesmo sem metadado", () => {
    const event = { action_key: "WATCH_100", point_type: "creator" };

    expect(isCreatorEngagementEvent(event)).toBe(true);
    expect(getRewardActionLabel(event)).toBe("Seu conteúdo foi concluído");
  });

  it("descreve o bônus semanal como consumo, não como publicação", () => {
    const event = { action_key: "FIRST_CONTENT_WEEK", point_type: "user" };

    expect(getRewardActionLabel(event)).toBe(
      "Assistiu ao primeiro conteúdo da semana",
    );
    expect(getRewardActionFilterLabel("FIRST_CONTENT_WEEK")).toBe(
      "Primeiro conteúdo assistido na semana",
    );
  });

  it("reconcilia todas as origens dos Points e preserva ações ainda zeradas", () => {
    const summary = buildUserRewardActionSummary(
      [
        { action_key: "DAILY_LOGIN", points: 2 },
        { action_key: "DAILY_LOGIN", points: 2 },
        { action_key: "DAILY_LOGIN", points: 2 },
        { action_key: "FIRST_CONTENT_WEEK", points: 4 },
      ],
      [
        { action_key: "DAILY_LOGIN", points_user: 2, active: true },
        { action_key: "FIRST_CONTENT_WEEK", points_user: 4, active: true },
        { action_key: "LIKE", points_user: 2, active: true },
        { action_key: "CONTENT_APPROVED", points_user: 0, active: true },
      ],
    );

    expect(summary).toEqual([
      {
        actionKey: "DAILY_LOGIN",
        label: "Acesso diário",
        count: 3,
        points: 6,
      },
      {
        actionKey: "FIRST_CONTENT_WEEK",
        label: "Primeiro conteúdo assistido na semana",
        count: 1,
        points: 4,
      },
      { actionKey: "LIKE", label: "Curtida", count: 0, points: 0 },
    ]);
  });
});
