import { useRef, useState } from "react";
import {
  Bookmark,
  Check,
  Coins,
  FileText,
  Heart,
  Play,
  Send,
  Sparkles,
  StickyNote,
  X,
} from "lucide-react";

type Props = {
  actions: string[];
  busy: boolean;
  onAction: (action: string) => Promise<boolean>;
};
export function OnboardingDemo({ actions, busy, onAction }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [half, setHalf] = useState(actions.includes("view"));
  const [watched, setWatched] = useState(actions.includes("view") ? 1 : 0);
  const [finished, setFinished] = useState(actions.includes("view"));
  const [gain, setGain] = useState({ id: 0, text: "" });
  const [shareOpen, setShareOpen] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [tool, setTool] = useState("quiz");
  const [answer, setAnswer] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const has = (action: string) => actions.includes(action);
  const celebrate = (text: string) => setGain((g) => ({ id: g.id + 1, text }));
  const record = async (action: string, message: string) => {
    const saved = await onAction(action);
    if (!saved) return false;
    // Persisted actions drive the counter and completion; this animation is educational.
    celebrate(message);
    return true;
  };
  const progress = () => {
    const el = video.current;
    if (!el || !Number.isFinite(el.duration) || !el.duration) return;
    let seconds = 0;
    for (let i = 0; i < el.played.length; i++)
      seconds += el.played.end(i) - el.played.start(i);
    const ratio = Math.min(1, seconds / el.duration);
    setWatched(ratio);
    if (ratio >= 0.5 && !half) {
      setHalf(true);
      celebrate("50% assistido · +5 Points");
    }
    if (ratio >= 0.98 && !finished) {
      setFinished(true);
      void record("view", "100% assistido · +5 Points");
    }
  };
  const points = actions.length * 5 + (half ? 5 : 0);
  return (
    <>
      <div className="ob-demo ob-real-demo">
        <div className="ob-real-player">
          <video
            ref={video}
            src="/onboarding/learning-demo.mp4"
            poster="/onboarding/learning-demo.jpg"
            controls={started}
            playsInline
            preload="metadata"
            muted
            onTimeUpdate={progress}
            onEnded={progress}
            onError={() => setMediaError(true)}
            aria-label="Vídeo de uma creator ensinando online"
          />
          <span className="ob-demo-badge">EXPERIMENTE • 8 SEGUNDOS</span>
          {!started && !mediaError && (
            <button
              className="ob-real-play"
              aria-label="Assistir vídeo"
              onClick={async () => {
                try {
                  await video.current?.play();
                  setStarted(true);
                } catch {
                  setMediaError(true);
                }
              }}
            >
              <Play fill="currentColor" />
            </button>
          )}
          {mediaError && (
            <div className="ob-media-error">
              Não conseguimos reproduzir o vídeo.
              <button
                onClick={() => {
                  setMediaError(false);
                  setStarted(false);
                  video.current?.load();
                }}
              >
                Tentar novamente
              </button>
            </div>
          )}
          <div
            className="ob-watch-milestones"
            aria-label={`${Math.round(watched * 100)}% assistido`}
          >
            <i style={{ width: `${watched * 100}%` }} />
            <span className={half ? "earned" : ""}>
              50% {half && <Check />}
            </span>
            <span className={has("view") ? "earned" : ""}>
              100% {has("view") && <Check />}
            </span>
          </div>
        </div>
        <div className="ob-demo-info">
          <strong>Uma nova habilidade começa com um play.</strong>
          <small>Aprendizado • Vídeo de demonstração sem áudio</small>
        </div>
        <div className="ob-demo-creator">
          <img src="/onboarding/creator-avatar.jpg" alt="Creator do vídeo" />
          <div>
            <strong>Creator Classfy</strong>
            <small>Compartilhando conhecimento</small>
          </div>
          <button
            aria-pressed={followed}
            onClick={() => setFollowed(!followed)}
          >
            {followed ? (
              <>
                <Check /> Seguindo
              </>
            ) : (
              "+ Seguir"
            )}
          </button>
        </div>
        <div className="ob-demo-actions">
          <button
            disabled={!has("view") || busy || has("like")}
            className={has("like") ? "active" : ""}
            onClick={() => void record("like", "Você curtiu · +5 Points")}
          >
            <Heart fill={has("like") ? "currentColor" : "none"} />
            Curtir
          </button>
          <button
            disabled={!has("like") || busy || has("save")}
            className={has("save") ? "active" : ""}
            onClick={() => void record("save", "Ideia salva · +5 Points")}
          >
            <Bookmark fill={has("save") ? "currentColor" : "none"} />
            Salvar
          </button>
          <button
            disabled={!has("save") || busy || has("share")}
            className={has("share") ? "active" : ""}
            onClick={() => setShareOpen(true)}
          >
            <Send />
            Compartilhar
          </button>
        </div>
        <div className="ob-demo-points">
          <Coins />
          <strong>{points} Points</strong>
          <span>de demonstração</span>
        </div>
        {shareOpen && (
          <div
            className="ob-direct"
            role="dialog"
            aria-label="Compartilhar por direct"
            aria-modal="false"
          >
            <div>
              <strong>Enviar por direct</strong>
              <button
                aria-label="Fechar compartilhamento"
                onClick={() => setShareOpen(false)}
              >
                <X />
              </button>
            </div>
            <small>Experimente compartilhar uma descoberta.</small>
            <div className="ob-direct-person">
              <span>A</span>
              <div>
                <strong>Ana</strong>
                <small>Contato de demonstração</small>
              </div>
              <button
                disabled={busy}
                onClick={async () => {
                  const sent = await record(
                    "share",
                    "Descoberta compartilhada · +5 Points",
                  );
                  if (sent) setShareOpen(false);
                }}
              >
                <Send /> Enviar
              </button>
            </div>
            <small>Este envio é uma simulação.</small>
          </div>
        )}
        <div
          className="ob-study-tools"
          role="tablist"
          aria-label="Ferramentas de estudo"
        >
          {[
            { id: "transcript", text: "Transcrição", Icon: FileText },
            { id: "quiz", text: "Quiz Classy", Icon: Sparkles },
            { id: "notes", text: "Anotações", Icon: StickyNote },
          ].map(({ id, text, Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tool === id}
              onClick={() => setTool(id)}
            >
              <Icon />
              {text}
            </button>
          ))}
        </div>
        <div className="ob-quiz" role="tabpanel">
          {tool === "transcript" && (
            <p>
              Quando o conteúdo tem fala, você pode acompanhar a transcrição e
              rever os pontos principais aqui.
            </p>
          )}
          {tool === "notes" && (
            <label className="ob-label">
              Guarde uma ideia para colocar em prática
              <textarea
                placeholder="O que você quer aprender hoje?"
                maxLength={500}
              />
            </label>
          )}
          {tool === "quiz" && (
            <>
              <strong>Como você pode aprofundar o que aprende?</strong>
              <button
                disabled={!has("share") || busy || has("study")}
                onClick={() => setAnswer(true)}
              >
                Respondendo um quiz e anotando minhas ideias{" "}
                {answer && <Check />}
              </button>
              {answer && !has("study") && (
                <button
                  className="ob-primary"
                  disabled={busy}
                  onClick={() =>
                    void record("study", "Aprendizado em ação · +5 Points")
                  }
                >
                  Concluir meu primeiro estudo <Check />
                </button>
              )}
            </>
          )}
        </div>
        {has("study") && (
          <div className="ob-demo-done">
            <Check /> Você aprendeu, participou e ganhou!
          </div>
        )}
        {finished && !has("view") && !busy && (
          <button
            className="ob-primary ob-watch-retry"
            onClick={() => void record("view", "100% assistido · +5 Points")}
          >
            Registrar vídeo assistido
          </button>
        )}
      </div>
      <div className="ob-gain" key={gain.id} role="status" aria-live="polite">
        {gain.text && (
          <>
            <Coins />
            {gain.text}
            <span>✦</span>
          </>
        )}
      </div>
      <small className="ob-disclaimer">
        É assim que você evolui na Classfy: assista, participe e estude para
        ganhar Points.
      </small>
    </>
  );
}
