import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clapperboard,
  Clock3,
  Compass,
  Crown,
  Film,
  Flame,
  Gauge,
  GraduationCap,
  Home,
  Library,
  Maximize,
  Menu,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Sun,
  TrendingUp,
  Upload,
  Users,
  Volume2,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import heroEducadora from "@/assets/front-v2/hero-educadora.jpg";
import creatorCaio from "@/assets/front-v2/creator-caio.jpg";
import creatorLia from "@/assets/front-v2/creator-lia.jpg";
import creatorMarina from "@/assets/front-v2/creator-marina.jpg";
import { ClassfyV2Scope, V2Badge, V2Button } from "@/components/v2";
import "./front-v2-lab.css";

type LabTheme = "dark" | "light";
type ButtonTone = "primary" | "secondary" | "quiet";
type BadgeTone = "neutral" | "accent" | "premium" | "success";

const themeTokens = [
  { name: "Canvas", dark: "#08090B", light: "#FFFFFF" },
  { name: "Surface", dark: "#111317", light: "#FFFFFF" },
  { name: "Elevated", dark: "#181B20", light: "#F3F3F3" },
  { name: "Ink", dark: "#F5F6F7", light: "#17181B" },
  { name: "Muted", dark: "#969CA6", light: "#686C73" },
  { name: "Classfy", dark: "#F04F64", light: "#D93E55" },
  { name: "Premium", dark: "#D9B878", light: "#A77A2F" },
];

const lessons = [
  {
    title: "Como construir uma marca que permanece",
    creator: "Helena Costa",
    meta: "18 min · Estratégia",
    image: heroEducadora,
    badge: "NOVA AULA",
    className: "cfv2-thumb-brand",
  },
  {
    title: "Decisões melhores em ambientes incertos",
    creator: "André Ferraz",
    meta: "24 min · Negócios",
    image: creatorCaio,
    badge: "PRO",
    className: "cfv2-thumb-thinking",
  },
  {
    title: "IA prática: do repertório à execução",
    creator: "Lia Martins",
    meta: "32 min · Tecnologia",
    image: creatorLia,
    badge: "PREMIUM",
    className: "cfv2-thumb-ai",
  },
];

const featuredCreators = [
  { name: "Helena Costa", field: "Liderança & cultura", lesson: "Liderar sem perder a humanidade", image: heroEducadora, className: "hero" },
  { name: "Caio Moura", field: "Negócios & estratégia", lesson: "A clareza que move empresas", image: creatorCaio, className: "" },
  { name: "Lia Kim", field: "Tecnologia & futuro", lesson: "Pensar melhor com inteligência artificial", image: creatorLia, className: "" },
  { name: "Marina Reis", field: "Comunicação & presença", lesson: "Ideias que as pessoas lembram", image: creatorMarina, className: "" },
];

function ClassfyMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="cfv2-brand" aria-label="Classfy">
      <span className="cfv2-brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      {!compact && <span className="cfv2-brand-word">classfy</span>}
    </div>
  );
}

function LabButton({
  children,
  tone = "primary",
  icon,
  onClick,
}: {
  children: ReactNode;
  tone?: ButtonTone;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <V2Button className={`cfv2-button cfv2-button-${tone}`} variant={tone} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </V2Button>
  );
}

function LabBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return <V2Badge className={`cfv2-badge cfv2-badge-${tone}`} variant={tone}>{children}</V2Badge>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="cfv2-eyebrow">{children}</span>;
}

function SectionIntro({
  number,
  eyebrow,
  title,
  description,
  action,
}: {
  number: string;
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="cfv2-section-intro">
      <span className="cfv2-section-number">{number}</span>
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action && <div className="cfv2-section-action">{action}</div>}
    </div>
  );
}

function ContentCard({ item, featured = false }: { item: (typeof lessons)[number]; featured?: boolean }) {
  return (
    <article className={`cfv2-content-card ${featured ? "is-featured" : ""}`}>
      <div className={`cfv2-content-thumb ${item.className}`}>
        <img src={item.image} alt="" />
        <div className="cfv2-thumb-shade" />
        <LabBadge tone={item.badge === "PREMIUM" ? "premium" : item.badge === "PRO" ? "accent" : "neutral"}>
          {item.badge}
        </LabBadge>
        <button className="cfv2-play" type="button" aria-label={`Reproduzir ${item.title}`}>
          <Play size={18} fill="currentColor" />
        </button>
        <span className="cfv2-duration">{featured ? "08:42" : "12:18"}</span>
        <span className="cfv2-progress" style={{ width: featured ? "38%" : "0%" }} />
      </div>
      <div className="cfv2-content-copy">
        <div>
          <h3>{item.title}</h3>
          <p>{item.creator}</p>
          <span>{item.meta}</span>
        </div>
        <button className="cfv2-icon-button" type="button" aria-label="Mais opções">
          <MoreHorizontal size={18} />
        </button>
      </div>
    </article>
  );
}

function MetricCard({
  icon,
  label,
  value,
  note,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  tone?: "default" | "accent" | "premium";
}) {
  return (
    <article className={`cfv2-metric cfv2-metric-${tone}`}>
      <div className="cfv2-metric-top">
        <span className="cfv2-metric-icon">{icon}</span>
        <span className="cfv2-metric-note">{note}</span>
      </div>
      <strong>{value}</strong>
      <p>{label}</p>
    </article>
  );
}

function PeopleShowcase() {
  return (
    <div className="cfv2-people-showcase">
      <div className="cfv2-people-heading">
        <div>
          <span>Creators em destaque</span>
          <h3>Aprenda com quem vive o que ensina.</h3>
        </div>
        <div className="cfv2-carousel-actions">
          <button type="button" aria-label="Voltar"><ChevronRight size={18} /></button>
          <button type="button" aria-label="Avançar"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="cfv2-people-track">
        {featuredCreators.map((creator, index) => (
          <article className="cfv2-person-card" key={creator.name}>
            <img className={creator.className} src={creator.image} alt={`Retrato editorial de ${creator.name}`} />
            <div className="cfv2-person-shade" />
            <span className="cfv2-person-index">0{index + 1}</span>
            <div className="cfv2-person-copy">
              <small>{creator.field}</small>
              <h4>{creator.name}</h4>
              <i />
              <p>{creator.lesson}</p>
              <button type="button">Conhecer creator <ArrowRight size={14} /></button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function PlayerShowcase() {
  return (
    <div className="cfv2-player-layout">
      <div className="cfv2-player-stage">
        <img src={heroEducadora} alt="Helena Costa em seu ambiente de trabalho" />
        <div className="cfv2-player-vignette" />
        <div className="cfv2-player-brand"><ClassfyMark compact /><span>Original</span></div>
        <div className="cfv2-player-center">
          <button type="button" aria-label="Reproduzir"><Play size={26} fill="currentColor" /></button>
        </div>
        <div className="cfv2-player-controls">
          <div className="cfv2-player-progress"><span /><i /></div>
          <div className="cfv2-player-control-row">
            <div>
              <button type="button" aria-label="Pausar"><Pause size={19} fill="currentColor" /></button>
              <button type="button" aria-label="Volume"><Volume2 size={20} /></button>
              <span>08:42 / 24:18</span>
            </div>
            <div>
              <button className="cfv2-speed" type="button">1×</button>
              <button type="button" aria-label="Configurações"><Gauge size={20} /></button>
              <button type="button" aria-label="Tela cheia"><Maximize size={20} /></button>
            </div>
          </div>
        </div>
      </div>
      <div className="cfv2-player-meta">
        <div className="cfv2-player-title">
          <div>
            <Eyebrow>Episódio 03 · Liderança</Eyebrow>
            <h3>A cultura aparece nas decisões difíceis.</h3>
          </div>
          <LabBadge tone="premium"><Crown size={11} /> PREMIUM</LabBadge>
        </div>
        <p>Helena mostra como líderes consistentes transformam valores abstratos em escolhas que o time consegue enxergar.</p>
        <div className="cfv2-player-creator">
          <img src={heroEducadora} alt="" />
          <div><strong>Helena Costa</strong><span>Especialista em cultura e liderança</span></div>
          <button type="button">Ver perfil</button>
        </div>
        <div className="cfv2-player-chapters">
          <span>Próximos capítulos</span>
          <button type="button"><i>04</i><div><strong>Rituais que criam confiança</strong><small>12 min</small></div><Play size={15} /></button>
          <button type="button"><i>05</i><div><strong>Quando a cultura é testada</strong><small>16 min</small></div><Play size={15} /></button>
        </div>
      </div>
    </div>
  );
}

function AppShellPreview() {
  const nav = [
    { icon: <Home size={17} />, label: "Início", active: true },
    { icon: <Compass size={17} />, label: "Explorar" },
    { icon: <Library size={17} />, label: "Minha lista" },
    { icon: <GraduationCap size={17} />, label: "Classy" },
  ];

  return (
    <div className="cfv2-app-frame">
      <aside className="cfv2-app-sidebar">
        <ClassfyMark compact />
        <nav aria-label="Navegação demonstrativa">
          {nav.map((item) => (
            <button key={item.label} className={item.active ? "active" : ""} type="button">
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="cfv2-app-sidebar-bottom">
          <button type="button">
            <WalletCards size={17} />
            <span>Carteira</span>
          </button>
          <div className="cfv2-avatar">FS</div>
        </div>
      </aside>
      <div className="cfv2-app-main">
        <header className="cfv2-app-header">
          <button className="cfv2-icon-button cfv2-mobile-menu" type="button" aria-label="Menu">
            <Menu size={19} />
          </button>
          <div className="cfv2-search">
            <Search size={17} />
            <span>Busque aulas, temas e creators</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="cfv2-header-actions">
            <button className="cfv2-icon-button" type="button" aria-label="Notificações">
              <Bell size={18} />
              <i />
            </button>
            <LabButton tone="secondary" icon={<Upload size={15} />}>Criar</LabButton>
          </div>
        </header>
        <main className="cfv2-app-content">
          <div className="cfv2-app-kicker">Continue de onde parou</div>
          <div className="cfv2-app-title-row">
            <div>
              <h3>Seu próximo insight começa aqui.</h3>
              <p>Conteúdo relevante, com menos distração.</p>
            </div>
            <button type="button">Ver tudo <ChevronRight size={16} /></button>
          </div>
          <div className="cfv2-content-grid">
            {lessons.map((item, index) => <ContentCard item={item} featured={index === 0} key={item.title} />)}
          </div>
        </main>
      </div>
    </div>
  );
}

function ComponentSystem({ onOpenModal, onOpenSheet }: { onOpenModal: () => void; onOpenSheet: () => void }) {
  return (
    <div className="cfv2-component-stage">
      <div className="cfv2-controls-panel">
        <div className="cfv2-demo-group">
          <span className="cfv2-demo-label">Ações</span>
          <div className="cfv2-inline-wrap">
            <LabButton icon={<Play size={15} fill="currentColor" />}>Assistir agora</LabButton>
            <LabButton tone="secondary" icon={<Plus size={16} />}>Minha lista</LabButton>
            <LabButton tone="quiet">Ver detalhes</LabButton>
          </div>
        </div>

        <div className="cfv2-demo-group">
          <span className="cfv2-demo-label">Busca e entrada</span>
          <label className="cfv2-input-wrap">
            <Search size={17} />
            <input type="text" placeholder="Encontre o que quer aprender" aria-label="Busca demonstrativa" />
            <kbd>⌘ K</kbd>
          </label>
          <label className="cfv2-input-wrap is-focused">
            <Sparkles size={17} />
            <input type="text" defaultValue="Estratégia para creators" aria-label="Campo preenchido demonstrativo" />
            <Check size={17} />
          </label>
        </div>

        <div className="cfv2-demo-group">
          <span className="cfv2-demo-label">Status com significado</span>
          <div className="cfv2-inline-wrap">
            <LabBadge>NOVO</LabBadge>
            <LabBadge tone="accent">PRO</LabBadge>
            <LabBadge tone="premium"><Crown size={11} /> PREMIUM</LabBadge>
            <LabBadge tone="success"><Check size={11} /> CONCLUÍDO</LabBadge>
          </div>
        </div>

        <div className="cfv2-demo-group">
          <span className="cfv2-demo-label">Camadas de foco</span>
          <div className="cfv2-inline-wrap">
            <LabButton tone="secondary" onClick={onOpenModal}>Abrir dialog</LabButton>
            <LabButton tone="quiet" onClick={onOpenSheet}>Abrir sheet</LabButton>
          </div>
        </div>
      </div>

      <div className="cfv2-states-panel">
        <div className="cfv2-empty-state">
          <span><BookOpen size={22} /></span>
          <h3>Sua lista começa com uma boa escolha.</h3>
          <p>Salve conteúdos para voltar no momento certo.</p>
          <LabButton tone="secondary">Explorar conteúdos</LabButton>
        </div>
        <div className="cfv2-loading-card" aria-label="Exemplo de carregamento">
          <div className="cfv2-skeleton cfv2-skeleton-image" />
          <div className="cfv2-skeleton-lines">
            <span className="cfv2-skeleton wide" />
            <span className="cfv2-skeleton medium" />
            <span className="cfv2-skeleton short" />
          </div>
        </div>
      </div>
    </div>
  );
}

function WalletPreview() {
  return (
    <div className="cfv2-wallet-grid">
      <article className="cfv2-wallet-hero">
        <div className="cfv2-wallet-head">
          <div>
            <Eyebrow>Carteira Classfy</Eyebrow>
            <h3>Seu aprendizado também gera valor.</h3>
          </div>
          <span className="cfv2-wallet-icon"><WalletCards size={22} /></span>
        </div>
        <p>Saldo disponível</p>
        <strong><small>R$</small> 184,60</strong>
        <div className="cfv2-wallet-meta">
          <span><i className="is-available" /> Disponível para saque</span>
          <span>+ R$ 42,80 pendentes</span>
        </div>
        <div className="cfv2-wallet-actions">
          <LabButton>Solicitar saque</LabButton>
          <LabButton tone="quiet">Ver extrato</LabButton>
        </div>
      </article>

      <div className="cfv2-wallet-side">
        <MetricCard icon={<Flame size={18} />} label="Points neste ciclo" value="1.248" note="+18%" tone="accent" />
        <MetricCard icon={<Award size={18} />} label="Posição no ranking" value="# 42" note="Top 8%" />
        <article className="cfv2-reward-list">
          <div className="cfv2-card-heading">
            <div>
              <Eyebrow>Atividade</Eyebrow>
              <h3>Points recentes</h3>
            </div>
            <button type="button">Ver tudo</button>
          </div>
          <div className="cfv2-reward-row">
            <span className="cfv2-reward-icon"><Play size={15} /></span>
            <div><strong>Aula concluída</strong><small>Hoje, 14:32</small></div>
            <b>+ 12 pts</b>
          </div>
          <div className="cfv2-reward-row">
            <span className="cfv2-reward-icon"><Zap size={15} /></span>
            <div><strong>Sequência de estudos</strong><small>Ontem, 20:08</small></div>
            <b>+ 8 pts</b>
          </div>
        </article>
      </div>
    </div>
  );
}

function CreatorAndPlans() {
  return (
    <div className="cfv2-business-grid">
      <article className="cfv2-creator-panel">
        <div className="cfv2-card-heading">
          <div>
            <Eyebrow>Creator Studio</Eyebrow>
            <h3>Visão do seu conteúdo</h3>
          </div>
          <LabBadge tone="success">PUBLICADO</LabBadge>
        </div>
        <div className="cfv2-creator-metrics">
          <div><span>Alcance</span><strong>24,8 mil</strong><small><TrendingUp size={12} /> 12,4%</small></div>
          <div><span>Retenção média</span><strong>68%</strong><small>acima da média</small></div>
          <div><span>Creator Points</span><strong>2.480</strong><small>ciclo atual</small></div>
        </div>
        <div className="cfv2-chart" aria-label="Gráfico demonstrativo de desempenho">
          <div className="cfv2-chart-grid" />
          <svg viewBox="0 0 600 150" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="cfv2-chart-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--cf-accent)" stopOpacity=".28" />
                <stop offset="100%" stopColor="var(--cf-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0,118 C55,112 68,82 128,91 C188,100 205,55 266,65 C334,76 351,30 412,45 C470,60 500,18 600,24 L600,150 L0,150 Z" fill="url(#cfv2-chart-fill)" />
            <path d="M0,118 C55,112 68,82 128,91 C188,100 205,55 266,65 C334,76 351,30 412,45 C470,60 500,18 600,24" fill="none" stroke="var(--cf-accent)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div className="cfv2-chart-labels"><span>SEG</span><span>TER</span><span>QUA</span><span>QUI</span><span>SEX</span><span>SÁB</span><span>DOM</span></div>
        </div>
        <div className="cfv2-creator-footer">
          <span>Últimos 7 dias</span>
          <LabButton tone="secondary" icon={<BarChart3 size={15} />}>Abrir analytics</LabButton>
        </div>
      </article>

      <article className="cfv2-plan-panel">
        <div className="cfv2-plan-glow" />
        <LabBadge tone="premium"><Crown size={11} /> CLASSFY PREMIUM</LabBadge>
        <h3>Aprenda sem limites.<br />E no seu ritmo.</h3>
        <p>Experiência completa, conteúdos exclusivos e Classy ilimitada.</p>
        <div className="cfv2-plan-price"><strong>R$ 39,90</strong><span>/ mês</span></div>
        <ul>
          <li><Check size={14} /> Catálogo completo</li>
          <li><Check size={14} /> Classy sem limite de estudos</li>
          <li><Check size={14} /> 2× Points em ações elegíveis</li>
        </ul>
        <LabButton>Conhecer Premium <ArrowRight size={15} /></LabButton>
        <small>Cancele quando quiser.</small>
      </article>
    </div>
  );
}

function DialogPreview({ onClose }: { onClose: () => void }) {
  return (
    <div className="cfv2-overlay" role="presentation" onMouseDown={onClose}>
      <section className="cfv2-dialog" role="dialog" aria-modal="true" aria-labelledby="cfv2-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="cfv2-dialog-close" type="button" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        <span className="cfv2-dialog-icon"><Clapperboard size={22} /></span>
        <Eyebrow>Adicionar à lista</Eyebrow>
        <h3 id="cfv2-dialog-title">Guarde para o momento certo.</h3>
        <p>O conteúdo ficará disponível em Minha lista em todos os seus dispositivos.</p>
        <div className="cfv2-dialog-actions">
          <LabButton onClick={onClose}>Adicionar conteúdo</LabButton>
          <LabButton tone="quiet" onClick={onClose}>Agora não</LabButton>
        </div>
      </section>
    </div>
  );
}

function SheetPreview({ onClose }: { onClose: () => void }) {
  return (
    <div className="cfv2-overlay cfv2-sheet-overlay" role="presentation" onMouseDown={onClose}>
      <aside className="cfv2-sheet" role="dialog" aria-modal="true" aria-labelledby="cfv2-sheet-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="cfv2-dialog-close" type="button" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        <Eyebrow>Detalhes da aula</Eyebrow>
        <h3 id="cfv2-sheet-title">Antes de começar</h3>
        <div className="cfv2-sheet-list">
          <div><span><Clock3 size={16} /></span><p><strong>18 minutos</strong><small>Duração total</small></p></div>
          <div><span><Gauge size={16} /></span><p><strong>Intermediário</strong><small>Nível recomendado</small></p></div>
          <div><span><Users size={16} /></span><p><strong>4,8 de 5</strong><small>2.810 avaliações</small></p></div>
        </div>
        <LabButton icon={<Play size={15} fill="currentColor" />}>Começar aula</LabButton>
      </aside>
    </div>
  );
}

export default function FrontV2Lab() {
  const [theme, setTheme] = useState<LabTheme>("dark");
  const [modalOpen, setModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Classfy V2 — Laboratório Visual";
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <ClassfyV2Scope className="cfv2-lab" theme={theme}>
      <header className="cfv2-lab-topbar">
        <ClassfyMark />
        <div className="cfv2-lab-context">
          <span>FRONT V2</span>
          <i />
          <span>LABORATÓRIO VISUAL</span>
        </div>
        <div className="cfv2-lab-actions">
          <span className="cfv2-approval-tag"><i /> PROPOSTA PARA APROVAÇÃO</span>
          <div className="cfv2-theme-toggle" role="group" aria-label="Tema da apresentação">
            <button type="button" className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")} aria-label="Usar tema claro"><Sun size={15} /></button>
            <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")} aria-label="Usar tema escuro"><Moon size={15} /></button>
          </div>
        </div>
      </header>

      <main>
        <section className="cfv2-hero">
          <img className="cfv2-hero-photo" src={heroEducadora} alt="Helena Costa, creator da Classfy, em seu ambiente de trabalho" />
          <div className="cfv2-hero-shade" />
          <div className="cfv2-hero-copy">
            <LabBadge tone="premium"><Crown size={11} /> CLASSFY ORIGINAL</LabBadge>
            <Eyebrow>Nova série · 8 episódios</Eyebrow>
            <h1>Liderança é o que<br />você faz <em>quando importa.</em></h1>
            <p>Helena Costa mostra como transformar cultura em decisões claras, times fortes e trabalho que permanece.</p>
            <div className="cfv2-hero-actions">
              <LabButton icon={<Play size={15} fill="currentColor" />}>Assistir primeiro episódio</LabButton>
              <LabButton tone="secondary" icon={<Plus size={16} />}>Minha lista</LabButton>
            </div>
            <div className="cfv2-hero-byline">
              <span>COM</span>
              <strong>Helena Costa</strong>
              <i />
              <small>Especialista em cultura e liderança</small>
            </div>
          </div>
          <div className="cfv2-hero-counter"><span>01</span><i /><small>04</small></div>
        </section>

        <section className="cfv2-human-principles">
          <div><span>01</span><strong>Pessoas em primeiro plano</strong><p>Rostos, repertório e presença tornam o conhecimento desejável.</p></div>
          <div><span>02</span><strong>Produto fora do caminho</strong><p>A interface organiza o consumo sem competir com o conteúdo.</p></div>
          <div><span>03</span><strong>Premium é acabamento</strong><p>Tipografia, imagem e ritmo — não efeitos gratuitos ou iconografia colorida.</p></div>
        </section>

        <section className="cfv2-section cfv2-people-section">
          <SectionIntro number="01" eyebrow="Identidade humana" title="A Classfy tem rostos, não avatares genéricos." description="Creators são parte da marca. A fotografia editorial recebe protagonismo e a interface assume um papel silencioso." />
          <PeopleShowcase />
        </section>

        <section className="cfv2-section cfv2-foundations">
          <SectionIntro number="02" eyebrow="Fundação" title="Uma base silenciosa. Uma identidade reconhecível." description="Contraste confortável, hierarquia precisa e cor usada como significado — não decoração." />

          <div className="cfv2-foundation-grid">
            <article className="cfv2-token-card cfv2-colors-card">
              <div className="cfv2-card-heading">
                <div><Eyebrow>Paleta semântica</Eyebrow><h3>Cor que orienta</h3></div>
                <span>AA+</span>
              </div>
              <div className="cfv2-swatches">
                {themeTokens.map((token) => (
                  <div className="cfv2-swatch" key={token.name}>
                    <span style={{ background: theme === "dark" ? token.dark : token.light }} />
                    <strong>{token.name}</strong>
                    <small>{theme === "dark" ? token.dark : token.light}</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="cfv2-token-card cfv2-type-card">
              <Eyebrow>Tipografia</Eyebrow>
              <div className="cfv2-type-display">Conhecimento<br /><em>que transforma.</em></div>
              <div className="cfv2-type-samples">
                <div><span>DISPLAY / 56</span><strong>Domínio e presença</strong></div>
                <div><span>TÍTULO / 28</span><strong>Clareza em cada escolha</strong></div>
                <div><span>CORPO / 16</span><p>Leitura simples, confortável e direta para qualquer jornada.</p></div>
                <div><span>LABEL / 11</span><b>CONTEXTO E NAVEGAÇÃO</b></div>
              </div>
            </article>

            <article className="cfv2-token-card cfv2-surfaces-card">
              <Eyebrow>Superfícies e camadas</Eyebrow>
              <div className="cfv2-surface-stack">
                <div className="cfv2-surface-layer layer-1"><span>01</span><strong>Canvas</strong><small>Base imersiva</small></div>
                <div className="cfv2-surface-layer layer-2"><span>02</span><strong>Surface</strong><small>Organização</small></div>
                <div className="cfv2-surface-layer layer-3"><span>03</span><strong>Elevated</strong><small>Foco temporário</small></div>
              </div>
              <div className="cfv2-shape-specs">
                <div><span className="radius-1" /><strong>8 px</strong><small>controles</small></div>
                <div><span className="radius-2" /><strong>14 px</strong><small>cards</small></div>
                <div><span className="radius-3" /><strong>20 px</strong><small>painéis</small></div>
              </div>
            </article>

            <article className="cfv2-token-card cfv2-spacing-card">
              <Eyebrow>Ritmo e espaçamento</Eyebrow>
              <h3>Espaço também comunica hierarquia.</h3>
              <div className="cfv2-spacing-scale">
                {[4, 8, 12, 16, 24, 32, 48, 64].map((space) => <div key={space}><span style={{ width: `${space}px` }} /><small>{space}</small></div>)}
              </div>
              <p>Base de 4 px. Mais densidade para navegação; mais respiro para descoberta e decisão.</p>
            </article>
          </div>
        </section>

        <section className="cfv2-section cfv2-components-section">
          <SectionIntro number="03" eyebrow="Sistema" title="Componentes que se explicam sozinhos." description="Estados claros, ações previsíveis e uma interface que permanece familiar em qualquer contexto." />
          <ComponentSystem onOpenModal={() => setModalOpen(true)} onOpenSheet={() => setSheetOpen(true)} />
        </section>

        <section className="cfv2-section cfv2-experience-section">
          <SectionIntro number="04" eyebrow="Experiência de consumo" title="Mais conteúdo por tela. Menos esforço para encontrar." description="Shell completo, busca sempre acessível e três colunas reais de conteúdo — inspirado na praticidade do YouTube, preservando a identidade Classfy." action={<LabButton tone="quiet">Ver anatomia <ArrowRight size={15} /></LabButton>} />
          <AppShellPreview />
        </section>

        <section className="cfv2-section cfv2-player-section">
          <SectionIntro number="05" eyebrow="Player Classfy" title="O momento de assistir também precisa ter identidade." description="A imagem permanece soberana; controles são precisos e familiares, enquanto creator, contexto e próximos capítulos formam uma experiência própria." />
          <PlayerShowcase />
        </section>

        <section className="cfv2-section cfv2-value-section">
          <SectionIntro number="06" eyebrow="Valor e progresso" title="Economia clara. Conquista com significado." description="Rewards, saldo e evolução apresentados de forma transparente, humana e fácil de compreender." />
          <WalletPreview />
        </section>

        <section className="cfv2-section cfv2-business-section">
          <SectionIntro number="07" eyebrow="Ecossistema" title="Criar, crescer e evoluir — na mesma linguagem." description="A interface muda de densidade conforme a tarefa, mas mantém a identidade e a hierarquia da Classfy." />
          <CreatorAndPlans />
        </section>

        <footer className="cfv2-lab-footer">
          <ClassfyMark />
          <p>Uma plataforma simples de usar.<br />Difícil de esquecer.</p>
          <span>FRONT V2 · DIREÇÃO VISUAL 01</span>
        </footer>
      </main>

      {modalOpen && <DialogPreview onClose={() => setModalOpen(false)} />}
      {sheetOpen && <SheetPreview onClose={() => setSheetOpen(false)} />}
    </ClassfyV2Scope>
  );
}
