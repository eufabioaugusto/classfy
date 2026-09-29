import { useEffect, useState } from "react";
import type { ClassyReference } from "./classyPageContext";
export type ClassyTarget = { label: string; text: string };
export function useClassyTarget(onPick: (target: ClassyTarget, ref?: ClassyReference) => void, path: string) {
  const [selecting, setSelecting] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => { setSelecting(false); setRect(null); }, [path]);
  useEffect(() => {
    if (!selecting) return;
    let candidate: HTMLElement | null = null;
    const find = (event: Event) => {
      const el = event.target instanceof Element ? event.target : null;
      if (!el || el.closest('.classy-global,input,textarea,[contenteditable="true"],[data-classy-private],form')) return null;
      return el.closest<HTMLElement>('[data-classy-ref-id],article,[role="button"],a,button,p,li,h1,h2,h3');
    };
    const hover = (event: Event) => {
      candidate = find(event);
      if (!candidate) { setRect(null); return; }
      const bounds = candidate.getBoundingClientRect();
      setRect({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height });
    };
    const pick = (event: MouseEvent) => {
      const selected = find(event);
      if (!selected) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      const text = (selected.getAttribute("data-classy-title") || selected.innerText || selected.getAttribute("aria-label") || "Elemento da página").replace(/\s+/g, " ").trim().slice(0, 800);
      const id = selected.getAttribute("data-classy-ref-id");
      const type = selected.getAttribute("data-classy-ref-type");
      const ref = id && ["content", "lesson", "creator", "study"].includes(type || "") ? { id, type: type as ClassyReference["type"], title: text.slice(0, 160) } : undefined;
      onPick({ label: text.slice(0, 100), text }, ref);
      setSelecting(false); setRect(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelecting(false); setRect(null); } };
    document.addEventListener("pointermove", hover, true); document.addEventListener("click", pick, true); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointermove", hover, true); document.removeEventListener("click", pick, true); document.removeEventListener("keydown", escape); };
  }, [selecting, onPick]);
  return { selecting, setSelecting, rect };
}
