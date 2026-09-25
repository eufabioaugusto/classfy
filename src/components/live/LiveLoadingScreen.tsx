import { PageLoadingScreen } from "@/components/PageLoadingScreen";

type Props = {
  title: string;
  dark?: boolean;
};

export function LiveLoadingScreen({ title, dark = false }: Props) {
  return <PageLoadingScreen label={title} live={dark} />;
}
