import { describe, expect, it } from "vitest";
import {
  beginBackgroundUpload,
  getBackgroundUploadsSnapshot,
  updateBackgroundUpload,
  updateBackgroundUploadByMediaAsset,
} from "@/lib/studio/backgroundUploads";

describe("envios em segundo plano", () => {
  it("registra o rascunho antes de iniciar a transferência", () => {
    const id = beginBackgroundUpload({
      draftId: "draft-preparing",
      title: "aula.mp4",
    });

    expect(
      getBackgroundUploadsSnapshot().find((task) => task.id === id),
    ).toMatchObject({
      draftId: "draft-preparing",
      title: "aula.mp4",
      state: "preparing",
      progress: 0,
    });
  });

  it("mantém somente o envio mais recente do mesmo rascunho", () => {
    const firstId = beginBackgroundUpload({
      draftId: "draft-retry",
      title: "primeiro.mp4",
    });
    const latestId = beginBackgroundUpload({
      draftId: "draft-retry",
      title: "segundo.mp4",
    });
    const snapshot = getBackgroundUploadsSnapshot();

    expect(snapshot.some((task) => task.id === firstId)).toBe(false);
    expect(snapshot.find((task) => task.id === latestId)?.title).toBe(
      "segundo.mp4",
    );
  });

  it("propaga percentual e conclusão pelo identificador da mídia", () => {
    const id = beginBackgroundUpload({
      draftId: "draft-progress",
      title: "conteudo.mov",
    });
    updateBackgroundUpload(id, {
      mediaAssetId: "asset-progress",
      state: "uploading",
      progress: 47,
    });

    expect(
      getBackgroundUploadsSnapshot().find((task) => task.id === id),
    ).toMatchObject({ state: "uploading", progress: 47 });

    updateBackgroundUploadByMediaAsset("asset-progress", {
      state: "ready",
      progress: 100,
    });

    expect(
      getBackgroundUploadsSnapshot().find((task) => task.id === id),
    ).toMatchObject({ state: "ready", progress: 100 });
  });
});
