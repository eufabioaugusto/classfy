import "@/styles/page-loading.css";

type Props = {
  label?: string;
  live?: boolean;
};

/** One visual language for route chunks and full-page data waits. */
export function PageLoadingScreen({ label = "Carregando", live = false }: Props) {
  return <main className="classfy-page-loading" data-live={live} role="status" aria-label={label}>
    <span className="classfy-page-loading__progress" aria-hidden="true" />
    <div className="classfy-page-loading__center">
      <span className="classfy-wordmark classfy-page-loading__brand">Classfy</span>
      {live && <span className="classfy-page-loading__context">Live</span>}
      <p>{label}</p>
    </div>
  </main>;
}
