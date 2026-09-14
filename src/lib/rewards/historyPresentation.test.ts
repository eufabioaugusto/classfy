import { describe, expect, it } from "vitest";
import {
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
});
