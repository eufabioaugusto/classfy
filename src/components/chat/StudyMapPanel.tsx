import { ArrowLeft, ArrowRight, BookOpen, Check, Compass, X } from "lucide-react";
import type { ClassyStudyState } from "@/components/chat/ClassyStudyStateBar";
import type { StudyJourneySummary } from "@/lib/study/getStudyJourneySummary";
import "./study-map-v2.css";

interface StudyMapPanelProps {
  title: string;
  state: ClassyStudyState | null;
  summary: StudyJourneySummary | null;
  latestAssistantContent?: string | null;
  onClose: () => void;
  onContinue: () => void;
  mobile?: boolean;
}

const stageLabels: Record<ClassyStudyState["activeMode"], string> = {
  onboard: "Ponto de partida",
  explain: "Explorando o tema",
  recommend: "Escolhendo conteúdos",
  practice: "Colocando em prática",
  review: "Revisando",
  plan: "Organizando a trilha",
};

export function StudyMapPanel({ title, state, summary, latestAssistantContent, onClose, onContinue, mobile = false }: StudyMapPanelProps) {
  const focus = state?.currentFocus || state?.userGoal || summary?.currentFocus || title;
  const stage = state?.activeMode ? stageLabels[state.activeMode] : summary?.stageLabel || "Ponto de partida";
  const question = state?.openQuestions?.find((item) => latestAssistantContent?.includes(item)) || null;
  const recommended = summary?.totalRecommendedContents || 0;
  const completed = summary?.completedContentsCount || 0;
  const contentProgress = recommended > 0 ? Math.round((completed / recommended) * 100) : null;
  const steps = state?.activeMode === "plan" || recommended > 0
    ? (state?.livePlanSteps || []).filter((step) => step !== state?.nextBestAction).slice(0, 3)
    : [];

  return (
    <aside id="study-map-panel" className={`cf-v2 cf2-study-map-panel ${mobile ? "cf2-study-map-panel--mobile" : ""}`} aria-label="Mapa do estudo">
      <header className="cf2-study-map-panel__header">
        <div className="cf2-study-map-panel__heading">
          <span className="cf2-study-map-panel__mark"><Compass size={18} strokeWidth={1.8} /></span>
          <div className="cf2-study-map-panel__heading-copy">
            <span className="cf2-study-map-panel__eyebrow">Seu percurso</span>
            <h2>Mapa do estudo</h2>
          </div>
        </div>
        <button type="button" className="cf2-study-map-panel__close" onClick={onClose} aria-label={mobile ? "Voltar para a conversa" : "Fechar mapa do estudo"}>
          {mobile ? <ArrowLeft size={18} /> : <X size={18} />}
        </button>
      </header>

      <div className="cf2-study-map-panel__scroll">
        <section className="cf2-study-map-panel__intro">
          <span className="cf2-study-map-panel__stage"><span aria-hidden="true" />{stage}</span>
          <p>Seu foco agora</p>
          <h3>{focus}</h3>
        </section>

        <section className="cf2-study-map-panel__section cf2-study-map-panel__next">
          <div className="cf2-study-map-panel__section-heading"><span className="cf2-study-map-panel__step-number">01</span><h3>Próximo passo</h3></div>
          <p>{question || (state?.activeMode === "onboard" ? "Conte à Classy o que você já sabe e o que quer alcançar. A conversa ajuda a definir sua trilha." : state?.nextBestAction || "Continue a conversa para construir sua trilha.")}</p>
          <button type="button" className="cf2-study-map-panel__continue" onClick={onContinue}>
            {question ? "Responder na conversa" : "Continuar estudo"}<ArrowRight size={16} />
          </button>
        </section>

        <section className="cf2-study-map-panel__section cf2-study-map-panel__contents">
          <div className="cf2-study-map-panel__section-heading"><BookOpen size={17} /><h3>Conteúdos da trilha</h3></div>
          {contentProgress !== null ? (
            <>
              <div className="cf2-study-map-panel__progress-copy"><strong>{completed} de {recommended}</strong><span>concluídos</span></div>
              <div className="cf2-study-map-panel__progress" role="progressbar" aria-label="Progresso nos conteúdos" aria-valuenow={contentProgress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${contentProgress}%` }} /></div>
              <p className="cf2-study-map-panel__detail">{summary?.playlistsCount || 0} playlists · {summary?.videosCount || 0} vídeos</p>
            </>
          ) : (
            <p className="cf2-study-map-panel__empty">Quando a Classy encontrar materiais relevantes para seu objetivo, sua trilha aparece aqui.</p>
          )}
        </section>

        {steps.length > 0 && <section className="cf2-study-map-panel__section"><div className="cf2-study-map-panel__section-heading"><h3>Sua trilha</h3></div><ol className="cf2-study-map-panel__steps">{steps.map((step, index) => <li key={`${index}-${step}`}><span>{index + 1}</span><p>{step}</p></li>)}</ol></section>}
        {(state?.masteredTopics?.length || 0) > 0 && <section className="cf2-study-map-panel__section"><div className="cf2-study-map-panel__section-heading"><Check size={17} /><h3>Você já domina</h3></div><div className="cf2-study-map-panel__tags">{state?.masteredTopics?.slice(0, 4).map((topic) => <span key={topic}>{topic}</span>)}</div></section>}
        {(state?.weakTopics?.length || 0) > 0 && <section className="cf2-study-map-panel__section"><div className="cf2-study-map-panel__section-heading"><h3>Vale revisar</h3></div><div className="cf2-study-map-panel__tags">{state?.weakTopics?.slice(0, 4).map((topic) => <span key={topic}>{topic}</span>)}</div></section>}
      </div>
    </aside>
  );
}
