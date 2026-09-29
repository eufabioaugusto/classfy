import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUp, BookmarkPlus, ExternalLink, AudioLines, PanelRight, Plus, X, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudies, type StudyMessage } from "@/hooks/useStudies";
import { useMiniPlayer } from "@/contexts/MiniPlayerContext";
import { supabase } from "@/integrations/supabase/client";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { toast } from "sonner";
import "./global-classy.css";

type Recognition = { lang: string; interimResults: boolean; onresult: (event: { results: { transcript: string }[][] }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void };
function ClassyAvatar() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="classy-avatar">
      {/* A curious guide: expressive glasses and a balanced, rounded silhouette. */}
      <path d="M33 5C18 5 8 15 8 31v11c0 12 11 18 25 18s25-6 25-18V31C58 15 48 5 33 5Z" fill="#30203e"/>
      <path d="M33 11C22 11 13 19 13 31v11c0 9 9 15 20 15s20-6 20-15V31C53 19 44 11 33 11Z" fill="#fff7ef"/>
      <path d="M9 30C9 14 18 6 33 6s24 8 24 24l-4-3c-9-1-16-7-20-11-3 7-10 12-20 13Z" fill="#30203e"/>
      <path d="M34 10c7 1 12 4 15 9" fill="none" stroke="#674270" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M8 33c0-6 4-10 11-10s10 5 14 5 7-5 14-5 11 4 11 10-4 12-11 12-10-7-14-7-7 7-14 7S8 39 8 33Z" fill="#ed1651"/>
      <ellipse cx="20" cy="33" rx="8" ry="8.5" fill="white"/>
      <ellipse cx="46" cy="33" rx="8" ry="8.5" fill="white"/>
      <ellipse cx="21" cy="33" rx="4.5" ry="5.5" fill="#30203e"/>
      <ellipse cx="45" cy="33" rx="4.5" ry="5.5" fill="#30203e"/>
      <circle cx="23" cy="30" r="2" fill="white"/>
      <circle cx="47" cy="30" r="2" fill="white"/>
      <path d="M13 27q7-5 13 0M40 27q7-5 13 0" fill="none" stroke="#ff6990" strokeWidth="2" strokeLinecap="round"/>
      <path d="M28 47q5 5 10-1" fill="none" stroke="#30203e" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}
export function GlobalClassy() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { state: player } = useMiniPlayer();
  const { activeStudies, canCreateMore, loading, refetch } = useStudies();
  const refreshStudies = useRef(refetch);
  refreshStudies.current = refetch;
  useEffect(() => { void refreshStudies.current(); }, [location.pathname]);
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState(false);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<StudyMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [savedNotes, setSavedNotes] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const identity = useRef(user?.id);
  identity.current = user?.id;
  const routeStudy = location.pathname === "/c/new" ? undefined : location.pathname.match(/^\/c\/([^/]+)/)?.[1];
  const studyId = routeStudy || selected;
  const hidden = !user || /^\/(auth|onboarding|termos|privacidade|broadcast|admin|studio\/upload)(\/|$)/.test(location.pathname);
  const pageName = location.pathname === "/" ? "Explorar" : location.pathname.startsWith("/watch/") ? "Aula aberta" : location.pathname.startsWith("/listen/") ? "Podcast aberto" : routeStudy ? "Meu estudo" : location.pathname.startsWith("/shorts") ? "Shorts" : "Classfy";

  useEffect(() => { setOpen(false); setSelected(""); setDraft(""); setMessages([]); setSavedNotes(new Set()); recognition.current?.stop(); }, [user?.id]);
  useEffect(() => { if (!selected && activeStudies.length) setSelected(activeStudies[0].id); }, [activeStudies, selected]);
  useEffect(() => {
    if (!open || !studyId || !user?.id) return;
    let cancelled = false;
    const load = async () => {
      setHistoryLoading(true);
      const { data, error } = await supabase.from("study_messages").select("*").eq("study_id", studyId).order("created_at", { ascending: false }).limit(60);
      if (!cancelled) { if (error) toast.error("Não foi possível carregar a conversa."); else setMessages((data || []).reverse() as StudyMessage[]); setHistoryLoading(false); }
    };
    setMessages([]);
    void load();
    const refresh = (event: Event) => { if ((event as CustomEvent).detail?.studyId === studyId) void load(); };
    window.addEventListener("classfy:study-chat-updated", refresh);
    return () => { cancelled = true; window.removeEventListener("classfy:study-chat-updated", refresh); };
  }, [open, studyId, user]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); setActions(false); } };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); };
  }, []);
  useEffect(() => () => recognition.current?.stop(), []);
  useEffect(() => { if (hidden) { recognition.current?.stop(); setOpen(false); setActions(false); } }, [hidden]);

  async function newStudy() {
    if (!canCreateMore) { toast.error("Você atingiu o limite de estudos do seu plano."); return; }
    navigate("/c/new"); setOpen(false);
  }
  async function send(text = draft) {
    if (!text.trim() || busy || !user) return;
    setOpen(true); setActions(false);
    if (!studyId) { toast.info("Crie um estudo para começar sua conversa com a Classy."); return; }
    const requestUser = user.id;
    const requestStudy = studyId;
    setBusy(true); setDraft("");
    try {
      // Only public page identity is shared, never form values or the complete DOM.
      const heading = document.querySelector("main h1")?.textContent?.trim().slice(0, 180) || pageName;
      const media = document.querySelector<HTMLMediaElement>("main video, main audio");
      const pageContext = `${pageName}: ${heading}${media ? `; reprodução em ${Math.floor(media.currentTime)}s` : player.isVisible ? `; miniplayer: ${player.content?.title}, ${Math.floor(player.currentTime)}s` : ""}`;
      const { data, error } = await supabase.functions.invoke("classy-chat", { body: { studyId: requestStudy, message: text.trim(), pageContext } });
      if (identity.current !== requestUser) return;
      if (error || data?.error) throw new Error("Não foi possível falar com a Classy. Tente novamente.");
      if (data?.limitReached) { toast.info(data.message || "Limite de mensagens deste estudo atingido."); setDraft(text); return; }
      window.dispatchEvent(new CustomEvent("classfy:study-chat-updated", { detail: { studyId: requestStudy } }));
    } catch (error) { if (identity.current === requestUser) { setDraft(text); toast.error(error instanceof Error ? error.message : "Tente novamente."); } }
    finally { setBusy(false); }
  }
  async function saveNote(message: StudyMessage) {
    if (!user || busy || savedNotes.has(message.id)) return;
    const { error } = await supabase.from("study_notes").insert({ study_id: message.study_id, user_id: user.id, note_text: message.content, content_id: null, timestamp_seconds: null });
    if (error) toast.error("Não foi possível salvar a anotação."); else { setSavedNotes(previous => new Set(previous).add(message.id)); toast.success("Resposta salva nas anotações do estudo."); window.dispatchEvent(new CustomEvent("classfy:study-note-updated", { detail: { studyId: message.study_id } })); }
  }
  function dictate() {
    if (listening) { recognition.current?.stop(); return; }
    const ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition });
    const Engine = ctor.SpeechRecognition || ctor.webkitSpeechRecognition;
    if (!Engine) { toast.info("O ditado não está disponível neste navegador. Use o teclado."); return; }
    const instance = new Engine(); recognition.current = instance;
    instance.lang = "pt-BR"; instance.interimResults = false;
    instance.onresult = event => setDraft(previous => `${previous} ${event.results[0][0].transcript}`.trim());
    instance.onend = () => setListening(false);
    instance.onerror = () => { setListening(false); toast.info("Não foi possível usar o microfone. Confira a permissão do navegador."); };
    try { instance.start(); setListening(true); } catch { setListening(false); }
  }
  if (hidden) return null;
  return <div className={`classy-global ${routeStudy ? "classy-global--study" : ""} ${player.isVisible ? "classy-global--player" : ""}`}>
    {open && <section className="classy-panel" role="dialog" aria-modal="false" aria-label="Assistente Classy">
      <header className="classy-panel-header"><ClassyAvatar/><div><strong>Classy</strong><small>Seu espaço para aprender</small></div><button aria-label="Fechar Classy" onClick={() => setOpen(false)}><X size={19}/></button></header>
      <div className="classy-context"><span>Com você em · {pageName}</span><div><select aria-label="Estudo da conversa" value={studyId} disabled={!!routeStudy || busy || loading} onChange={event => setSelected(event.target.value)}><option value="">Escolha um estudo</option>{activeStudies.map(study => <option key={study.id} value={study.id}>{study.title}</option>)}</select><button aria-label="Abrir estudo" disabled={!studyId} onClick={() => navigate(`/c/${studyId}`)}><ExternalLink size={16}/></button></div></div>
      <div className="classy-messages" aria-busy={busy || historyLoading}>
        {historyLoading ? <p className="classy-empty">Carregando conversa…</p> : messages.length === 0 && <div className="classy-empty"><ClassyAvatar/><h2>Vamos descobrir algo?</h2><p>Escolha um estudo e me conte o que quer entender. Sua conversa e suas anotações ficam juntas.</p><button className="classy-create" disabled={!canCreateMore} onClick={newStudy}><Plus size={16}/> Criar um estudo</button></div>}
        {messages.filter(message => message.role !== "system").map(message => <article key={message.id} className={`classy-message classy-message--${message.role}`}><ChatMessage role={message.role} content={message.content}/>{message.role === "assistant" && <button className="classy-save" disabled={savedNotes.has(message.id)} onClick={() => saveNote(message)}><BookmarkPlus size={14}/> {savedNotes.has(message.id) ? "Anotação salva" : "Salvar anotação"}</button>}</article>)}
        {busy && <p role="status" className="classy-thinking"><Loader2 size={15} className="animate-spin"/> Classy está pensando…</p>}<div ref={bottom}/>
      </div>
      <div className="classy-suggestions">{["Explique com um exemplo", "Me dê um exercício", "O que estudar a seguir?"].map(text => <button key={text} disabled={busy || !studyId} onClick={() => send(text)}>{text}</button>)}</div>
      <p className="classy-context-note">Contexto: página e instante da reprodução. A Classy pode cometer erros.</p>
    </section>}
    {actions && <div className="classy-actions"><button onClick={newStudy}><Plus size={16}/> Novo estudo</button><button disabled={!studyId} onClick={() => { navigate(`/c/${studyId}`); setActions(false); }}><ExternalLink size={16}/> Abrir estudo atual</button></div>}
    <form className={`classy-bar ${open ? "classy-bar--open" : ""}`} onSubmit={event => { event.preventDefault(); void send(); }}>
      <button type="button" aria-label="Conversar com a Classy" onClick={() => setOpen(!open)}><ClassyAvatar/></button>
      <input ref={input} aria-label="Mensagem para Classy" placeholder="Aprender com a Classy" value={draft} maxLength={4000} onChange={event => setDraft(event.target.value)}/>
      <button type="button" aria-label="Ações da Classy" aria-expanded={actions} onClick={() => setActions(!actions)}><Plus size={20}/></button>
      <button type="button" aria-label={listening ? "Parar ditado" : "Ditar mensagem"} aria-pressed={listening} className={listening ? "classy-listening" : ""} onClick={dictate}><AudioLines size={19}/></button>
      {draft.trim() ? <button type="submit" aria-label="Enviar mensagem" disabled={busy}><ArrowUp size={20}/></button> : <button type="button" aria-label={open ? "Recolher painel" : "Abrir painel"} aria-expanded={open} onClick={() => setOpen(!open)}><PanelRight size={19}/></button>}
    </form>
  </div>;
}
