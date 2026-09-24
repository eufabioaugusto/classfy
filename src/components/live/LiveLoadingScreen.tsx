import { Radio } from "lucide-react";
import "@/styles/live-loading.css";

type Props = {
  title: string;
  description: string;
  dark?: boolean;
};

export function LiveLoadingScreen({ title, description, dark = false }: Props) {
  return <main className="cf-v2 live-opening" data-theme={dark ? "dark" : undefined} role="status" aria-live="polite">
    <div className="live-opening__content">
      <div className="live-opening__mark" aria-hidden="true">
        <span className="live-opening__corner live-opening__corner--tl" />
        <span className="live-opening__corner live-opening__corner--tr" />
        <span className="live-opening__corner live-opening__corner--bl" />
        <span className="live-opening__corner live-opening__corner--br" />
        <span className="live-opening__signal"><Radio /></span>
      </div>
      <span className="live-opening__eyebrow"><span className="live-opening__dot" /> CLASSFY LIVE</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  </main>;
}
