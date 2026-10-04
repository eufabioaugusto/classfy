import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeaturedCreatorTrailerPlayer } from "./FeaturedCreatorTrailerPlayer";

describe("FeaturedCreatorTrailerPlayer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("oferece cadastro ao visitante somente depois de iniciar e pausar", async () => {
    const onRegister = vi.fn();
    await act(async () => root.render(createElement(FeaturedCreatorTrailerPlayer, {
      src: "/trailer.mp4", poster: "/poster.jpg", creatorName: "Creator", signedIn: false, onRegister, onExplore: vi.fn(),
    })));
    expect(container.textContent).not.toContain("Cadastrar grátis");

    const video = container.querySelector("video")!;
    await act(async () => video.dispatchEvent(new Event("play")));
    expect(container.textContent).not.toContain("Cadastrar grátis");
    await act(async () => video.dispatchEvent(new Event("pause")));
    const registerButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Cadastrar grátis");
    expect(registerButton).toBeTruthy();
    await act(async () => registerButton!.click());
    expect(onRegister).toHaveBeenCalledOnce();
  });

  it("oferece os conteúdos do creator a quem já entrou somente na pausa", async () => {
    const onExplore = vi.fn();
    await act(async () => root.render(createElement(FeaturedCreatorTrailerPlayer, {
      src: "/trailer.mp4", poster: "/poster.jpg", creatorName: "Creator", signedIn: true, onRegister: vi.fn(), onExplore,
    })));
    const video = container.querySelector("video")!;
    await act(async () => video.dispatchEvent(new Event("play")));
    expect(container.textContent).not.toContain("Ver conteúdos");
    await act(async () => video.dispatchEvent(new Event("pause")));
    expect(container.textContent).not.toContain("Cadastrar grátis");
    const exploreButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Ver conteúdos");
    expect(exploreButton).toBeTruthy();
    await act(async () => exploreButton!.click());
    expect(onExplore).toHaveBeenCalledOnce();
  });

  it("mostra a capa sem simular vídeo ou duração quando não há arquivo", async () => {
    await act(async () => root.render(createElement(FeaturedCreatorTrailerPlayer, {
      src: null, poster: "/poster.jpg", creatorName: "Creator", signedIn: false, onRegister: vi.fn(), onExplore: vi.fn(),
    })));
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector('img[src="/poster.jpg"]')).toBeTruthy();
    expect(container.textContent).toContain("0:00 / --:--");
    expect(container.textContent).not.toMatch(/demonstração|indisponível|exemplo/i);
    expect(container.querySelector('button[aria-label="Reproduzir trailer"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("pausa ao clicar no vídeo e retoma ao clicar fora dos botões do CTA", async () => {
    const onExplore = vi.fn();
    await act(async () => root.render(createElement(FeaturedCreatorTrailerPlayer, {
      src: "/trailer.mp4", poster: "/poster.jpg", creatorName: "Creator", signedIn: true, onRegister: vi.fn(), onExplore,
    })));
    const video = container.querySelector("video")!;
    let paused = false;
    Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {
      paused = true;
      video.dispatchEvent(new Event("pause"));
    });
    const play = vi.spyOn(video, "play").mockImplementation(async () => {
      paused = false;
      video.dispatchEvent(new Event("play"));
    });
    await act(async () => video.dispatchEvent(new Event("play")));
    await act(async () => video.click());
    expect(pause).toHaveBeenCalledOnce();
    const overlay = container.querySelector(".featured-trailer__message--paused")! as HTMLDivElement;
    await act(async () => overlay.querySelector("h3")!.click());
    expect(play).toHaveBeenCalledOnce();
    expect(onExplore).not.toHaveBeenCalled();
  });
});
