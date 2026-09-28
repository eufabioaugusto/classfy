import { useEffect, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronRight,
  Crown,
  Coins,
  Heart,
  Loader2,
  Play,
  Trophy,
  Zap,
  BookOpen,
  Video,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getOnboarding,
  saveOnboarding,
  type OnboardingState,
} from "@/components/onboarding/api";
import { BecomeCreatorModal } from "@/components/BecomeCreatorModal";
import { dispatchRewardEarned } from "@/lib/rewards/events";
import "./onboarding.css";
const topics = [
  "Desenvolvimento pessoal",
  "Negócios",
  "Tecnologia e IA",
  "Criatividade",
  "Bem-estar",
  "Comunicação",
  "Finanças",
  "Carreira",
];
const labels = [
  "Assista a uma ideia",
  "Curta o que fez sentido",
  "Salve para voltar depois",
  "Transforme em aprendizado",
];
const copy = [
  "Na Classfy, assistir também faz parte da sua evolução. Experimente dar play.",
  "Gostou? Curta. Você participa e ajuda boas ideias a circularem.",
  "Uma ideia para guardar. Salve e encontre depois na sua biblioteca.",
  "A Classy ajuda você a aprofundar. Responda uma pergunta rápida.",
];
const steps = [
  "Seu caminho",
  "Seu perfil",
  "Experimente",
  "Sua evolução",
  "Vá além",
  "Tudo pronto",
];
export default function Onboarding() {
  const {
    user,
    loading: authLoading,
    profile,
    role,
    refreshProfile,
  } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [step, setStep] = useState(0),
    [journey, setJourney] = useState<"user" | "creator">("user"),
    [name, setName] = useState(""),
    [interests, setInterests] = useState<string[]>([]),
    [bio, setBio] = useState(""),
    [goal, setGoal] = useState("descobrir");
  const [actions, setActions] = useState<string[]>([]),
    [burst, setBurst] = useState(0),
    [playing, setPlaying] = useState(false),
    [answer, setAnswer] = useState(false),
    [completed, setCompleted] = useState(false),
    [preview, setPreview] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const isCreator = journey === "creator";
  const count = actions.length;
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth", { replace: true, state: { from: "/onboarding" } });
      return;
    }
    let active = true;
    const previewJourney = import.meta.env.DEV
      ? new URLSearchParams(window.location.search).get("preview")
      : null;
    if (previewJourney === "user" || previewJourney === "creator") {
      setPreview(true);
      setName(profile?.display_name || "Você");
      setJourney(previewJourney);
      setGoal(previewJourney === "creator" ? "publicar" : "descobrir");
      setLoading(false);
      return;
    }
    getOnboarding()
      .then(({ state }) => {
        if (!active) return;
        setName(state?.answers.name || profile?.display_name || "");
        setJourney(state?.journey || (role === "creator" ? "creator" : "user"));
        setInterests(state?.answers.interests || []);
        setBio(state?.answers.bio ?? profile?.bio ?? "");
        setGoal(state?.answers.goal || (role === "creator" ? "publicar" : "descobrir"));
        setActions(state?.demo_actions || []);
        setStep(state?.step || 0);
        setCompleted(!!state?.completed_at);
      })
      .catch(() =>
        setError("Não conseguimos preparar sua jornada. Tente novamente."),
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id, authLoading]);
  const apply = (state: OnboardingState) => {
    setActions(state.demo_actions);
    setCompleted(!!state.completed_at);
  };
  const persist = async (next: number, action?: string) => {
    if (preview) return;
    const state = await saveOnboarding(
      next,
      {
        name: name.trim(),
        interests,
        journey,
        ...(isCreator ? { bio } : {}),
        goal,
      },
      action,
    );
    apply(state);
    return state;
  };
  const advance = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = step + 1;
      const state = await persist(next);
      setStep(next);
      if (next === 5 && !preview) {
        await refreshProfile();
        if (state?.bonus_event_id && user)
          dispatchRewardEarned({
            eventId: state.bonus_event_id,
            actionKey: "ONBOARDING_BONUS",
            userId: user.id,
            points: 20,
            pointType: "user",
          });
        setBurst((b) => b + 1);
      }
    } catch {
      setError(
        "Não foi possível salvar. Seu progresso está aqui; tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  };
  const act = async (action: string) => {
    if (busy || actions.includes(action)) return;
    setBusy(true);
    setError("");
    try {
      if (preview) setActions((a) => [...a, action]);
      else await persist(2, action);
      setBurst((b) => b + 1);
    } catch {
      setError("Não foi possível registrar esta etapa. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setPlaying(false);
      void act("view");
    }, 3200);
    return () => clearTimeout(timer);
  }, [playing]);
  const destination = isCreator
    ? profile?.creator_status === "approved"
      ? "/studio/upload"
      : "/conta"
    : "/?mode=explore";
  const canNext =
    step === 0
      ? !!goal
      : step === 1
        ? name.trim().length >= 2 && interests.length > 0
        : step === 2
          ? count === 4
          : true;
  return (
    <main className="cf-onboarding">
      <header className="ob-header">
        <span className="ob-logo">Classfy</span>
        <span>
          {preview ? "PRÉVIA • SEM BÔNUS REAL" : "SEU PRIMEIRO CAPÍTULO"}
        </span>
      </header>
      {loading ? (
        <div className="ob-loading">
          <Loader2 className="animate-spin" />
          <p>Preparando sua jornada…</p>
        </div>
      ) : (
        <>
          <div className="ob-progress">
            <div>
              <span>{steps[step]}</span>
              <span>{step + 1} / 6</span>
            </div>
            <div className="ob-track">
              <i style={{ width: `${((step + 1) / 6) * 100}%` }} />
            </div>
          </div>
          <section className="ob-stage" key={step}>
            <aside className="ob-art" aria-hidden="true">
              <div className="ob-art-orbit" />
              <img src="/onboarding/journey-illustration.svg" alt="" />
              <span className="ob-float ob-float--top">
                <Zap /> Uma ação. Uma conquista.
              </span>
              <span className="ob-float ob-float--bottom">
                <Trophy /> Seu próximo nível começa aqui
              </span>
              <div className="ob-art-word">
                Dê play.
                <br />
                <em>Descubra mais.</em>
              </div>
            </aside>
            <div className="ob-content">
              {step === 0 && (
                <>
                  <span className="ob-eyebrow">BEM-VINDO À CLASSFY</span>
                  <h1>O que traz você até aqui?</h1>
                  <p>
                    Vamos preparar seu espaço para descobrir, aprender e ganhar
                    Points.
                  </p>
                  <div className="ob-options">
                    <button
                      className={journey === "user" ? "selected" : ""}
                      aria-pressed={journey === "user"}
                      onClick={() => {
                        setJourney("user");
                        setGoal("descobrir");
                      }}
                    >
                      <Play fill={journey === "user" ? "currentColor" : "none"} />
                      <span>
                        <strong>Quero assistir e aprender</strong>
                        <small>
                          Boas ideias, creators e novas descobertas.
                        </small>
                      </span>
                      <Check />
                    </button>
                    <button
                      className={journey === "creator" ? "selected" : ""}
                      aria-pressed={journey === "creator"}
                      onClick={() => {
                        setJourney("creator");
                        setGoal("publicar");
                      }}
                    >
                      <Video fill={journey === "creator" ? "currentColor" : "none"} />
                      <span>
                        <strong>Quero compartilhar o que sei</strong>
                        <small>Prepare seu perfil e comece como creator.</small>
                      </span>
                      <Check />
                    </button>
                  </div>
                  <div className="ob-note">
                    <Coins /> Na Classfy, quem aprende e quem ensina pode ganhar.
                  </div>
                </>
              )}
              {step === 1 && (
                <>
                  <span className="ob-eyebrow">DO SEU JEITO</span>
                  <h1>
                    {isCreator
                      ? "Seu conhecimento tem lugar aqui."
                      : "Vamos encontrar seus próximos assuntos."}
                  </h1>
                  <p>
                    Estas respostas já preparam seu perfil. Você pode editar
                    depois.
                  </p>
                  <label className="ob-label">
                    Como podemos chamar você?
                    <input
                      value={name}
                      maxLength={80}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                    />
                  </label>
                  <div className="ob-label">
                    {isCreator
                      ? "Sobre o que você quer criar?"
                      : "O que desperta sua curiosidade?"}
                    <small>Escolha de 1 a 5 assuntos.</small>
                  </div>
                  <div className="ob-topics">
                    {topics.map((t) => (
                      <button
                        key={t}
                        aria-pressed={interests.includes(t)}
                        onClick={() =>
                          setInterests((a) =>
                            a.includes(t)
                              ? a.filter((v) => v !== t)
                              : a.length < 5
                                ? [...a, t]
                                : a,
                          )
                        }
                      >
                        {interests.includes(t) && <Check size={13} />} {t}
                      </button>
                    ))}
                  </div>
                  {isCreator && (
                    <label className="ob-label">
                      Uma frase sobre você <small>Opcional</small>
                      <input
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        maxLength={280}
                        placeholder="O que você gosta de ensinar ou compartilhar?"
                      />
                    </label>
                  )}
                </>
              )}
              {step === 2 && (
                <>
                  <span className="ob-eyebrow">EXPERIMENTE NA PRÁTICA</span>
                  <h1>{count < 4 ? labels[count] : "Você pegou o jeito."}</h1>
                  <p>
                    {count < 4
                      ? copy[count]
                      : "Assistir, participar e estudar fazem sua jornada avançar."}
                  </p>
                  <div className="ob-demo">
                    <div className="ob-demo-visual">
                      <span>DEMONSTRAÇÃO</span>
                      <BookOpen size={65} />
                      <strong>Uma boa ideia pode ser o começo.</strong>
                      {count === 0 && (
                        <button
                          aria-label="Assistir demonstração"
                          disabled={playing || busy}
                          onClick={() => setPlaying(true)}
                        >
                          {playing ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Play fill="currentColor" />
                          )}
                        </button>
                      )}
                      <div
                        className={`ob-video-track ${playing ? "playing" : ""}`}
                      >
                        <i style={{ width: count ? "100%" : undefined }} />
                      </div>
                    </div>
                    <div className="ob-demo-actions">
                      <button
                        disabled={count !== 1 || busy}
                        className={actions.includes("like") ? "active" : ""}
                        onClick={() => void act("like")}
                      >
                        <Heart
                          fill={
                            actions.includes("like") ? "currentColor" : "none"
                          }
                        />{" "}
                        Curtir
                      </button>
                      <button
                        disabled={count !== 2 || busy}
                        className={actions.includes("save") ? "active" : ""}
                        onClick={() => void act("save")}
                      >
                        <Bookmark
                          fill={
                            actions.includes("save") ? "currentColor" : "none"
                          }
                        />{" "}
                        Salvar
                      </button>
                      <span className="ob-demo-counter">
                        <Zap />
                        {count * 5} / 20
                      </span>
                    </div>
                    {count === 3 && (
                      <div className="ob-quiz">
                        <strong>
                          Qual é uma boa forma de aprofundar uma ideia?
                        </strong>
                        <button disabled={busy} onClick={() => setAnswer(true)}>
                          Usar um quiz ou guardar uma anotação{" "}
                          {answer && <Check />}
                        </button>
                        {answer && (
                          <button
                            className="ob-primary"
                            disabled={busy}
                            onClick={() => void act("study")}
                          >
                            Concluir meu primeiro estudo <ArrowRight />
                          </button>
                        )}
                      </div>
                    )}
                    {count === 4 && (
                      <div className="ob-demo-done">
                        <Check /> Quatro ações. Sua primeira conquista.
                      </div>
                    )}
                  </div>
                  <div
                    className="ob-gain"
                    key={burst}
                    role="status"
                    aria-live="polite"
                  >
                    {burst > 0 && (
                      <>
                        <Zap /> +5 Points de demonstração <span>✦</span>
                      </>
                    )}
                  </div>
                  <small className="ob-disclaimer">
                    Esta é uma simulação. Ao concluir o onboarding, você recebe
                    um bônus real de 20 Points, uma única vez.
                  </small>
                </>
              )}
              {step === 3 && (
                <>
                  <span className="ob-eyebrow">VOCÊ JÁ ESTÁ NO GAME</span>
                  <h1>Aprenda. Participe. Ganhe.</h1>
                  <p>
                    Points mostram sua participação. Continue assistindo,
                    interagindo e estudando para evoluir.
                  </p>
                  <div className="ob-level">
                    <Trophy />
                    <strong>+20 Points</strong>
                    <span>Seu bônus de boas-vindas ao concluir</span>
                    <div className="ob-track">
                      <i style={{ width: "25%" }} />
                    </div>
                    <small>
                      Um primeiro passo para suas próximas conquistas.
                    </small>
                  </div>
                  <div className="ob-explain">
                    <div>
                      <Zap />
                      <span>
                        <strong>Points e níveis</strong> Acompanhe sua evolução
                        e o ranking em Recompensas.
                      </span>
                    </div>
                    <div>
                      <Users />
                      <span>
                        <strong>Participação e ganhos</strong> Assistir e
                        participar também podem gerar ganhos. Acompanhe sua
                        participação em cada ciclo; os valores dependem das
                        regras e da sua elegibilidade.
                      </span>
                    </div>
                    {isCreator && (
                      <div>
                        <Video />
                        <span>
                          <strong>Você também é creator</strong> Além dos User
                          Points, conheça os Creator Points e os ganhos ligados
                          ao seu conteúdo no Studio.
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
              {step === 4 && (
                <>
                  <span className="ob-eyebrow">ESCOLHA SEU RITMO</span>
                  <h1>
                    {isCreator
                      ? "Pronto para dar voz às suas ideias?"
                      : "Uma descoberta pode virar muito mais."}
                  </h1>
                  <p>
                    {isCreator
                      ? "Prepare seu perfil, envie seu conteúdo e acompanhe a revisão e os resultados no Studio."
                      : "Você pode começar gratuitamente e conhecer os planos quando quiser ampliar sua experiência."}
                  </p>
                  <div className="ob-plan">
                    <Crown className="ob-crown-pro" />
                    <div>
                      <strong>Classfy Pro</strong>
                      <span>Mais liberdade para assistir e estudar.</span>
                    </div>
                  </div>
                  <div className="ob-plan">
                    <Crown className="ob-crown-premium" />
                    <div>
                      <strong>Classfy Premium</strong>
                      <span>Explore a experiência completa da Classfy.</span>
                    </div>
                  </div>
                  <p className="ob-disclaimer">
                    Confira recursos, preços e condições na página de planos. A
                    assinatura é opcional.
                  </p>
                </>
              )}
              {step === 5 && (
                <>
                  <span className="ob-eyebrow">
                    SEU PRIMEIRO CAPÍTULO COMEÇOU
                  </span>
                  <h1>{name.split(" ")[0]}, você está pronto.</h1>
                  <p>
                    {isCreator
                      ? "Seu perfil foi preparado. Agora vamos dar o próximo passo como creator."
                      : preview
                        ? "Você experimentou o primeiro passo. Sua próxima descoberta espera por você."
                        : "Seu perfil e seus interesses estão salvos. Sua próxima descoberta espera por você."}
                  </p>
                  <div className="ob-success">
                    <div className="ob-success-icon">
                      <Trophy />
                    </div>
                    <strong>
                      {preview ? "Demonstração concluída" : "+20 Points"}
                    </strong>
                    <span>
                      {preview
                        ? "Seu bônus original permanece o mesmo."
                        : completed
                          ? "Bônus de boas-vindas registrado na sua conta."
                          : "Conclua as etapas para receber seu bônus."}
                    </span>
                    <div className="ob-confetti" aria-hidden="true">
                      {Array.from({ length: 12 }, (_, i) => (
                        <i key={i} style={{ "--i": i } as CSSProperties} />
                      ))}
                    </div>
                  </div>
                  <button
                    className="ob-primary"
                    onClick={() => {
                      if (preview && isCreator) {
                        navigate("/conta");
                        return;
                      }
                      if (
                        isCreator &&
                        profile?.creator_status !== "approved" &&
                        profile?.creator_status !== "pending"
                      )
                        setCreatorOpen(true);
                      else navigate(destination);
                    }}
                  >
                    {isCreator
                      ? profile?.creator_status === "approved"
                        ? "Preparar minha primeira publicação"
                        : profile?.creator_status === "pending"
                          ? "Acompanhar minha solicitação"
                          : "Solicitar acesso como creator"
                      : "Continuar minha jornada"}
                    <ArrowRight />
                  </button>
                  <Link className="ob-secondary-link" to="/recompensas">
                    Ver meus Points e recompensas <ChevronRight size={15} />
                  </Link>
                  <Link className="ob-secondary-link" to="/planos">
                    Conhecer os planos <Crown size={15} />
                  </Link>
                  <button
                    className="ob-replay"
                    onClick={() => {
                      setPreview(true);
                      setStep(0);
                      setActions([]);
                      setBurst(0);
                      setAnswer(false);
                    }}
                  >
                    Rever a experiência
                  </button>
                </>
              )}
              {error && (
                <div role="alert" className="ob-error">
                  {error}
                  {!name && (
                    <button onClick={() => window.location.reload()}>
                      Tentar novamente
                    </button>
                  )}
                </div>
              )}
              {step < 5 && (
                <footer className="ob-footer">
                  <button
                    className="ob-back"
                    disabled={busy || step === 0}
                    onClick={() => setStep((s) => s - 1)}
                  >
                    <ArrowLeft /> Voltar
                  </button>
                  <button
                    className="ob-primary"
                    disabled={!canNext || busy || (!!error && loading)}
                    onClick={() => void advance()}
                  >
                    {busy ? (
                      <Loader2 className="animate-spin" />
                    ) : step === 4 ? (
                      "Concluir e receber meu bônus"
                    ) : (
                      "Continuar"
                    )}
                    {!busy && <ArrowRight />}
                  </button>
                </footer>
              )}
            </div>
          </section>
        </>
      )}
      <BecomeCreatorModal
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        initialValues={{ channelName: name, bio }}
      />
    </main>
  );
}
