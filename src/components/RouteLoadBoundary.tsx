import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

const RELOAD_KEY = "classfy:failed-route-chunk";

/** Recover tabs whose route bundle was removed by a newer deployment. */
export class RouteLoadBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    const message = String(error?.message ?? error);
    const isMissingChunk = /Failed to fetch dynamically imported module|Loading chunk [\w-]+ failed|Importing a module script failed/i.test(message);
    if (!isMissingChunk) {
      console.error("Falha ao abrir a página:", error);
      return;
    }

    // A failed asset URL identifies the deployment. Reload only once for it.
    try {
      if (sessionStorage.getItem(RELOAD_KEY) === message) return;
      sessionStorage.setItem(RELOAD_KEY, message);
    } catch {
      // Private browsing can disable storage; the manual retry remains available.
      return;
    }
    window.location.reload();
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="classfy-wordmark text-3xl">Classfy</span>
      <h1 className="text-xl font-semibold">Não conseguimos abrir esta página.</h1>
      <p className="max-w-md text-sm text-muted-foreground">Atualize para continuar de onde parou.</p>
      <button
        type="button"
        className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
        onClick={() => { sessionStorage.removeItem(RELOAD_KEY); window.location.reload(); }}
      >
        Atualizar página
      </button>
    </main>;
  }
}
