import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { motion } from "framer-motion";

const faqs = [
  {
    question: "Quais são os benefícios do Classfy Premium?",
    answer: "O Premium oferece acesso completo a todos os conteúdos sem anúncios, downloads ilimitados para assistir offline, reprodução em segundo plano, cursos completos com certificado e recursos avançados de IA para estudo personalizado.",
  },
  {
    question: "Como faço o download de vídeos?",
    answer: "Com a assinatura ativa, um botão de download aparece em cada conteúdo. Basta tocar para salvar no seu dispositivo e assistir quando quiser, mesmo sem internet.",
  },
  {
    question: "Como faço para reproduzir vídeos em segundo plano?",
    answer: "Com o Premium ativo, os vídeos continuam reproduzindo automaticamente quando você minimiza o app ou desliga a tela. Perfeito para ouvir aulas enquanto faz outras atividades.",
  },
  {
    question: "Qual a diferença entre o Pro e o Premium?",
    answer: "O Pro remove anúncios e libera downloads e o Classy Chat ilimitado. O Premium inclui tudo do Pro e adiciona cursos completos, certificados, modo offline, reprodução em segundo plano e sessões de estudo avançadas com IA.",
  },
  {
    question: "Como posso cancelar minha assinatura?",
    answer: "Você pode cancelar sua assinatura quando quiser pelo seu perfil. O acesso continuará até o fim do período já pago. Não existe fidelidade.",
  },
];

export function PlansFAQ() {
  return (
    <section className="py-16 md:py-24 bg-muted/40">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-10">
            As respostas para suas perguntas
          </h2>

          <Accordion type="single" collapsible>
            {faqs.map((faq, idx) => (
              <AccordionItem key={idx} value={`item-${idx}`} className="border-b border-border">
                <AccordionTrigger className="text-left hover:no-underline text-foreground py-5 text-base">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed pb-5">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <p className="text-sm text-muted-foreground mt-6">
            Outras dúvidas?{" "}
            <a href="/conta" className="text-accent hover:underline">
              Fale com o suporte
            </a>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
