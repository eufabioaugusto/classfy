import { ArrowRight, BookOpen, Check, Headphones, Play, Sparkles } from "lucide-react";

const benefits = [
  { number: "01", title: "Assista sem pausas", detail: "Seus conteúdos, sem anúncios no caminho.", icon: Play },
  { number: "02", title: "Leve com você", detail: "Salve vídeos para continuar depois.", icon: Headphones },
  { number: "03", title: "Aprenda com a Classy", detail: "Transforme curiosidade em estudo.", icon: Sparkles },
  { number: "04", title: "Siga no seu ritmo", detail: "Retome a jornada de onde parou.", icon: BookOpen },
];

export function PlansHero() {
  return (
    <section className="plans-hero" aria-labelledby="plans-hero-title">
      <div className="plans-container">
        <div className="plans-hero__main">
          <div className="plans-hero__copy">
            <span className="plans-eyebrow"><span className="plans-eyebrow__line" /> CLASSFY PREMIUM</span>
            <h1 id="plans-hero-title">Mais do que assistir. <em>Continue aprendendo.</em></h1>
            <p>Seus criadores favoritos, uma experiência sem interrupções e a Classy para aprofundar o que despertou sua curiosidade.</p>
            <div className="plans-hero__actions">
              <button type="button" className="plans-button plans-button--red" onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}>
                Conhecer os planos <ArrowRight size={17} />
              </button>
              <span>A partir de R$ 29,90/mês · Cancele quando quiser</span>
            </div>
          </div>
          <div className="plans-hero__visual" aria-hidden="true">
            <div className="plans-visual__orb" />
            <div className="plans-visual__video">
              <div className="plans-visual__poster"><div className="plans-visual__poster-light" /><div className="plans-visual__play"><Play size={22} fill="currentColor" /></div></div>
              <div className="plans-visual__video-info"><span className="plans-visual__micro">AGORA NA CLASSFY</span><strong>Uma ideia pode levar você mais longe.</strong><span>Assista · explore · aprenda</span></div>
              <div className="plans-visual__timeline"><span /></div>
            </div>
            <div className="plans-visual__chat"><span className="plans-visual__chat-icon"><Sparkles size={18} /></span><span><strong>Classy</strong><small>O que você quer entender melhor?</small></span><ArrowRight size={15} /></div>
            <div className="plans-visual__progress"><span><Check size={13} /></span><strong>Seu próximo passo começa aqui</strong></div>
          </div>
        </div>
        <div className="plans-hero__benefits">
          {benefits.map(({ number, title, detail, icon: Icon }) => (
            <div className="plans-benefit" key={number}>
              <div className="plans-benefit__top"><span>{number}</span><Icon size={18} strokeWidth={1.8} /></div>
              <strong>{title}</strong><p>{detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
