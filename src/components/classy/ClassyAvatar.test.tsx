import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassyAvatar } from "./ClassyAvatar";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(state: "idle" | "thinking" | "happy" | "speaking" = "idle", reduced = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mediaListeners = new Map<string, () => void>();
  const media = { matches: reduced };
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return query.includes("pointer") ? true : media.matches; },
    addEventListener: (_: string, fn: () => void) => mediaListeners.set(query, fn),
    removeEventListener: vi.fn(),
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<ClassyAvatar state={state}/>));
  const svg = container.querySelector("svg")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({left:0,top:0,width:32,height:32} as DOMRect);
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  return { svg, media, mediaListeners };
}
describe("Classy compartilhada", () => {
  it("usa uma única base para os estados, sem olhos deformados ou avatar focável", () => {
    const {svg} = mount("thinking");
    expect(svg.getAttribute("data-state")).toBe("thinking");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector("image")?.getAttribute("href")).toBe("/classy/classy-head-v1.webp");
    expect(svg.querySelectorAll(".classy-avatar-eyes rect")).toHaveLength(2);
  });
  it("acompanha o ponteiro e volta ao centro quando a janela perde foco", () => {
    const request = vi.spyOn(window,"requestAnimationFrame").mockImplementation(fn => { fn(0); return 1; });
    vi.spyOn(window,"cancelAnimationFrame").mockImplementation(() => {});
    const {svg} = mount();
    const event = new MouseEvent("pointermove",{clientX:55,clientY:30});
    window.dispatchEvent(event);
    expect(request).toHaveBeenCalled();
    expect(parseFloat(svg.style.getPropertyValue("--classy-look-x"))).toBeGreaterThan(0);
    window.dispatchEvent(new Event("blur"));
    expect(svg.style.getPropertyValue("--classy-look-x")).toBe("0px");
  });
  it("respeita movimento reduzido e remove o acompanhamento ao mudar a preferência", () => {
    const request = vi.spyOn(window,"requestAnimationFrame").mockImplementation(fn => { fn(0); return 1; });
    vi.spyOn(window,"cancelAnimationFrame").mockImplementation(() => {});
    const {svg,media,mediaListeners} = mount("idle",true);
    window.dispatchEvent(new MouseEvent("pointermove",{clientX:50,clientY:25}));
    expect(request).not.toHaveBeenCalled();
    media.matches = false;
    mediaListeners.get("(prefers-reduced-motion: reduce)")!();
    window.dispatchEvent(new MouseEvent("pointermove",{clientX:50,clientY:25}));
    expect(request).toHaveBeenCalledOnce();
    media.matches = true;
    mediaListeners.get("(prefers-reduced-motion: reduce)")!();
    expect(svg.style.getPropertyValue("--classy-look-x")).toBe("0px");
  });
  it("remove o listener do ponteiro quando desmonta", () => {
    const remove = vi.spyOn(window,"removeEventListener");
    mount();
    cleanups.splice(0).forEach(cleanup=>cleanup());
    expect(remove).toHaveBeenCalledWith("pointermove",expect.any(Function));
  });
});
