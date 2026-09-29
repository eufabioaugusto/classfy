import { useEffect, useState } from "react";
import { ArrowLeft, AtSign, Crosshair, Plus, Search, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { ClassyReference } from "./classyPageContext";
import { studyModes, type StudyMode, type ContextMenu } from "./classyModes";
const typeNames = { content: "Aula / conteúdo", lesson: "Aula de curso", creator: "Creator", study: "Estudo" };
export function ClassyContextTools({ menu, setMenu, onReference, onMode, onTarget, onNewStudy }: { menu: ContextMenu; setMenu: (value: ContextMenu) => void; onReference: (ref: ClassyReference) => void; onMode: (mode: StudyMode) => void; onTarget: () => void; onNewStudy: () => void }) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClassyReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (menu !== "mentions" || !user) return;
    let cancelled = false;
    setLoading(true); setFailed(false);
    const timer = window.setTimeout(async () => {
      const pattern = `%${query.replace(/[%_\\]/g, "").trim().slice(0, 80)}%`;
      const responses = await Promise.all([
        supabase.from("contents").select("id,title").eq("status", "approved").not("content_type", "in", "(course,curso)").ilike("title", pattern).limit(7),
        supabase.from("profiles").select("id,display_name").eq("creator_status", "approved").ilike("display_name", pattern).limit(5),
        supabase.from("studies").select("id,title").eq("user_id", user.id).eq("status", "active").ilike("title", pattern).limit(5),
        supabase.from("course_lessons").select("id,title,course:courses!inner(status)").eq("course.status", "approved").ilike("title", pattern).limit(5),
      ]);
      if (cancelled) return;
      setFailed(responses.some(response => response.error));
      const items: ClassyReference[] = [];
      responses.forEach((response, index) => { const type = (["content", "creator", "study", "lesson"] as const)[index]; for (const item of response.data || []) items.push({ type, id: item.id, title: "display_name" in item ? item.display_name : "title" in item ? item.title : "" }); });
      setResults(items); setLoading(false);
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [menu, query, user]);
  if (!menu) return null;
  return <section className="classy-tools" aria-label="Recursos da Classy">
    {menu !== "main" && <header><button aria-label="Voltar aos recursos" onClick={() => setMenu("main")}><ArrowLeft size={16}/></button><strong>{menu === "mentions" ? "Mencionar" : "Modos de estudo"}</strong></header>}
    {menu === "main" ? <><button onClick={() => setMenu("mentions")}><AtSign size={18}/><span>Mencionar</span><kbd>@</kbd></button><button onClick={() => setMenu("modes")}><Sparkles size={18}/><span>Modos de estudo</span><kbd>/</kbd></button><button onClick={onTarget}><Crosshair size={18}/><span>Selecionar na tela</span></button><hr/><button onClick={onNewStudy}><Plus size={18}/>Novo estudo</button></> : menu === "modes" ? studyModes.map(mode => <button key={mode.id} onClick={() => onMode(mode.id)}><Sparkles size={18}/><div><strong>{mode.title}</strong><small>{mode.description}</small></div></button>) : <><label className="classy-mention-search"><Search size={16}/><input autoFocus aria-label="Buscar aulas, creators e estudos" placeholder="Aulas, creators, estudos…" value={query} onChange={event => setQuery(event.target.value)}/></label><div className="classy-mention-results">{loading ? <p role="status">Buscando…</p> : results.map(ref => <button key={`${ref.type}:${ref.id}`} onClick={() => onReference(ref)}><AtSign size={15}/><div><strong>{ref.title}</strong><small>{typeNames[ref.type]}</small></div></button>)}{!loading && !results.length && <p>{failed ? "Não foi possível buscar. Tente novamente." : "Nenhum resultado encontrado."}</p>}</div><p className="classy-tools-hint">O acesso às aulas é conferido antes de usar a transcrição.</p></>}
  </section>;
}
