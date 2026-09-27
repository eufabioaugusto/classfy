import { Crown, Zap } from "lucide-react";

export type PaidPlan = "pro" | "premium";

export const PLAN_OFFERS = {
  pro: {
    title: "Pro",
    price: "29,90",
    description: "Mais liberdade para assistir e estudar.",
    intro: "Para quem já encontrou o que gosta e quer ir além.",
    features: ["Vídeos sem anúncios", "Até 50 estudos com a Classy", "30 mensagens por estudo", "Downloads ilimitados", "Suporte prioritário"],
    label: "MAIS LIBERDADE",
    icon: Zap,
  },
  premium: {
    title: "Premium",
    price: "49,90",
    description: "O seu jeito mais completo de aprender.",
    intro: "Para quem quer explorar sem limites.",
    features: ["Tudo do plano Pro", "Estudos e mensagens ilimitados", "Cursos completos com certificado", "Modo offline e segundo plano", "Acesso antecipado a novidades"],
    label: "EXPERIÊNCIA COMPLETA",
    icon: Crown,
  },
} as const;
