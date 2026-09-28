import { useEffect, useState } from "react";
import { ArrowUp, Check, Sparkles } from "lucide-react";

type Props = {
  name: string;
  actions: string[];
  busy: boolean;
  onStudy: () => Promise<boolean>;
};
export function ClassyChatDemo({ name, actions, busy, onStudy }: Props) {
  const message = `${name.trim() || "Você"}, esse insight é muito interessante. Posso incluir um exercício no seu estudo?`;
  const [visible, setVisible] = useState(0);
  const studied = actions.includes("study");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(message.length);
      return;
    }
    setVisible(0);
    const timer = window.setInterval(
      () =>
        setVisible((count) => {
          const next = Math.min(count + 2, message.length);
          if (next === message.length) window.clearInterval(timer);
          return next;
        }),
      38,
    );
    return () => window.clearInterval(timer);
  }, [message]);
  const typing = visible < message.length;
  return (
    <section className="ob-classy-chat" aria-label="Conversa com a Classy">
      <header className="ob-classy-chat-header">
        <span className="ob-classy-chat-avatar">
          <Sparkles />
        </span>
        <div>
          <strong>Classy</strong>
          <small>Sua parceira de aprendizado</small>
        </div>
        <span className="ob-classy-online" aria-label="Disponível" />
      </header>
      <div className="ob-classy-chat-messages">
        <div className="ob-classy-chat-label">
          <Sparkles />
          <strong>Classy</strong>
          {typing && (
            <span>
              Escrevendo
              <span className="ob-typing-dots" aria-hidden="true">
                •••
              </span>
            </span>
          )}
        </div>
        <p className="ob-classy-typed" aria-hidden="true">
          {message.slice(0, visible)}
          {typing && <span className="ob-typing-caret" />}
        </p>
        <span className="sr-only" role="status">
          {typing ? "Classy está escrevendo" : message}
        </span>
        {studied && (
          <>
            <div className="ob-classy-user-message">
              Sim, incluir no meu estudo <Check />
            </div>
            <div className="ob-classy-exercise">
              <Sparkles />
              <div>
                <strong>Vamos colocar em prática?</strong>
                <p>
                  Anote uma habilidade que você quer desenvolver e escolha uma
                  pequena ação para começar hoje.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="ob-classy-composer">
        <textarea
          aria-label="Resposta para a Classy"
          readOnly
          value={
            studied
              ? "Exercício incluído no meu estudo"
              : "Sim, incluir no meu estudo"
          }
          rows={2}
        />
        <button
          aria-label="Sim, incluir no meu estudo"
          title="Enviar resposta para a Classy"
          disabled={typing || !actions.includes("share") || busy || studied}
          onClick={() => void onStudy()}
        >
          {studied ? <Check /> : <ArrowUp />}
        </button>
      </div>
    </section>
  );
}
