import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import "./classy-avatar.css";

export type ClassyAvatarState = "idle" | "attentive" | "thinking" | "happy" | "speaking";
interface Props {
  state?: ClassyAvatarState;
  className?: string;
}

/** Cabeça 3D compartilhada; apenas olhos e boca mudam, sem trocar imagens. */
export function ClassyAvatar({ state = "idle", className }: Props) {
  const avatar = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const element = avatar.current;
    if (!element) return;
    const pointer = window.matchMedia("(pointer: fine)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let active = false;
    const reset = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      element.style.setProperty("--classy-look-x", "0px");
      element.style.setProperty("--classy-look-y", "0px");
    };
    const followPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || document.hidden) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const bounds = element.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = event.clientY - (bounds.top + bounds.height / 2);
        const proximity = Math.max(0, 1 - Math.hypot(dx, dy) / 220);
        element.style.setProperty("--classy-look-x", `${(Math.max(-1, Math.min(1, dx / 45)) * 1.6 * proximity).toFixed(2)}px`);
        element.style.setProperty("--classy-look-y", `${(Math.max(-1, Math.min(1, dy / 45)) * proximity).toFixed(2)}px`);
      });
    };
    const sync = () => {
      const enabled = pointer.matches && !motion.matches;
      if (enabled && !active) {
        window.addEventListener("pointermove", followPointer, { passive: true });
        active = true;
      } else if (!enabled && active) {
        window.removeEventListener("pointermove", followPointer);
        active = false;
      }
      if (!enabled) reset();
    };
    sync();
    pointer.addEventListener("change", sync);
    motion.addEventListener("change", sync);
    window.addEventListener("blur", reset);
    document.addEventListener("pointerleave", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      reset();
      window.removeEventListener("pointermove", followPointer);
      pointer.removeEventListener("change", sync);
      motion.removeEventListener("change", sync);
      window.removeEventListener("blur", reset);
      document.removeEventListener("pointerleave", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, []);

  const curious = state === "thinking";
  const happy = state === "happy";
  return (
    <svg ref={avatar} viewBox="0 0 64 64" aria-hidden="true" focusable="false"
      className={cn("classy-avatar", className)} data-state={state}>
      <image href="/classy/classy-head-v1.webp" width="64" height="64" />
      <g className="classy-avatar-gaze">
        <g transform="rotate(-9 44 37)">
          <g className="classy-avatar-eyes">
            {happy ? <g fill="none" stroke="#191417" strokeWidth="1.6" strokeLinecap="round">
              <path d="M39.8 37.1q1.5-2.6 3.1 0M45 37.1q1.5-2.6 3.1 0" />
            </g> : <g fill="#191417">
              <rect x="40" y={curious ? 35.4 : 33.3} width="2.55" height={curious ? 4.5 : 7.1} rx="1.27" />
              <rect x="45.3" y={curious ? 32.5 : 33.3} width="2.55" height="7.1" rx="1.27" />
              <path d="M40.6 34.8v2.5M45.9 34.8v2.5" stroke="white" strokeOpacity=".13" strokeWidth=".45" strokeLinecap="round" />
            </g>}
          </g>
        </g>
      </g>
      {curious ? <path d="M29.5 48.5q1.3-1.5 3.2-.9" fill="none" stroke="#191417" strokeWidth="1.4" strokeLinecap="round" /> : state === "speaking" ? <g className="classy-avatar-speaking-mouth">
        <ellipse cx="30.5" cy="47" rx="4.5" ry="3.7" fill="#191417" />
        <ellipse cx="30.5" cy="48.8" rx="2.2" ry="1" fill="#F24B62" />
      </g> : <path className="classy-avatar-smile" d="M23.5 43C24.2 42.7 24.8 43.1 26.2 44.1C29.6 46.5 32.2 47.3 38.4 45.4C38.9 45.2 39 45.5 38.6 45.8C35.7 48.5 31.3 51 27.3 50.9C23.6 50.8 22.2 49.2 21.8 47C21.4 45 22.1 43.4 23.2 43Z" fill="#191417" />}
    </svg>
  );
}
