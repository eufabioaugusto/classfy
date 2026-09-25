import { PageLoadingScreen } from "@/components/PageLoadingScreen";

export function GlobalLoader({ label }: { label?: string }) {
  return <PageLoadingScreen label={label} />;
}
