import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const faqs = [
  { question: "Qual é a diferença entre Pro e Premium?", answer: "O Pro libera uma experiência sem anúncios, downloads e até 50 estudos com 30 mensagens em cada um. O Premium reúne esses benefícios e amplia os estudos e mensagens, além de incluir cursos, modo offline e reprodução em segundo plano." },
  { question: "Posso cancelar quando quiser?", answer: "Sim. Você pode gerenciar ou cancelar sua assinatura pelo seu perfil. O acesso continua até o fim do período já pago, sem fidelidade." },
  { question: "Como assisto aos vídeos que salvei?", answer: "Com uma assinatura ativa, use o botão de download no conteúdo disponível. Os vídeos salvos ficam acessíveis para você continuar assistindo depois." },
  { question: "O que a Classy faz no meu estudo?", answer: "A Classy conversa com você sobre os temas que está explorando, ajuda a organizar ideias e sugere caminhos para aprofundar o aprendizado. Os limites de estudos e mensagens dependem do plano escolhido." },
];

export function PlansFAQ() {
  return <section className="plans-faq" aria-labelledby="plans-faq-title"><div className="plans-container plans-faq__grid"><div className="plans-section-heading"><span className="plans-eyebrow">AINDA TEM DÚVIDAS?</span><h2 id="plans-faq-title">Tudo o que você precisa saber.</h2><p>Escolha com tranquilidade.</p></div><div><Accordion type="single" collapsible>{faqs.map((faq, idx) => <AccordionItem key={faq.question} value={`item-${idx}`} className="plans-faq__item"><AccordionTrigger className="plans-faq__question">{faq.question}</AccordionTrigger><AccordionContent className="plans-faq__answer">{faq.answer}</AccordionContent></AccordionItem>)}</Accordion><p className="plans-faq__support">Precisa de ajuda? <a href="/conta">Fale com o suporte <span aria-hidden="true">↗</span></a></p></div></div></section>;
}
