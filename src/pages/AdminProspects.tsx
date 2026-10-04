import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AdminLayout } from "@/components/AdminLayout";
import { GlobalLoader } from "@/components/GlobalLoader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { dedupeImportRows, escapeCsvCell, parseProspectCsv, ProspectImportRow, validateReadyCandidate } from "@/lib/prospecting";
import { CheckCircle, Copy, Download, ExternalLink, FileEdit, RefreshCw, Search, ShieldX, Upload } from "lucide-react";

type Prospect = {
  id: string;
  channel_name: string;
  channel_url: string | null;
  channel_id: string | null;
  subscriber_count: number | null;
  niche: string | null;
  size_tier: string | null;
  score: number | null;
  contact_email: string | null;
  instagram_handle: string | null;
  status: string;
  created_at: string;
  source_url: string | null;
  source_label: string | null;
  researched_at: string | null;
  research_summary: string | null;
  fit_reason: string | null;
  teaching_topics: string[] | null;
  qualification_score: number | null;
  qualification_notes: string | null;
  email_subject_draft: string | null;
  email_body_draft: string | null;
  dm_draft: string | null;
  ready_for_outreach: boolean;
  do_not_contact: boolean;
};

type ProspectEvent = {
  id: string;
  channel: "email" | "instagram" | "other";
  event_type: "prepared" | "copied" | "opened" | "sent" | "replied" | "note";
  note: string | null;
  occurred_at: string;
};

const TIERS: Record<string, string> = {
  micro: "Micro", pequeno: "Pequeno", medio: "Médio", grande: "Grande", bigplayer: "BigPlayer",
};

export default function AdminProspects() {
  const { user, role, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [editing, setEditing] = useState<Prospect | null>(null);
  const [events, setEvents] = useState<ProspectEvent[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ProspectImportRow[]>([]);
  const [importRejected, setImportRejected] = useState<Array<{ row: ProspectImportRow; reason: string }>>([]);

  const fetchProspects = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("prospects")
      .select("*")
      .order("qualification_score", { ascending: false, nullsFirst: false })
      .order("score", { ascending: false, nullsFirst: false });
    if (error) toast({ title: "Erro ao carregar prospects", description: error.message, variant: "destructive" });
    setProspects((data as Prospect[]) || []);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    if (user && role === "admin") void fetchProspects();
  }, [user, role, fetchProspects]);

  const filtered = useMemo(() => prospects.filter((prospect) => {
    const needle = search.toLowerCase();
    const matchesSearch = !needle || [prospect.channel_name, prospect.niche, prospect.contact_email, prospect.instagram_handle]
      .some((value) => value?.toLowerCase().includes(needle));
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "ready" && prospect.ready_for_outreach && !prospect.do_not_contact)
      || (statusFilter === "research" && !prospect.ready_for_outreach && !prospect.do_not_contact)
      || (statusFilter === "blocked" && prospect.do_not_contact)
      || prospect.status === statusFilter;
    return matchesSearch && matchesStatus && (tierFilter === "all" || prospect.size_tier === tierFilter);
  }), [prospects, search, statusFilter, tierFilter]);

  const openEditor = async (prospect: Prospect) => {
    setEditing({ ...prospect, teaching_topics: prospect.teaching_topics || [] });
    const { data } = await (supabase as any)
      .from("prospect_outreach_events")
      .select("id, channel, event_type, note, occurred_at")
      .eq("prospect_id", prospect.id)
      .order("occurred_at", { ascending: false });
    setEvents((data as ProspectEvent[]) || []);
  };

  const saveProspect = async () => {
    if (!editing) return;
    if (editing.ready_for_outreach) {
      const missing = validateReadyCandidate(editing);
      if (missing.length) {
        toast({
          title: "Pesquisa incompleta",
          description: `Revise: ${missing.join(", ")}.`,
          variant: "destructive",
        });
        return;
      }
    }
    setSaving(true);
    const payload = {
      source_url: editing.source_url || null,
      source_label: editing.source_label || null,
      researched_at: editing.researched_at || null,
      research_summary: editing.research_summary || null,
      fit_reason: editing.fit_reason || null,
      teaching_topics: editing.teaching_topics || [],
      qualification_score: editing.qualification_score,
      qualification_notes: editing.qualification_notes || null,
      email_subject_draft: editing.email_subject_draft || null,
      email_body_draft: editing.email_body_draft || null,
      dm_draft: editing.dm_draft || null,
      ready_for_outreach: editing.ready_for_outreach,
      do_not_contact: editing.do_not_contact,
      status: editing.do_not_contact ? "do_not_contact" : editing.status === "do_not_contact" ? "pending" : editing.status,
      updated_at: new Date().toISOString(),
    };
    const { error } = await (supabase as any).from("prospects").update(payload).eq("id", editing.id);
    if (error) toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    else {
      if (editing.ready_for_outreach) {
        const channel: ProspectEvent["channel"] = editing.contact_email ? "email" : editing.instagram_handle ? "instagram" : "other";
        await logEvent(editing, channel, "prepared", "Pesquisa e rascunho revisados; pronto para abordagem manual");
      }
      toast({ title: "Pesquisa e rascunhos salvos" });
      setEditing(null);
      await fetchProspects();
    }
    setSaving(false);
  };

  const logEvent = async (prospect: Prospect, channel: ProspectEvent["channel"], eventType: ProspectEvent["event_type"], note?: string) => {
    const { error } = await (supabase as any).rpc("record_manual_prospect_event", {
      p_prospect_id: prospect.id, p_channel: channel, p_event_type: eventType, p_note: note || null,
    });
    if (error) throw error;
  };

  const copyDraft = async (prospect: Prospect, channel: "email" | "instagram") => {
    const text = channel === "email"
      ? [prospect.email_subject_draft, prospect.email_body_draft].filter(Boolean).join("\n\n")
      : prospect.dm_draft || "";
    if (!text) return toast({ title: "Rascunho vazio", description: "Prepare e salve o texto antes de copiar.", variant: "destructive" });
    await navigator.clipboard.writeText(text);
    await logEvent(prospect, channel, "copied");
    toast({ title: "Rascunho copiado", description: "Nenhuma mensagem foi enviada." });
  };

  const openContact = async (prospect: Prospect, channel: "email" | "instagram") => {
    const url = channel === "email"
      ? `mailto:${prospect.contact_email || ""}`
      : `https://ig.me/m/${prospect.instagram_handle || ""}`;
    await logEvent(prospect, channel, "opened");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const markSent = async (prospect: Prospect, channel: "email" | "instagram") => {
    try {
      await logEvent(prospect, channel, "sent", "Marcado manualmente pelo operador");
      await fetchProspects();
    } catch (error) {
      toast({ title: "Não foi possível registrar o envio", description: error instanceof Error ? error.message : "Erro desconhecido", variant: "destructive" });
    }
  };

  const exportCsv = () => {
    const headings = ["canal", "url_canal", "tier", "score_qualificacao", "topicos", "fonte", "url_fonte", "pesquisado_em", "motivo_fit", "status", "pronto", "nao_contatar"];
    const rows = filtered.map((p) => [p.channel_name, p.channel_url, p.size_tier, p.qualification_score, (p.teaching_topics || []).join(" | "), p.source_label, p.source_url, p.researched_at, p.fit_reason, p.status, p.ready_for_outreach, p.do_not_contact]);
    const csv = [headings, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `classfy-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const reviewCsv = async (file: File) => {
    const parsed = parseProspectCsv(await file.text());
    const result = dedupeImportRows(parsed, prospects);
    setImportRows(result.accepted);
    setImportRejected(result.rejected);
  };

  const confirmImport = async () => {
    if (!importRows.length) return;
    setSaving(true);
    const payload = importRows.map((row) => ({
      channel_name: row.channel_name,
      channel_id: row.channel_id || null,
      channel_url: row.channel_url || null,
      source_url: row.source_url,
      source_label: row.source_label || "Importação CSV revisada",
      researched_at: new Date().toISOString(),
      niche: row.niche || null,
      instagram_handle: row.instagram_handle || null,
      contact_email: row.contact_email || null,
      research_summary: row.research_summary || null,
      fit_reason: row.fit_reason || null,
      teaching_topics: row.teaching_topics || [],
      status: "pending",
      ready_for_outreach: false,
      do_not_contact: false,
    }));
    const { error } = await (supabase as any).from("prospects").insert(payload);
    if (error) toast({ title: "Importação não concluída", description: error.message, variant: "destructive" });
    else {
      toast({ title: `${payload.length} candidatos importados para pesquisa` });
      setImportOpen(false); setImportRows([]); setImportRejected([]); await fetchProspects();
    }
    setSaving(false);
  };

  if (authLoading) return <GlobalLoader />;
  if (!user || role !== "admin") return <Navigate to="/" />;

  const stats = {
    total: prospects.length,
    research: prospects.filter((p) => !p.ready_for_outreach && !p.do_not_contact).length,
    ready: prospects.filter((p) => p.ready_for_outreach && !p.do_not_contact).length,
    contacted: prospects.filter((p) => ["contacted", "dm_sent"].includes(p.status)).length,
    replied: prospects.filter((p) => p.status === "replied").length,
    blocked: prospects.filter((p) => p.do_not_contact).length,
  };

  return (
    <AdminLayout title="Prospecção de Creators">
      <div className="p-6 space-y-5">
        <Card className="p-4 border-blue-500/20 bg-blue-500/5 text-sm">
          <strong>Fluxo manual:</strong> pesquise, qualifique e prepare rascunhos aqui. Copiar ou abrir um contato nunca envia nem marca como enviado.
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {Object.entries(stats).map(([label, value]) => <Card className="p-3 text-center" key={label}><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground capitalize">{label}</div></Card>)}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar canal, tema ou contato..." /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todos os estados</SelectItem><SelectItem value="research">Em pesquisa</SelectItem><SelectItem value="ready">Prontos</SelectItem><SelectItem value="contacted">E-mail enviado</SelectItem><SelectItem value="dm_sent">DM enviada</SelectItem><SelectItem value="replied">Responderam</SelectItem><SelectItem value="blocked">Não contatar</SelectItem>
          </SelectContent></Select>
          <Select value={tierFilter} onValueChange={setTierFilter}><SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os portes</SelectItem>{Object.entries(TIERS).map(([key, value]) => <SelectItem key={key} value={key}>{value}</SelectItem>)}</SelectContent></Select>
          <Button variant="outline" size="icon" onClick={fetchProspects}><RefreshCw className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2"><Upload className="w-4 h-4" /> Importar CSV</Button>
          <Button variant="outline" onClick={exportCsv} className="gap-2"><Download className="w-4 h-4" /> Exportar CSV</Button>
        </div>

        <Card className="overflow-x-auto">
          {loading ? <div className="p-12 text-center text-muted-foreground">Carregando...</div> : <table className="w-full text-sm">
            <thead className="border-b bg-muted/30"><tr><th className="text-left p-3">Creator</th><th className="text-left p-3">Qualificação</th><th className="text-left p-3">Pesquisa</th><th className="text-left p-3">Estado</th><th className="text-right p-3">Ações manuais</th></tr></thead>
            <tbody>{filtered.map((p) => <tr key={p.id} className="border-b last:border-0">
              <td className="p-3"><div className="font-medium">{p.channel_name}</div><div className="text-xs text-muted-foreground">{TIERS[p.size_tier || ""] || "Sem porte"} · {p.subscriber_count?.toLocaleString("pt-BR") || "—"} inscritos</div></td>
              <td className="p-3"><div className="font-medium">{p.qualification_score ?? "—"}/100</div><div className="text-xs text-muted-foreground max-w-[240px] truncate">{(p.teaching_topics || []).join(", ") || "Tópicos não pesquisados"}</div></td>
              <td className="p-3"><div className="max-w-[260px] truncate">{p.fit_reason || "Sem motivo de fit registrado"}</div>{p.source_url && <a className="text-xs text-blue-400 inline-flex gap-1" href={p.source_url} target="_blank" rel="noreferrer">{p.source_label || "Fonte"}<ExternalLink className="w-3 h-3" /></a>}</td>
              <td className="p-3">{p.do_not_contact ? <Badge variant="destructive">Não contatar</Badge> : p.ready_for_outreach ? <Badge className="bg-emerald-600">Pronto</Badge> : <Badge variant="secondary">Em pesquisa</Badge>}</td>
              <td className="p-3"><div className="flex justify-end gap-1 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => openEditor(p)}><FileEdit className="w-3 h-3 mr-1" />Preparar</Button>
                {p.ready_for_outreach && !p.do_not_contact && p.contact_email && <><Button size="sm" variant="outline" onClick={() => copyDraft(p, "email")}><Copy className="w-3 h-3 mr-1" />E-mail</Button><Button size="sm" variant="ghost" onClick={() => openContact(p, "email")}><ExternalLink className="w-3 h-3" /></Button><Button size="sm" variant="ghost" onClick={() => markSent(p, "email")}><CheckCircle className="w-3 h-3 mr-1" />Marcar enviado</Button></>}
                {p.ready_for_outreach && !p.do_not_contact && p.instagram_handle && <><Button size="sm" variant="outline" onClick={() => copyDraft(p, "instagram")}><Copy className="w-3 h-3 mr-1" />DM</Button><Button size="sm" variant="ghost" onClick={() => openContact(p, "instagram")}><ExternalLink className="w-3 h-3" /></Button><Button size="sm" variant="ghost" onClick={() => markSent(p, "instagram")}><CheckCircle className="w-3 h-3 mr-1" />Marcar enviado</Button></>}
              </div></td>
            </tr>)}</tbody>
          </table>}
        </Card>
        <p className="text-xs text-center text-muted-foreground">{filtered.length} de {prospects.length} prospects · captação externa não configurada neste repositório</p>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Preparar prospect — {editing?.channel_name}</DialogTitle></DialogHeader>
          {editing && <div className="space-y-5">
            <section className="grid md:grid-cols-2 gap-3">
              <Field label="Nome da fonte"><Input value={editing.source_label || ""} onChange={(e) => setEditing({ ...editing, source_label: e.target.value })} placeholder="Ex.: canal oficial / vídeo analisado" /></Field>
              <Field label="URL da fonte"><Input value={editing.source_url || ""} onChange={(e) => setEditing({ ...editing, source_url: e.target.value })} placeholder="https://..." /></Field>
              <Field label="Data da pesquisa"><Input type="datetime-local" value={editing.researched_at?.slice(0, 16) || ""} onChange={(e) => setEditing({ ...editing, researched_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
              <Field label="Score de qualificação (0–100)"><Input type="number" min={0} max={100} value={editing.qualification_score ?? ""} onChange={(e) => setEditing({ ...editing, qualification_score: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              <Field label="O que ensina" className="md:col-span-2"><Input value={(editing.teaching_topics || []).join(", ")} onChange={(e) => setEditing({ ...editing, teaching_topics: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} placeholder="programação, carreira, inglês..." /></Field>
              <Field label="Resumo da pesquisa" className="md:col-span-2"><Textarea value={editing.research_summary || ""} onChange={(e) => setEditing({ ...editing, research_summary: e.target.value })} placeholder="Somente fatos observados, com fonte acima." /></Field>
              <Field label="Motivo de adequação à Classfy" className="md:col-span-2"><Textarea value={editing.fit_reason || ""} onChange={(e) => setEditing({ ...editing, fit_reason: e.target.value })} /></Field>
              <Field label="Notas de qualificação" className="md:col-span-2"><Textarea value={editing.qualification_notes || ""} onChange={(e) => setEditing({ ...editing, qualification_notes: e.target.value })} /></Field>
            </section>
            <section className="space-y-3"><h3 className="font-semibold">Rascunhos editáveis</h3>
              <Field label="Assunto do e-mail"><Input value={editing.email_subject_draft || ""} onChange={(e) => setEditing({ ...editing, email_subject_draft: e.target.value })} /></Field>
              <Field label="Corpo do e-mail"><Textarea rows={7} value={editing.email_body_draft || ""} onChange={(e) => setEditing({ ...editing, email_body_draft: e.target.value })} /></Field>
              <Field label="Direct do Instagram"><Textarea rows={5} value={editing.dm_draft || ""} onChange={(e) => setEditing({ ...editing, dm_draft: e.target.value })} /></Field>
            </section>
            <div className="flex flex-wrap gap-2">
              <Button variant={editing.ready_for_outreach ? "default" : "outline"} onClick={() => setEditing({ ...editing, ready_for_outreach: !editing.ready_for_outreach })}><CheckCircle className="w-4 h-4 mr-2" />{editing.ready_for_outreach ? "Pronto para abordagem" : "Marcar como pronto"}</Button>
              <Button variant={editing.do_not_contact ? "destructive" : "outline"} onClick={() => setEditing({ ...editing, do_not_contact: !editing.do_not_contact, ready_for_outreach: editing.do_not_contact ? editing.ready_for_outreach : false })}><ShieldX className="w-4 h-4 mr-2" />Não contatar</Button>
            </div>
            <section><h3 className="font-semibold mb-2">Histórico manual</h3>{events.length ? <div className="space-y-1 text-sm">{events.map((event) => <div key={event.id} className="border rounded p-2"><strong>{event.channel}</strong> · {event.event_type} · {new Date(event.occurred_at).toLocaleString("pt-BR")}{event.note && <div className="text-muted-foreground">{event.note}</div>}</div>)}</div> : <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>}</section>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={saveProspect} disabled={saving}>{saving ? "Salvando..." : "Salvar preparação"}</Button></div>
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Importar candidatos para revisão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Colunas: channel_name, channel_id ou channel_url, source_url; opcionais: source_label, niche, instagram_handle, contact_email, research_summary, fit_reason e teaching_topics separados por |. Nada é marcado como pronto ou enviado.</p>
          <Input type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && void reviewCsv(event.target.files[0])} />
          {(importRows.length > 0 || importRejected.length > 0) && <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3"><Card className="p-3"><strong>{importRows.length}</strong> novos para importar</Card><Card className="p-3"><strong>{importRejected.length}</strong> rejeitados/duplicados</Card></div>
            <div className="max-h-48 overflow-y-auto text-sm border rounded p-2">{importRows.map((row) => <div key={`${row.channel_id}-${row.channel_url}`} className="py-1">✓ {row.channel_name} — {row.source_url}</div>)}{importRejected.map(({ row, reason }, index) => <div key={index} className="py-1 text-destructive">× {row.channel_name || "Linha sem nome"}: {reason}</div>)}</div>
          </div>}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button><Button disabled={!importRows.length || saving} onClick={confirmImport}>{saving ? "Importando..." : `Importar ${importRows.length} revisados`}</Button></div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div className={`space-y-1 ${className}`}><Label>{label}</Label>{children}</div>;
}
