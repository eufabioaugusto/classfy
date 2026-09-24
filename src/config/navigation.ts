import {
  BarChart,
  Bookmark,
  BookOpen,
  CheckSquare,
  Clock,
  Crown,
  DollarSign,
  FileText,
  GraduationCap,
  Home,
  Layers,
  Megaphone,
  Podcast,
  Radio,
  Settings,
  Star,
  TrendingUp,
  Trophy,
  Users,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  highlight?: boolean;
};

export type AdminNavigationItem = NavigationItem & {
  countKey: "creators" | "contents" | "withdrawals" | null;
};

export const mainNavigation: NavigationItem[] = [
  { title: "Início", url: "/", icon: Home },
  { title: "Shorts", url: "/shorts", icon: Zap },
  { title: "Histórico", url: "/historico", icon: Clock },
  { title: "Favoritos", url: "/favoritos", icon: Star },
  { title: "Salvos", url: "/salvos", icon: Bookmark },
  { title: "Recompensas", url: "/recompensas", icon: Trophy },
  { title: "Carteira", url: "/carteira", icon: DollarSign },
  { title: "Classfy Premium", url: "/planos", icon: Crown, highlight: true },
];

export const studioNavigation: NavigationItem[] = [
  { title: "Dashboard", url: "/studio", icon: BarChart },
  { title: "Analytics", url: "/studio/analytics", icon: TrendingUp },
  { title: "Meus Conteúdos", url: "/studio/contents", icon: Video },
  { title: "Meus Boosts", url: "/studio/boosts", icon: Megaphone },
  { title: "Lives", url: "/studio/live", icon: Radio },
];

export const adminNavigation: AdminNavigationItem[] = [
  { title: "Dashboard", url: "/admin", icon: BarChart, countKey: null },
  { title: "Aprovar Creators", url: "/admin/creators", icon: CheckSquare, countKey: "creators" },
  { title: "Aprovar Conteúdos", url: "/admin/contents", icon: Video, countKey: "contents" },
  { title: "Transcrições", url: "/admin/transcriptions", icon: FileText, countKey: null },
  { title: "Creators em Destaque", url: "/admin/featured-creators", icon: Users, countKey: null },
  { title: "Recompensas", url: "/admin/rewards", icon: Trophy, countKey: null },
  { title: "Saques", url: "/admin/withdrawals", icon: DollarSign, countKey: "withdrawals" },
  { title: "Gerenciar Usuários", url: "/admin/users", icon: Users, countKey: null },
  { title: "Prospecção", url: "/admin/prospects", icon: TrendingUp, countKey: null },
  { title: "Curadoria", url: "/admin/curadoria", icon: Layers, countKey: null },
  { title: "Materiais Afiliados", url: "/admin/marketing", icon: Megaphone, countKey: null },
  { title: "Configurações", url: "/admin/settings", icon: Settings, countKey: null },
];

export const creatorActions = [
  { title: "Curso", description: "Série de aulas", url: "/studio/upload/curso", icon: GraduationCap },
  { title: "Aula", description: "Vídeo educacional", url: "/studio/upload?type=aula", icon: BookOpen },
  { title: "Podcast", description: "Áudio longo", url: "/studio/upload?type=podcast", icon: Podcast },
  { title: "Short", description: "Vídeo curto", url: "/studio/upload?type=short", icon: Zap },
  { title: "Live", description: "Transmissão ao vivo", url: "/studio/upload?type=live", icon: Radio },
] satisfies Array<NavigationItem & { description: string }>;
