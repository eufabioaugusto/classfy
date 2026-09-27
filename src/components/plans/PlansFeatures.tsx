import { ArrowDownToLine, ArrowRight, BookOpen, Check, Headphones, MessageCircle, Pause, Play, Sparkles } from "lucide-react";

const features = [
  {
    number: "01 / 04",
    eyebrow: "SEM INTERRUPÇÕES",
    title: "Fique na história, não no anúncio.",
    description: "Dê play nos conteúdos que você escolheu e mantenha o foco no que importa: descobrir, assistir e aprender.",
    visual: "watch",
  },
  {
    number: "02 / 04",
    eyebrow: "NO SEU TEMPO",
    title: "Sua próxima aula vai com você.",
    description: "Salve seus vídeos e continue assistindo onde estiver. A sua jornada acompanha a sua rotina.",
    visual: "offline",
  },
  {
    number: "03 / 04",
    eyebrow: "EM SEGUNDO PLANO",
    title: "Continue ouvindo, mesmo em movimento.",
    description: "Com o Premium, a reprodução continua enquanto você usa outros apps ou deixa a tela bloqueada.",
    visual: "background",
  },
  {
    number: "04 / 04",
    eyebrow: "ESTUDE COM A CLASSY",
    title: "O vídeo termina. A conversa continua.",
    description: "Pergunte, organize ideias e aprofunde o assunto com a Classy. Cada descoberta pode virar o começo de um estudo.",
    visual: "study",
  },
];

function FeatureVisual({ kind }: { kind: string }) {
  if (kind === "watch") return <div className="plans-scene plans-scene--watch" aria-hidden="true"><div className="plans-scene__screen"><div className="plans-scene__gradient"><Play size={25} fill="currentColor" /></div><div className="plans-scene__screen-footer"><span>CONTINUE ASSISTINDO</span><strong>O próximo capítulo é seu</strong><div className="plans-scene__bar"><i /></div></div></div><div className="plans-scene__floating"><Check size={15} /> Reprodução sem anúncios</div></div>;
  if (kind === "offline") return <div className="plans-scene plans-scene--offline" aria-hidden="true"><div className="plans-scene__phone"><div className="plans-scene__phone-notch" /><span className="plans-scene__phone-label">SUA BIBLIOTECA</span><div className="plans-scene__phone-art"><Play size={25} fill="currentColor" /></div><strong>Para assistir depois</strong><div className="plans-scene__download-row"><ArrowDownToLine size={16} /><span>Vídeo salvo</span><Check size={15} /></div></div><div className="plans-scene__orbit plans-scene__orbit--one" /><div className="plans-scene__orbit plans-scene__orbit--two" /></div>;
  if (kind === "background") return <div className="plans-scene plans-scene--background" aria-hidden="true"><div className="plans-scene__audio"><span className="plans-scene__audio-label">AGORA TOCANDO</span><div className="plans-scene__audio-cover"><Headphones size={34} /></div><strong>Continue aprendendo</strong><small>Uma aula para ouvir no seu ritmo</small><div className="plans-scene__audio-progress"><span /></div><div className="plans-scene__audio-controls"><span>↶</span><span className="plans-scene__pause"><Pause size={18} fill="currentColor" /></span><span>↷</span></div></div></div>;
  return <div className="plans-scene plans-scene--study" aria-hidden="true"><div className="plans-scene__study-card"><div className="plans-scene__study-header"><span><Sparkles size={17} /> Classy</span><span>SEU ESTUDO</span></div><div className="plans-scene__study-bubble">O que você gostaria de entender melhor sobre essa aula?</div><div className="plans-scene__study-options"><span><BookOpen size={13} /> Explorar o tema</span><span><MessageCircle size={13} /> Fazer uma pergunta</span></div><div className="plans-scene__study-input">Pergunte à Classy <ArrowRight size={15} /></div></div></div>;
}

export function PlansFeatures() {
  return <section className="plans-features" aria-labelledby="plans-features-title"><div className="plans-container"><div className="plans-section-heading plans-section-heading--center"><span className="plans-eyebrow">MAIS DO QUE UM PLAY</span><h2 id="plans-features-title">O que muda na sua experiência.</h2><p>Mais tempo para o conteúdo. Mais espaço para a curiosidade.</p></div><div className="plans-features__list">{features.map((feature, index) => <article className={`plans-feature ${index % 2 ? "plans-feature--reverse" : ""}`} key={feature.number}><div className="plans-feature__copy"><span className="plans-feature__index">{feature.number}</span><span className="plans-eyebrow">{feature.eyebrow}</span><h3>{feature.title}</h3><p>{feature.description}</p></div><FeatureVisual kind={feature.visual} /></article>)}</div></div></section>;
}
