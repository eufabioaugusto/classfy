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
import { buildDiscoveryCommitBody, buildDiscoveryPreviewBody, DiscoveryCriteria } from "@/lib/prospectDiscovery";
import { assessProspectPriority, matchesProspectDisplay, PROSPECT_PRIORITY_ORDER, ProspectDisplayFilter } from "@/lib/prospectPriority";
import { cn } from "@/lib/utils";
import { AlertTriangle, Archive, CheckCircle, Copy, Download, ExternalLink, FileEdit, RefreshCw, Search, ShieldX, Sparkles, Star, Upload } from "lucide-react";

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

type DiscoveryCandidate = Pick<Prospect,
  "channel_id" | "channel_name" | "channel_url" | "subscriber_count" | "niche" | "size_tier" |
  "source_url" | "source_label" | "contact_email" | "instagram_handle" | "research_summary" |
  "fit_reason" | "qualification_score" | "ready_for_outreach"
> & {
  discovery_published_at?: string | null;
  discovery_query?: string;
  discovery_reason?: string;
};

const DISCOVERY_QUERIES = [
  "programação curso prático português brasil",
  "inglês para trabalho aula português brasil",
  "finanças pessoais aula prática brasil",
];

const TIERS: Record<string, string> = {
  micro: "Micro", pequeno: "Pequeno", medio: "Médio", grande: "Grande", bigplayer: "BigPlayer",
};

const DISPLAY_FILTERS: Array<{ value: ProspectDisplayFilter; label: string }> = [
  { value: "active", label: "Trabalho ativo" },
  { value: "priority", label: "Prioritários" },
  { value: "attention", label: "Precisam de atenção" },
  { value: "no_contact", label: "Sem contato" },
  { value: "all", label: "Todos" },
];

export default function AdminProspects() {
  const { user, role, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [displayFilter, setDisplayFilter] = useState<ProspectDisplayFilter>("active");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [editing, setEditing] = useState<Prospect | null>(null);
  const [events, setEvents] = useState<ProspectEvent[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ProspectImportRow[]>([]);
  const [importRejected, setImportRejected] = useState<Array<{ row: ProspectImportRow; reason: string }>>([]);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoverySettingsOpen, setDiscoverySettingsOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryCandidates, setDiscoveryCandidates] = useState<DiscoveryCandidate[]>([]);
  const [discoveryQueryText, setDiscoveryQueryText] = useState(DISCOVERY_QUERIES.join("\n"));
  const [discoveryRecentMonths, setDiscoveryRecentMonths] = useState("6");
  const [discoveryCriteria, setDiscoveryCriteria] = useState<DiscoveryCriteria | null>(null);

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

  const assessedProspects = useMemo(() => prospects.map((prospect) => ({
    prospect,
    assessment: assessProspectPriority(prospect),
  })), [prospects]);

  const priorityCounts = useMemo(() => assessedProspects.reduce((counts, item) => {
    counts[item.assessment.priority] += 1;
    return counts;
  }, { priority: 0, attention: 0, no_contact: 0 }), [assessedProspects]);

  const filtered = useMemo(() => assessedProspects.filter(({ prospect, assessment }) => {
    const needle = search.toLowerCase();
    const matchesSearch = !needle || [prospect.channel_name, prospect.niche, prospect.contact_email, prospect.instagram_handle]
      .some((value) => value?.toLowerCase().includes(needle));
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "ready" && prospect.ready_for_outreach && !prospect.do_not_contact)
      || (statusFilter === "research" && !prospect.ready_for_outreach && !prospect.do_not_contact)
      || (statusFilter === "blocked" && prospect.do_not_contact)
      || prospect.status === statusFilter;
    const matchesDisplay = matchesProspectDisplay(prospect, assessment, displayFilter);
    return matchesSearch && matchesStatus && matchesDisplay && (tierFilter === "all" || prospect.size_tier === tierFilter);
  }).sort((a, b) => {
    const priorityDifference = PROSPECT_PRIORITY_ORDER[a.assessment.priority] - PROSPECT_PRIORITY_ORDER[b.assessment.priority];
    if (priorityDifference) return priorityDifference;
    if (a.assessment.needsReviewEmphasis !== b.assessment.needsReviewEmphasis) return a.assessment.needsReviewEmphasis ? -1 : 1;
    return a.prospect.channel_name.localeCompare(b.prospect.channel_name, "pt-BR");
  }).map(({ prospect }) => prospect), [assessedProspects, displayFilter, search, statusFilter, tierFilter]);

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
      contact_email: editing.contact_email?.trim() || null,
      instagram_handle: editing.instagram_handle?.trim().replace(/^@/, "") || null,
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

  const runDiscoveryPreview = async () => {
    const body = buildDiscoveryPreviewBody(discoveryQueryText, discoveryRecentMonths);
    if (!body) {
      toast({ title: "Informe pelo menos um termo de busca", description: "Use uma linha por categoria ou intenção de ensino.", variant: "destructive" });
      return;
    }
    setDiscovering(true);
    const { data, error } = await supabase.functions.invoke("run-prospector", {
      body,
    });
    setDiscovering(false);
    if (error || !data?.success) {
      toast({ title: "Não foi possível buscar creators", description: error?.message || data?.error, variant: "destructive" });
      return;
    }
    setDiscoveryCandidates(data.candidates || []);
    setDiscoveryCriteria(data.criteria || null);
    setDiscoverySettingsOpen(false);
    setDiscoveryOpen(true);
  };

  const confirmDiscovery = async () => {
    if (!discoveryCandidates.length) return;
    setDiscovering(true);
    const { data, error } = await supabase.functions.invoke("run-prospector", {
      body: buildDiscoveryCommitBody(discoveryCandidates, discoveryCriteria),
    });
    setDiscovering(false);
    if (error || !data?.success) {
      toast({ title: "Não foi possível adicionar os candidatos", description: error?.message || data?.error, variant: "destructive" });
      return;
    }
    toast({ title: `${data.inserted?.length || 0} creators adicionados em pesquisa` });
    setDiscoveryOpen(false);
    setDiscoveryCandidates([]);
    await fetchProspects();
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
          <Button variant="outline" onClick={() => setDiscoverySettingsOpen(true)} disabled={discovering} className="gap-2"><Sparkles className="w-4 h-4" />{discovering ? "Buscando..." : "Buscar no YouTube"}</Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2"><Upload className="w-4 h-4" /> Importar CSV</Button>
          <Button variant="outline" onClick={exportCsv} className="gap-2"><Download className="w-4 h-4" /> Exportar CSV</Button>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Exibição por prioridade">
            {DISPLAY_FILTERS.map((option) => {
              const count = option.value === "all" ? prospects.length
                : option.value === "active" ? priorityCounts.priority + priorityCounts.attention
                : priorityCounts[option.value];
              return <Button
                key={option.value}
                size="sm"
                variant={displayFilter === option.value ? "default" : "outline"}
                onClick={() => setDisplayFilter(option.value)}
                aria-pressed={displayFilter === option.value}
                className="gap-2"
              >
                {option.value === "priority" && <Star className="w-3.5 h-3.5" />}
                {option.value === "attention" && <AlertTriangle className="w-3.5 h-3.5" />}
                {option.value === "no_contact" && <Archive className="w-3.5 h-3.5" />}
                {option.label} <span className="rounded-full bg-background/20 px-1.5 text-xs">{count}</span>
              </Button>;
            })}
          </div>
          <p className="text-xs text-muted-foreground">A visão padrão oculta quem não tem contato, sem apagar. “Pronto para revisão” indica contato, pesquisa e rascunho disponíveis; ainda não significa envio ou aprovação.</p>
        </div>

        <Card className="overflow-x-auto">
          {loading ? <div className="p-12 text-center text-muted-foreground">Carregando...</div> : filtered.length ? <table className="w-full text-sm">
            <thead className="border-b bg-muted/30"><tr><th className="text-left p-3">Creator</th><th className="text-left p-3">Prioridade</th><th className="text-left p-3">Contato e rascunho</th><th className="text-left p-3 hidden lg:table-cell">Qualificação</th><th className="text-left p-3 hidden md:table-cell">Pesquisa</th><th className="text-left p-3">Estado</th><th className="text-right p-3">Ações manuais</th></tr></thead>
            <tbody>{filtered.map((p) => {
              const assessment = assessProspectPriority(p);
              return <tr key={p.id} className={cn("border-b last:border-0", assessment.needsReviewEmphasis && "bg-primary/[0.045]")}>
              <td className="p-3"><div className={cn(assessment.needsReviewEmphasis ? "font-bold" : "font-medium")}>{p.channel_name}{assessment.needsReviewEmphasis && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-primary" aria-label="Aguardando revisão de preparação" />}</div><div className="text-xs text-muted-foreground">{TIERS[p.size_tier || ""] || "Sem porte"} · {p.subscriber_count?.toLocaleString("pt-BR") || "—"} inscritos</div></td>
              <td className="p-3"><PriorityBadge assessment={assessment} /></td>
              <td className="p-3"><ContactSummary prospect={p} /></td>
              <td className="p-3 hidden lg:table-cell"><div className="font-medium">{p.qualification_score ?? "—"}/100</div><div className="text-xs text-muted-foreground max-w-[240px] truncate">{(p.teaching_topics || []).join(", ") || "Tópicos não pesquisados"}</div></td>
              <td className="p-3 hidden md:table-cell"><div className="max-w-[260px] truncate">{p.fit_reason || "Sem motivo de fit registrado"}</div>{p.source_url && <a className="text-xs text-blue-400 inline-flex gap-1" href={p.source_url} target="_blank" rel="noreferrer">{p.source_label || "Fonte"}<ExternalLink className="w-3 h-3" /></a>}</td>
              <td className="p-3">{p.do_not_contact ? <Badge variant="destructive">Não contatar</Badge> : p.ready_for_outreach ? <Badge className="bg-emerald-600">Pronto</Badge> : <Badge variant="secondary">Em pesquisa</Badge>}</td>
              <td className="p-3"><div className="flex justify-end gap-1 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => openEditor(p)}><FileEdit className="w-3 h-3 mr-1" />Preparar</Button>
                {p.ready_for_outreach && !p.do_not_contact && p.contact_email && <><Button size="sm" variant="outline" onClick={() => copyDraft(p, "email")}><Copy className="w-3 h-3 mr-1" />E-mail</Button><Button size="sm" variant="ghost" onClick={() => openContact(p, "email")}><ExternalLink className="w-3 h-3" /></Button><Button size="sm" variant="ghost" onClick={() => markSent(p, "email")}><CheckCircle className="w-3 h-3 mr-1" />Marcar enviado</Button></>}
                {p.ready_for_outreach && !p.do_not_contact && p.instagram_handle && <><Button size="sm" variant="outline" onClick={() => copyDraft(p, "instagram")}><Copy className="w-3 h-3 mr-1" />DM</Button><Button size="sm" variant="ghost" onClick={() => openContact(p, "instagram")}><ExternalLink className="w-3 h-3" /></Button><Button size="sm" variant="ghost" onClick={() => markSent(p, "instagram")}><CheckCircle className="w-3 h-3 mr-1" />Marcar enviado</Button></>}
              </div></td>
            </tr>;})}</tbody>
          </table> : <div className="p-12 text-center"><div className="font-medium">Nenhum prospect nesta visão</div><p className="mt-1 text-sm text-muted-foreground">Ajuste os filtros ou consulte “Todos” para conferir a lista completa.</p></div>}
        </Card>
        <p className="text-xs text-center text-muted-foreground">{filtered.length} de {prospects.length} prospects · {priorityCounts.no_contact} sem contato permanecem recuperáveis · descoberta do YouTube sempre passa por prévia</p>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Preparar prospect — {editing?.channel_name}</DialogTitle></DialogHeader>
          {editing && <div className="space-y-5">
            <section className="grid md:grid-cols-2 gap-3">
              <Field label="Nome da fonte"><Input value={editing.source_label || ""} onChange={(e) => setEditing({ ...editing, source_label: e.target.value })} placeholder="Ex.: canal oficial / vídeo analisado" /></Field>
              <Field label="URL da fonte"><Input value={editing.source_url || ""} onChange={(e) => setEditing({ ...editing, source_url: e.target.value })} placeholder="https://..." /></Field>
              <Field label="E-mail profissional verificado"><Input type="email" value={editing.contact_email || ""} onChange={(e) => setEditing({ ...editing, contact_email: e.target.value })} placeholder="contato@site-oficial.com" /></Field>
              <Field label="Instagram profissional verificado"><Input value={editing.instagram_handle || ""} onChange={(e) => setEditing({ ...editing, instagram_handle: e.target.value })} placeholder="usuario, sem URL" /></Field>
              <p className="text-xs text-muted-foreground md:col-span-2">Registre somente canais publicados pelo próprio creator e mantenha a comprovação na URL da fonte ou nas notas. Salvar o contato não marca como pronto e não envia mensagem.</p>
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

      <Dialog open={discoveryOpen} onOpenChange={setDiscoveryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Prévia da descoberta no YouTube</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Resultados públicos ainda não pesquisados nem qualificados. Adicionar cria registros “Em pesquisa”, sem contato, rascunho ou envio.</p>
          {discoveryCriteria && <Card className="p-3 text-xs text-muted-foreground"><strong className="text-foreground">Critérios desta busca:</strong> até 5 canais novos; triagem heurística por sinais textuais de ensino — ainda não é qualificação; {discoveryCriteria.recent_months ? `publicação usada como evidência dentro da janela de ${discoveryCriteria.recent_months} meses` : "sem corte de data"}. Termos: {discoveryCriteria.queries.join(" · ")}.</Card>}
          <div className="max-h-[55vh] overflow-y-auto space-y-2">
            {discoveryCandidates.length ? discoveryCandidates.map((candidate) => <Card key={candidate.channel_id} className="p-3">
              <div className="font-medium">{candidate.channel_name}</div>
              <div className="text-xs text-muted-foreground">{TIERS[candidate.size_tier || ""] || "Sem porte"} · {candidate.subscriber_count?.toLocaleString("pt-BR") || "—"} inscritos · {candidate.niche || "nicho não inferido"}</div>
              <div className="mt-1 text-xs text-muted-foreground">Publicação da evidência: {candidate.discovery_published_at ? new Date(candidate.discovery_published_at).toLocaleDateString("pt-BR") : "data desconhecida"} · termo: {candidate.discovery_query || "não informado"}</div>
              {candidate.discovery_reason && <div className="text-xs text-muted-foreground">Por que entrou: {candidate.discovery_reason}</div>}
              <a className="text-xs text-blue-400 inline-flex gap-1 mt-1" href={candidate.source_url || "#"} target="_blank" rel="noreferrer">{candidate.source_label || "Vídeo público"}<ExternalLink className="w-3 h-3" /></a>
            </Card>) : <p className="text-sm text-muted-foreground">Nenhum creator novo encontrado nesta busca.</p>}
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDiscoveryOpen(false)}>Cancelar</Button><Button disabled={!discoveryCandidates.length || discovering} onClick={confirmDiscovery}>{discovering ? "Adicionando..." : `Adicionar ${discoveryCandidates.length} em pesquisa`}</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={discoverySettingsOpen} onOpenChange={setDiscoverySettingsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Configurar descoberta no YouTube</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Use até três buscas variadas de ensino funcional, uma por linha. A prévia deduplica canais já captados antes de qualquer inserção.</p>
          <Field label="Termos de busca"><Textarea rows={5} value={discoveryQueryText} onChange={(event) => setDiscoveryQueryText(event.target.value)} /></Field>
          <Field label="Recência da publicação usada como evidência"><Select value={discoveryRecentMonths} onValueChange={setDiscoveryRecentMonths}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="3">Últimos 3 meses</SelectItem><SelectItem value="6">Últimos 6 meses</SelectItem><SelectItem value="12">Últimos 12 meses</SelectItem><SelectItem value="24">Últimos 24 meses</SelectItem><SelectItem value="any">Sem corte de data</SelectItem></SelectContent></Select></Field>
          <p className="text-xs text-muted-foreground">Padrão: 6 meses, como equilíbrio inicial entre atividade observável e variedade. Isso prova apenas a data da publicação encontrada, não a frequência atual do canal. Cada prévia executa até três consultas de busca e uma consulta de detalhes; aumentar resultados por consulta não cria chamadas extras. Seguidores são apenas contexto.</p>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDiscoverySettingsOpen(false)}>Cancelar</Button><Button onClick={runDiscoveryPreview} disabled={discovering}>{discovering ? "Buscando..." : "Gerar prévia"}</Button></div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div className={`space-y-1 ${className}`}><Label>{label}</Label>{children}</div>;
}

function PriorityBadge({ assessment }: { assessment: ReturnType<typeof assessProspectPriority> }) {
  if (assessment.priority === "priority") return <div className="space-y-1"><Badge className="gap-1 bg-emerald-600"><Star className="w-3 h-3" />{assessment.label}</Badge><div className="max-w-[220px] text-xs text-muted-foreground">{assessment.reason}</div></div>;
  if (assessment.priority === "attention") return <div className="space-y-1"><Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-700 dark:text-amber-300"><AlertTriangle className="w-3 h-3" />{assessment.label}</Badge><div className="max-w-[220px] text-xs text-muted-foreground">{assessment.reason}</div></div>;
  return <div className="space-y-1"><Badge variant="secondary" className="gap-1"><Archive className="w-3 h-3" />{assessment.label}</Badge><div className="max-w-[220px] text-xs text-muted-foreground">{assessment.reason}</div></div>;
}

function ContactSummary({ prospect }: { prospect: Prospect }) {
  const contacts = [
    prospect.contact_email && { label: prospect.contact_email, hasDraft: Boolean(prospect.email_body_draft?.trim()) },
    prospect.instagram_handle && { label: `@${prospect.instagram_handle.replace(/^@/, "")}`, hasDraft: Boolean(prospect.dm_draft?.trim()) },
  ].filter(Boolean) as Array<{ label: string; hasDraft: boolean }>;

  if (!contacts.length) return <span className="text-xs text-muted-foreground">Nenhum canal estruturado</span>;
  return <div className="space-y-1">{contacts.map((contact) => <div key={contact.label} className="max-w-[240px] text-xs">
    <div className="truncate font-medium">{contact.label}</div>
    <div className={contact.hasDraft ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}>{contact.hasDraft ? "Rascunho disponível" : "Rascunho pendente"}</div>
  </div>)}</div>;
}
