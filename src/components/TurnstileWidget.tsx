import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    _onTurnstileLoad?: () => void;
  }
}

interface TurnstileWidgetProps {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onUnavailable?: () => void;
  resetKey?: number;
}

export default function TurnstileWidget({ siteKey, onVerify, onExpire, onUnavailable, resetKey }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const onUnavailableRef = useRef(onUnavailable);

  useEffect(() => { onVerifyRef.current = onVerify; }, [onVerify]);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);
  useEffect(() => { onUnavailableRef.current = onUnavailable; }, [onUnavailable]);

  useEffect(() => {
    let didRender = false;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;

    const render = () => {
      if (!containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          didRender = true;
          onVerifyRef.current(token);
        },
        "expired-callback": () => {
          onExpireRef.current?.();
        },
        "error-callback": () => {
          onUnavailableRef.current?.();
        },
        "unsupported-callback": () => {
          onUnavailableRef.current?.();
        },
        theme: "auto",
        size: "normal",
      });
      didRender = true;
    };

    loadTimer = setTimeout(() => {
      if (!didRender && !window.turnstile) {
        onUnavailableRef.current?.();
      }
    }, 6000);

    if (window.turnstile) {
      render();
    } else if (!document.querySelector("script[data-cf-turnstile]")) {
      window._onTurnstileLoad = render;
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=_onTurnstileLoad&render=explicit";
      script.dataset.cfTurnstile = "true";
      script.async = true;
      script.onerror = () => {
        onUnavailableRef.current?.();
      };
      document.head.appendChild(script);
    } else {
      const prev = window._onTurnstileLoad;
      window._onTurnstileLoad = () => {
        prev?.();
        render();
      };
    }

    return () => {
      if (loadTimer) clearTimeout(loadTimer);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, resetKey]);

  return <div ref={containerRef} className="flex justify-center" />;
}
