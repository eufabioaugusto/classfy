import { useClassyDictation } from "./useClassyDictation";
import { ClassyContextTools } from "./ClassyContextTools";
import { studyModes, type ContextMenu, type StudyMode } from "./classyModes";
import { useClassyLesson, type ClassyReference } from "./classyPageContext";
import { useClassyTarget, type ClassyTarget } from "./useClassyTarget";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUp, BookmarkPlus, ExternalLink, AudioLines, PanelRight, Plus, X, Loader2, Square } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudies, type StudyMessage } from "@/hooks/useStudies";
import { useMiniPlayer } from "@/contexts/MiniPlayerContext";
import { supabase } from "@/integrations/supabase/client";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { toast } from "sonner";
import "./global-classy.css";

function ClassyAvatar() {
  const avatar = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const element = avatar.current;
    if (!element || !window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const followPointer = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      const proximity = Math.max(0, 1 - Math.hypot(dx, dy) / 220);
      const lookX = Math.max(-1, Math.min(1, dx / 45)) * 3 * proximity;
      const lookY = Math.max(-1, Math.min(1, dy / 45)) * 2 * proximity;
      element.style.setProperty("--classy-look-x", `${lookX.toFixed(2)}px`);
      element.style.setProperty("--classy-look-y", `${lookY.toFixed(2)}px`);
    };

    window.addEventListener("pointermove", followPointer, { passive: true });
    return () => window.removeEventListener("pointermove", followPointer);
  }, []);

  return (
    <svg ref={avatar} viewBox="0 0 64 64" aria-hidden="true" className="classy-avatar">
      {/* A curious guide: expressive glasses and a balanced, rounded silhouette. */}
      <path d="M33 5C18 5 8 15 8 31v11c0 12 11 18 25 18s25-6 25-18V31C58 15 48 5 33 5Z" fill="#30203e"/>
      <path d="M33 11C22 11 13 19 13 31v11c0 9 9 15 20 15s20-6 20-15V31C53 19 44 11 33 11Z" fill="#fff7ef"/>
      <path d="M9 30C9 14 18 6 33 6s24 8 24 24l-4-3c-9-1-16-7-20-11-3 7-10 12-20 13Z" fill="#30203e"/>
      <path d="M34 10c7 1 12 4 15 9" fill="none" stroke="#674270" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M8 33c0-6 4-10 11-10s10 5 14 5 7-5 14-5 11 4 11 10-4 12-11 12-10-7-14-7-7 7-14 7S8 39 8 33Z" fill="var(--brand-red)"/>
      <g className="classy-avatar-eyes">
        <ellipse cx="20" cy="33" rx="8" ry="8.5" fill="white"/>
        <ellipse cx="46" cy="33" rx="8" ry="8.5" fill="white"/>
        <g className="classy-avatar-gaze">
          <ellipse cx="21" cy="33" rx="4.5" ry="5.5" fill="#30203e"/>
          <ellipse cx="45" cy="33" rx="4.5" ry="5.5" fill="#30203e"/>
          <circle cx="23" cy="30" r="2" fill="white"/>
          <circle cx="47" cy="30" r="2" fill="white"/>
        </g>
      </g>
      <path d="M13 27q7-5 13 0M40 27q7-5 13 0" fill="none" stroke="var(--brand-red)" strokeWidth="2" strokeLinecap="round"/>
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
  const [menu, setMenu] = useState<ContextMenu>(null);
  const [references, setReferences] = useState<ClassyReference[]>([]);
  const [studyMode, setStudyMode] = useState<StudyMode | undefined>();
  const [target, setTarget] = useState<ClassyTarget | undefined>();
  const [sources, setSources] = useState<{ id: string; type: string; title: string; contentId?: string; transcriptAvailable?: boolean }[]>([]);
  const [generating, setGenerating] = useState<string | null>(null);
  const [dismissedLesson, setDismissedLesson] = useState<string | null>(null);
  const lesson = useClassyLesson();
  const currentLesson = lesson?.path === location.pathname && dismissedLesson !== lesson.id ? lesson : null;
  const actions = menu !== null;
  const setActions = (value: boolean) => setMenu(value ? "main" : null);
  const addReference = useCallback((ref: ClassyReference) => {
    setReferences(previous => {
      if (previous.some(item => item.id === ref.id && item.type === ref.type)) return previous;
      if (previous.length >= 3) { toast.info("Você pode mencionar até 3 itens, além da aula aberta."); return previous; }
      return [...previous, ref];
    });
    setMenu(null);
  }, []);
  const pickTarget = useCallback((picked: ClassyTarget, ref?: ClassyReference) => { setTarget(picked); if (ref) addReference(ref); setMenu(null); }, [addReference]);
  const { selecting, setSelecting, rect } = useClassyTarget(pickTarget, location.pathname);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<StudyMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [savedNotes, setSavedNotes] = useState<Set<string>>(new Set());
  const { status: voiceStatus, toggle: dictate, cancel: cancelDictation } = useClassyDictation(text => setDraft(previous => `${previous} ${text}`.trim()));
  const voiceActive = voiceStatus !== "idle";
  const listening = voiceStatus === "recording";
  const voiceBusy = voiceStatus === "starting" || voiceStatus === "transcribing";
  const input = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const restoredStudy = useRef<string | null>(null);
  const identity = useRef(user?.id);
  identity.current = user?.id;
  const routeStudy = location.pathname === "/c/new" ? undefined : location.pathname.match(/^\/c\/([^/]+)/)?.[1];
  const studyId = routeStudy || selected;
  const hidden = !user || /^\/(auth|onboarding|termos|privacidade|broadcast|admin|studio\/upload)(\/|$)/.test(location.pathname);
  const pageName = location.pathname === "/" ? "Explorar" : location.pathname.startsWith("/watch/") ? "Aula aberta" : location.pathname.startsWith("/listen/") ? "Podcast aberto" : routeStudy ? "Meu estudo" : location.pathname.startsWith("/shorts") ? "Shorts" : "Classfy";

  useEffect(() => { restoredStudy.current = null; setOpen(false); setSelected(""); setDraft(""); setMessages([]); setSavedNotes(new Set()); setReferences([]); setStudyMode(undefined); setTarget(undefined); setSources([]); cancelDictation(); }, [user?.id, cancelDictation]);
  useEffect(() => { if (!selected && activeStudies.length) setSelected(activeStudies[0].id); }, [activeStudies, selected]);
  useEffect(() => {
    if (!open || !studyId || !user?.id) return;
    let cancelled = false;
    const load = async () => {
      setHistoryLoading(true);
      const { data, error } = await supabase.from("study_messages").select("*").eq("study_id", studyId).order("created_at", { ascending: false }).limit(60);
      if (!cancelled) { if (error) toast.error("Não foi possível carregar a conversa."); else {
        const history = (data || []).reverse() as StudyMessage[];
        setMessages(history);
        const metadata = [...history].reverse().find(item => item.role === "assistant")?.metadata;
        setSources(metadata?.context_sources || []);
        if (restoredStudy.current !== studyId) {
          restoredStudy.current = studyId;
          const saved = (metadata?.context_sources || []).filter((source: ClassyReference) => ["content", "lesson", "creator", "study"].includes(source.type));
          setReferences(previous => previous.length ? previous : saved.slice(0, 3));
          setStudyMode(previous => previous || (studyModes.some(mode => mode.id === metadata?.study_mode) ? metadata?.study_mode : undefined));
        }
      } setHistoryLoading(false); }
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
  useEffect(() => { if (hidden) { setSelecting(false); cancelDictation(); setOpen(false); setActions(false); } }, [hidden, setSelecting, cancelDictation]);

  async function newStudy() {
    if (!canCreateMore) { toast.error("Você atingiu o limite de estudos do seu plano."); return; }
    navigate("/c/new"); setOpen(false);
  }
  async function send(text = draft) {
    if (!text.trim() || busy || historyLoading || voiceStatus !== "idle" || !user) return;
    setOpen(true); setActions(false);
    if (!studyId) { toast.info("Crie um estudo para começar sua conversa com a Classy."); return; }
    const requestUser = user.id;
    const requestStudy = studyId;
    setBusy(true); setDraft("");
    try {
      // Only public page identity is shared, never form values or the complete DOM.
      const heading = document.querySelector("main h1")?.textContent?.trim().slice(0, 180) || pageName;
      const media = document.querySelector<HTMLMediaElement>("video, audio");
      const pageContext = `${pageName}: ${heading}${media ? `; reprodução em ${Math.floor(media.currentTime)}s` : player.isVisible ? `; miniplayer: ${player.content?.title}, ${Math.floor(player.currentTime)}s` : ""}`;
      const allReferences = [...(currentLesson ? [currentLesson] : []), ...references].filter((ref, index, list) => list.findIndex(item => item.id === ref.id && item.type === ref.type) === index);
      const activeContentId = allReferences.find(ref => ref.type === "content")?.id;
      const { data, error } = await supabase.functions.invoke("classy-chat", { body: { studyId: requestStudy, message: text.trim(), pageContext, references: allReferences.map(({ id, type }) => ({ id, type })), studyMode, target, activeContentId, currentVideoTime: currentLesson ? media?.currentTime : undefined } });
      if (identity.current !== requestUser) return;
      if (data?.contextPending) { setSources(data.contextSources || []); setDraft(text); toast.info(data.message); return; }
      if (data?.limitReached) { toast.info(data.message || "Limite de mensagens deste estudo atingido."); setDraft(text); return; }
      if (error || data?.error) {
        const payload = error?.context instanceof Response ? await error.context.json().catch(() => null) : data;
        throw new Error(payload?.message || "Não foi possível falar com a Classy. Tente novamente.");
      }
      setSources(data?.contextSources || []);
      window.dispatchEvent(new CustomEvent("classfy:study-chat-updated", { detail: { studyId: requestStudy } }));
    } catch (error) { if (identity.current === requestUser) { setDraft(text); toast.error(error instanceof Error ? error.message : "Tente novamente."); } }
    finally { setBusy(false); }
  }
  async function saveNote(message: StudyMessage) {
    if (!user || busy || savedNotes.has(message.id)) return;
    const { error } = await supabase.from("study_notes").insert({ study_id: message.study_id, user_id: user.id, note_text: message.content, content_id: message.metadata?.context_sources?.find((source: { contentId?: string }) => source.contentId)?.contentId || null, timestamp_seconds: null });
    if (error) toast.error("Não foi possível salvar a anotação."); else { setSavedNotes(previous => new Set(previous).add(message.id)); toast.success("Resposta salva nas anotações do estudo."); window.dispatchEvent(new CustomEvent("classfy:study-note-updated", { detail: { studyId: message.study_id } })); }
  }
  async function generateTranscript(source: typeof sources[number]) {
    setGenerating(source.id);
    try {
      const { data, error } = await supabase.functions.invoke("transcribe-content", { body: source.contentId ? { contentId: source.contentId } : { lessonId: source.id } });
      if (error || data?.error) throw new Error("Não foi possível gerar a transcrição agora.");
      if (data?.processing) toast.info(data.message || "Transcrição em processamento. Tente novamente em instantes.");
      else if (data?.transcription?.text) { setSources(previous => previous.map(item => item.id === source.id ? { ...item, transcriptAvailable: true } : item)); toast.success("Transcrição pronta para sua próxima pergunta."); }
      else toast.info("A transcrição ainda não está disponível.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Tente novamente."); }
    finally { setGenerating(null); }
  }
  function updateDraft(value: string) {
    if (/(?:^|\s)@$/.test(value)) { setDraft(value.replace(/@$/, "")); setMenu("mentions"); return; }
    if (/(?:^|\s)\/$/.test(value)) { setDraft(value.replace(/\/$/, "")); setMenu("modes"); return; }
    setDraft(value);
  }
  if (hidden) return null;
  return <div className={`classy-global ${routeStudy ? "classy-global--study" : ""} ${player.isVisible ? "classy-global--player" : ""}`}>
    {open && !voiceActive && <section className="classy-panel" role="dialog" aria-modal="false" aria-label="Assistente Classy">
      <header className="classy-panel-header"><ClassyAvatar/><div><strong>Classy</strong><small>Seu espaço para aprender</small></div><button aria-label="Fechar Classy" onClick={() => setOpen(false)}><X size={19}/></button></header>
      <div className="classy-context"><span>Com você em · {pageName}</span><div><select aria-label="Estudo da conversa" value={studyId} disabled={!!routeStudy || busy || loading} onChange={event => setSelected(event.target.value)}><option value="">Escolha um estudo</option>{activeStudies.map(study => <option key={study.id} value={study.id}>{study.title}</option>)}</select><button aria-label="Abrir estudo" disabled={!studyId} onClick={() => navigate(`/c/${studyId}`)}><ExternalLink size={16}/></button></div></div>
      {sources.length > 0 && <div className="classy-sources" aria-label="Fontes usadas na resposta">{sources.map(source => <div key={`${source.type}:${source.id}`}><span>{source.title} · {source.transcriptAvailable === undefined ? "Contexto conectado" : source.transcriptAvailable ? "Transcrição conectada" : "Sem transcrição"}</span>{source.transcriptAvailable === false && (source.contentId || source.type === "lesson") && <button disabled={!!generating} onClick={() => generateTranscript(source)}>{generating === source.id ? "Preparando…" : "Gerar transcrição"}</button>}</div>)}</div>}
      <div className="classy-messages" aria-busy={busy || historyLoading}>
        {historyLoading ? <p className="classy-empty">Carregando conversa…</p> : messages.length === 0 && <div className="classy-empty"><ClassyAvatar/><h2>Vamos descobrir algo?</h2><p>Escolha um estudo e me conte o que quer entender. Sua conversa e suas anotações ficam juntas.</p><button className="classy-create" disabled={!canCreateMore} onClick={newStudy}><Plus size={16}/> Criar um estudo</button></div>}
        {messages.filter(message => message.role !== "system").map(message => <article key={message.id} className={`classy-message classy-message--${message.role}`}><ChatMessage role={message.role} content={message.content}/>{message.role === "assistant" && <button className="classy-save" disabled={savedNotes.has(message.id)} onClick={() => saveNote(message)}><BookmarkPlus size={14}/> {savedNotes.has(message.id) ? "Anotação salva" : "Salvar anotação"}</button>}</article>)}
        {busy && <p role="status" className="classy-thinking"><Loader2 size={15} className="animate-spin"/> Classy está pensando…</p>}<div ref={bottom}/>
      </div>
      <div className="classy-suggestions">{["Explique com um exemplo", "Me dê um exercício", "O que estudar a seguir?"].map(text => <button key={text} disabled={busy || !studyId} onClick={() => send(text)}>{text}</button>)}</div>
      <p className="classy-context-note">A Classy usa as referências e transcrições disponíveis. Confira informações importantes.</p>
    </section>}
    <ClassyContextTools menu={voiceActive ? null : menu} setMenu={setMenu} onReference={addReference} onMode={mode => { setStudyMode(mode); setMenu(null); input.current?.focus(); }} onTarget={() => { setSelecting(true); setMenu(null); setOpen(false); }} onNewStudy={newStudy}/>
    {selecting && <div className="classy-target-instruction" role="status">Selecione um elemento da página <button onClick={() => setSelecting(false)}>Cancelar · Esc</button></div>}
    {selecting && rect && <div className="classy-target-outline" style={rect}/>}
    {!voiceActive && (currentLesson || references.length > 0 || studyMode || target) && <div className={`classy-attachments ${open ? "classy-attachments--open" : ""}`} aria-label="Contexto da mensagem">
      {currentLesson && <span title={currentLesson.title}>Aula aberta · {currentLesson.title}<button aria-label="Remover aula aberta do contexto" onClick={() => setDismissedLesson(currentLesson.id)}><X size={12}/></button></span>}
      {references.map(ref => <span key={`${ref.type}:${ref.id}`} title={ref.title}>@{ref.title}<button aria-label={`Remover referência ${ref.title}`} onClick={() => setReferences(previous => previous.filter(item => item.id !== ref.id || item.type !== ref.type))}><X size={12}/></button></span>)}
      {studyMode && <span>/{studyModes.find(mode => mode.id === studyMode)?.title}<button aria-label="Remover modo de estudo" onClick={() => setStudyMode(undefined)}><X size={12}/></button></span>}
      {target && <span title={target.text}>Seleção · {target.label}<button aria-label="Remover seleção" onClick={() => setTarget(undefined)}><X size={12}/></button></span>}
    </div>}
    <form className={`classy-bar ${open ? "classy-bar--open" : ""} ${voiceActive ? "classy-bar--voice" : ""}`} onSubmit={event => { event.preventDefault(); void send(); }}>
      {voiceActive ? <>
        <button type="button" aria-label="Cancelar ditado" onClick={cancelDictation}><X size={18}/></button>
        <div className="classy-voice-content" role="status">
          {listening ? <AudioLines size={20} className="classy-voice-wave"/> : <Loader2 size={18} className="animate-spin"/>}
          <span>{listening ? "Gravando…" : voiceStatus === "starting" ? "Abrindo microfone…" : "Transcrevendo…"}</span>
        </div>
        {listening && <button type="button" aria-label="Parar ditado" className="classy-listening" onClick={dictate}><Square size={17} fill="currentColor"/></button>}
      </> : <>
      <button type="button" aria-label="Conversar com a Classy" onClick={() => setOpen(!open)}><ClassyAvatar/></button>
      <input ref={input} aria-label="Mensagem para Classy" placeholder="Aprender com a Classy" value={draft} maxLength={4000} onChange={event => updateDraft(event.target.value)}/>
      <button type="button" aria-label="Ações da Classy" aria-expanded={actions} onClick={() => setActions(!actions)}>{actions ? <X size={18}/> : <Plus size={20}/>}</button>
      <button type="button" aria-label={listening ? "Parar ditado" : voiceStatus === "transcribing" ? "Transcrevendo áudio" : voiceStatus === "starting" ? "Abrindo microfone" : "Ditar mensagem"} disabled={voiceBusy || busy} aria-pressed={listening} className={listening ? "classy-listening" : ""} onClick={() => { setMenu(null); void dictate(); }}>{voiceBusy ? <Loader2 size={19} className="animate-spin"/> : <AudioLines size={19}/>}</button>
      {draft.trim() ? <button type="submit" aria-label="Enviar mensagem" disabled={busy || voiceBusy || listening}><ArrowUp size={20}/></button> : <button type="button" aria-label={open ? "Recolher painel" : "Abrir painel"} aria-expanded={open} onClick={() => setOpen(!open)}><PanelRight size={19}/></button>}
      </>}
    </form>
  </div>;
}
