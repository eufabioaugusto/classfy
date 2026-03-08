import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { motion } from "framer-motion";
import { HelpCircle } from "lucide-react";

const faqs = [
  {
    question: "Quais são os benefícios do Premium?",
    answer: "O Premium oferece acesso completo a todos os conteúdos sem anúncios, downloads ilimitados para assistir offline, reprodução em segundo plano, cursos completos com certificado e recursos avançados de IA para estudo personalizado.",
  },
  {
    question: "Qual é a diferença entre o Pro e o Premium?",
    answer: "O Pro remove anúncios e libera downloads e o Classy Chat ilimitado. O Premium inclui tudo do Pro e adiciona cursos completos, certificados, modo offline, reprodução em segundo plano e sessões de estudo avançadas com IA.",
  },
  {
    question: "Posso cancelar minha assinatura a qualquer momento?",
    answer: "Sim! Não existe fidelidade. Você pode cancelar quando quiser pelo seu perfil e continuará com acesso até o fim do período já pago.",
  },
  {
    question: "Como faço o download de vídeos?",
    answer: "Com a assinatura ativa, um botão de download aparece em cada conteúdo. Basta tocar para salvar no seu dispositivo e assistir quando quiser, mesmo sem internet.",
  },
  {
    question: "Como funciona a reprodução em segundo plano?",
    answer: "Com o Premium ativo, os vídeos continuam reproduzindo automaticamente quando você minimiza o app ou desliga a tela. Perfeito para ouvir aulas enquanto faz outras atividades.",
  },
  {
    question: "Os planos incluem todos os cursos?",
    answer: "O Premium dá acesso a todos os cursos disponíveis na plataforma. Alguns conteúdos avulsos podem ter preços separados dependendo do criador, mas a grande maioria está inclusa.",
  },
];

export function PlansFAQ() {
  return (
    <section className="py-20 md:py-28">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 mb-4">
            <HelpCircle className="w-6 h-6 text-accent" />
          </div>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Perguntas frequentes
          </h2>
          <p className="text-muted-foreground text-lg">
            Tire suas dúvidas sobre os planos
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto"
        >
          <Accordion type="single" collapsible className="space-y-3">
            {faqs.map((faq, idx) => (
              <AccordionItem
                key={idx}
                value={`item-${idx}`}
                className="border border-border/50 rounded-xl px-6 bg-card/50 backdrop-blur-sm data-[state=open]:border-accent/30 transition-colors"
              >
                <AccordionTrigger className="text-left hover:no-underline text-foreground/90 font-medium py-5">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed pb-5">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
}
