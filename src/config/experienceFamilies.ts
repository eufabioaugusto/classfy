import type { ExperienceFamily } from "@/components/templates";

type ExperienceDefinition = {
  label: string;
  objective: string;
  template: ExperienceTemplateName;
  density: string;
  navigation: string;
  predominantComponents: readonly string[];
};

export type ExperienceTemplateName =
  | "ExplorationTemplate"
  | "ConsumptionTemplate"
  | "LibraryTemplate"
  | "EconomyTemplate"
  | "CreatorTemplate"
  | "AdminTemplate";

export const experienceFamilies: Record<ExperienceFamily, ExperienceDefinition> = {
  exploration: {
    label: "Exploração",
    objective: "Descobrir rapidamente pessoas, conteúdos e próximos caminhos.",
    template: "ExplorationTemplate",
    density: "Editorial e respirada, com alta presença de imagem.",
    navigation: "AppShell persistente, busca e navegação contextual por seções.",
    predominantComponents: ["hero", "creator carousel", "content rail", "media card", "section header"],
  },
  consumption: {
    label: "Consumo",
    objective: "Manter foco no conteúdo e reduzir qualquer distração operacional.",
    template: "ConsumptionTemplate",
    density: "Imersiva no conteúdo; compacta nos controles.",
    navigation: "Shell especial ou reduzido, com saída e contexto sempre previsíveis.",
    predominantComponents: ["player", "controls", "metadata", "progress", "recommendation rail"],
  },
  library: {
    label: "Biblioteca",
    objective: "Encontrar, retomar e organizar itens pessoais com velocidade.",
    template: "LibraryTemplate",
    density: "Confortável a compacta, orientada à escaneabilidade.",
    navigation: "AppShell, filtros locais, busca e alternância de visualização.",
    predominantComponents: ["page header", "filters", "search", "content rows", "empty state"],
  },
  economy: {
    label: "Economia",
    objective: "Explicar valor, saldo, status e ações financeiras sem ambiguidade.",
    template: "EconomyTemplate",
    density: "Confortável, com números e estados em primeiro plano.",
    navigation: "AppShell, resumo persistente e ações financeiras explícitas.",
    predominantComponents: ["metric card", "ledger table", "status badge", "plan card", "dialog"],
  },
  creator: {
    label: "Creator / Studio",
    objective: "Criar, publicar e gerir conteúdo com eficiência operacional.",
    template: "CreatorTemplate",
    density: "Compacta, sem perder hierarquia nas ações principais.",
    navigation: "AppShell no Studio e shells focados em criação ou transmissão.",
    predominantComponents: ["toolbar", "workflow card", "data table", "metric card", "sheet"],
  },
  admin: {
    label: "Administração",
    objective: "Operar, revisar e decidir com alta densidade e baixo risco de erro.",
    template: "AdminTemplate",
    density: "Compacta e informacional.",
    navigation: "AppShell administrativo, filtros, tabelas e ações contextualizadas.",
    predominantComponents: ["table", "filters", "status badge", "bulk actions", "confirm dialog"],
  },
};

export type RouteExperience = {
  pages: readonly string[];
  routes: readonly string[];
  family: ExperienceFamily;
  template: ExperienceTemplateName;
  sharedComponents: readonly string[];
  variant?: string;
};

export const routeExperienceMap: readonly RouteExperience[] = [
  {
    pages: ["Home", "CreatorProfile", "FeaturedCreatorPage"],
    routes: ["/", "/:username", "/creators/destaque/:slug"],
    family: "exploration",
    template: "ExplorationTemplate",
    sharedComponents: ["AppShell", "MediaFrame", "CreatorIdentity", "SectionHeader", "Badge"],
  },
  {
    pages: ["Watch", "Listen", "Shorts", "LiveWatch", "Study"],
    routes: ["/watch/:id", "/listen/:id", "/shorts/:id?", "/live/:id", "/study", "/c/:id"],
    family: "consumption",
    template: "ConsumptionTemplate",
    sharedComponents: ["Media Layer", "controls", "progress", "feedback states"],
    variant: "Cada formato mantém seu shell imersivo próprio.",
  },
  {
    pages: ["Historico", "Favoritos", "Salvos", "Conta", "Messages"],
    routes: ["/historico", "/favoritos", "/salvos", "/conta", "/messages"],
    family: "library",
    template: "LibraryTemplate",
    sharedComponents: ["AppShell", "PageHeader", "filters", "content rows", "EmptyState"],
    variant: "Conta usa composição de preferências; Messages usa composição de conversa.",
  },
  {
    pages: ["Recompensas", "RewardsHistory", "Carteira", "Planos", "BoostSuccess"],
    routes: ["/recompensas", "/rewards-history", "/carteira", "/planos", "/boost-success"],
    family: "economy",
    template: "EconomyTemplate",
    sharedComponents: ["AppShell", "MetricCard", "Table", "Badge", "Dialog", "feedback states"],
  },
  {
    pages: [
      "Studio",
      "StudioUpload",
      "StudioUploadCurso",
      "StudioContents",
      "StudioBoosts",
      "StudioAnalytics",
      "StudioGoals",
      "StudioLive",
      "LiveBroadcast",
    ],
    routes: ["/studio", "/studio/*", "/live/:id/broadcast"],
    family: "creator",
    template: "CreatorTemplate",
    sharedComponents: ["AppShell", "PageHeader", "MetricCard", "Table", "Sheet", "feedback states"],
    variant: "Upload e broadcast podem reduzir ou remover a navegação para preservar foco.",
  },
  {
    pages: ["Admin*"],
    routes: ["/admin", "/admin/*"],
    family: "admin",
    template: "AdminTemplate",
    sharedComponents: ["AppShell", "PageHeader", "Table", "Badge", "Dialog", "Sheet"],
  },
];

export const standaloneExperiences = [
  { pages: ["Auth", "ResetPassword"], routes: ["/auth", "/reset-password"], shell: "Auth shell" },
  { pages: ["NotFound"], routes: ["*"], shell: "System state" },
  { pages: ["FrontV2Lab", "MediaAudit"], routes: ["/lab/front-v2", "/dev/media-audit"], shell: "Internal tool" },
] as const;
