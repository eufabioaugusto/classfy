import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Mail,
  Instagram,
  Send,
  Eye,
  Search,
  CheckCircle,
  Clock,
  XCircle,
  RefreshCw,
  ExternalLink,
  Copy,
  MessageCircle,
  Play,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { GlobalLoader } from "@/components/GlobalLoader";

interface Prospect {
  id: string;
  channel_name: string;
  channel_url: string | null;
  channel_id: string | null;
  subscriber_count: number | null;
  video_count: number | null;
  view_count: number | null;
  niche: string | null;
  size_tier: string | null;
  score: number | null;
  contact_email: string | null;
  instagram_handle: string | null;
  status: string;
  outreach_channel: string | null;
  template_used: string | null;
  contacted_at: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending:   { label: "Aguardando",  color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", icon: Clock },
  dm_queued: { label: "Fila DM",     color: "bg-blue-500/10 text-blue-400 border-blue-500/20",       icon: Instagram },
  contacted: { label: "E-mail Sent", color: "bg-green-500/10 text-green-400 border-green-500/20",    icon: CheckCircle },
  dm_sent:   { label: "DM Enviado",  color: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: CheckCircle },
  no_email:  { label: "Sem Contato", color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",       icon: XCircle },
  replied:   { label: "Respondeu",   color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle },
};

const TIER_LABELS: Record<string, string> = {
  micro: "Micro (<1k)", pequeno: "Pequeno (1k–5k)",
  medio: "Médio (5k–20k)", grande: "Grande (20k–100k)", bigplayer: "BigPlayer (>100k)",
};

function getEmailTemplate(prospect: Prospect): string {
  const name = prospect.channel_name;
  const tier = prospect.size_tier || "pequeno";
  const niche = prospect.niche && prospect.niche !== "geral" ? ` de ${prospect.niche}` : "";

  const templates: Record<string, string> = {
    micro: `Encontramos o canal ${name} e gostaríamos de apresentar uma oportunidade.\n\nEstamos lançando a Classfy, uma plataforma de conhecimento com um modelo econômico diferente: 40% de toda a receita da plataforma é distribuída mensalmente entre os criadores, por fórmula pública e auditável.\n\nO ${name} tem um enorme potencial para fazer parte do nosso time de Embaixadores Fundadores — criadores que entram antes do lançamento público e ajudam a moldar as regras da plataforma.\n\nPara saber mais, acesse classfy.com.br ou responda este e-mail.\n\nAtenciosamente,\nEquipe Classfy\n\nEstamos à disposição para esclarecer qualquer dúvida sobre nossa proposta de parceria.`,
    pequeno: `Acompanhamos o ${name} e temos uma pergunta direta: quanto você recebeu pelo seu conteúdo no último mês?\n\nA maioria dos criadores${niche} ganha muito menos do que merece. CPM arbitrário, comissões altas, algoritmo opaco — e nenhuma previsibilidade.\n\nA Classfy funciona diferente: 40% de toda a receita da plataforma vai diretamente para os criadores, todo mês, por fórmula pública. Você sabe exatamente quanto vai receber antes de receber.\n\nO ${name} tem grande potencial para fazer parte do nosso time de Embaixadores Fundadores — criadores que entram agora e ajudam a construir a plataforma conosco.\n\nPara entender melhor, acesse classfy.com.br ou responda este e-mail.\n\nAtenciosamente,\nEquipe Classfy\n\nEstamos à disposição para esclarecer qualquer dúvida sobre nossa proposta de parceria.`,
    medio: `Acompanhamos o ${name} e reconhecemos a qualidade do conteúdo${niche}. Por isso, gostaríamos de fazer um convite.\n\nEstamos lançando a Classfy — uma plataforma onde 40% da receita total vai para criadores, por fórmula pública. Você calcula sua participação estimada antes de receber. Nenhuma outra plataforma oferece essa transparência.\n\nO ${name} tem o perfil que buscamos para nosso time de Embaixadores Fundadores: criadores que entram antes do lançamento público, com condições exclusivas e voz ativa nas decisões da plataforma.\n\nPara conhecer a proposta completa, acesse classfy.com.br ou responda este e-mail.\n\nAtenciosamente,\nEquipe Classfy\n\nEstamos à disposição para esclarecer qualquer dúvida sobre nossa proposta de parceria.`,
    grande: `CPM caindo sem explicação. Algoritmo distribuindo menos. Receita imprevisível. Esses são os problemas que levaram à criação da Classfy.\n\nNosso modelo é simples e transparente: 40% da receita total da plataforma é distribuída todo mês entre os criadores ativos, por fórmula pública. Você acessa a fórmula, calcula sua participação estimada e recebe exatamente isso. Sem ajustes nos bastidores.\n\nO ${name} tem o perfil exato que buscamos para nosso time de Embaixadores Fundadores — criadores que entram antes do lançamento público e crescem junto com a plataforma.\n\nPara conhecer a proposta, acesse classfy.com.br ou responda este e-mail.\n\nAtenciosamente,\nEquipe Classfy\n\nEstamos à disposição para esclarecer qualquer dúvida sobre nossa proposta de parceria.`,
    bigplayer: `O ${name} tem um papel importante no que estamos construindo.\n\nEstamos lançando a Classfy, uma plataforma de conhecimento com modelo econômico diferente: 40% de toda a receita vai para criadores todo mês, por fórmula pública. Sem cortes surpresa, sem ajustes nos bastidores. Se a plataforma cresce, os criadores crescem matematicamente junto.\n\nGostaríamos de convidar o ${name} para ser um dos nossos Embaixadores Fundadores — um grupo seleto de criadores que entram antes do lançamento público, com condições exclusivas e participação ativa na construção da plataforma.\n\nSe houver interesse, acesse classfy.com.br ou responda este e-mail.\n\nAtenciosamente,\nEquipe Classfy\n\nEstamos à disposição para esclarecer qualquer dúvida sobre nossa proposta de parceria.`,
  };

  return templates[tier] || templates.pequeno;
}

function getDmTemplate(prospect: Prospect): string {
  const name = prospect.channel_name;
  const tier = prospect.size_tier || "pequeno";
  const niche = prospect.niche && prospect.niche !== "geral" ? ` de ${prospect.niche}` : "";

  const templates: Record<string, string> = {
    micro: `Olá! Acompanhamos o canal ${name} e acreditamos que vocês têm um enorme potencial para fazer parte do nosso time de Embaixadores Fundadores.\n\nEstamos lançando a Classfy — plataforma onde 40% da receita é distribuída entre criadores por fórmula pública. Quem entra agora participa das decisões iniciais.\n\nGostaria de receber mais detalhes?`,
    pequeno: `Olá! Acompanhamos o ${name}${niche} e temos uma pergunta: você sabe exatamente quanto vai receber pelo seu conteúdo no próximo mês?\n\nA Classfy torna isso previsível — 40% da receita distribuída por fórmula pública, sem surpresas. O ${name} tem perfil para ser um dos nossos Embaixadores Fundadores.\n\nPosso enviar mais detalhes?`,
    medio: `Olá! Reconhecemos a qualidade do conteúdo${niche} do ${name} e gostaríamos de fazer um convite.\n\nEstamos lançando a Classfy — 40% da receita vai para criadores por fórmula pública. Você calcula sua participação antes de receber.\n\nAcreditamos que o ${name} tem grande potencial para ser um dos nossos Embaixadores Fundadores. Há interesse em saber mais?`,
    grande: `Olá! O ${name} tem o perfil exato que buscamos para nosso time de Embaixadores Fundadores.\n\nEstamos lançando a Classfy — 40% da receita total vai para criadores todo mês, por fórmula pública e transparente. Sem cortes surpresa, sem algoritmo opaco.\n\nPosso enviar mais detalhes sobre a proposta de parceria?`,
    bigplayer: `Olá! O ${name} tem um papel importante no que estamos construindo na Classfy.\n\nDistribuímos 40% da receita para criadores todo mês, por fórmula pública — crescemos juntos, matematicamente. Gostaríamos de convidar vocês para uma parceria como Embaixador Fundador.\n\nHá interesse em conhecer a proposta?`,
  };

  return templates[tier] || templates.pequeno;
}

export default function AdminProspects() {
  const { user, role, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const [prospecting, setProspecting] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTier, setFilterTier] = useState("all");
  const [filterChannel, setFilterChannel] = useState("all");
  const [previewProspect, setPreviewProspect] = useState<Prospect | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user && role === "admin") fetchProspects();
  }, [user, role]);

  const fetchProspects = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("prospects")
        .select("*")
        .order("score", { ascending: false, nullsFirst: false });
      if (error) {
        console.error("Erro prospects:", error);
      } else {
        setProspects((data as Prospect[]) || []);
      }
    } catch (e) {
      console.error("Erro inesperado:", e);
    }
    setLoading(false);
  };

  const stats = {
    total: prospects.length,
    pending: prospects.filter(p => p.status === "pending").length,
    contacted: prospects.filter(p => p.status === "contacted" || p.status === "dm_sent").length,
    dmQueued: prospects.filter(p => p.status === "dm_queued").length,
    replied: prospects.filter(p => p.status === "replied").length,
    noEmail: prospects.filter(p => p.status === "no_email").length,
  };

  const filtered = prospects.filter(p => {
    const matchSearch = !search ||
      p.channel_name.toLowerCase().includes(search.toLowerCase()) ||
      (p.contact_email || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.instagram_handle || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || p.status === filterStatus;
    const matchTier = filterTier === "all" || p.size_tier === filterTier;
    const matchChannel = filterChannel === "all" || p.outreach_channel === filterChannel;
    return matchSearch && matchStatus && matchTier && matchChannel;
  });

  const handleSendEmail = async (prospect: Prospect) => {
    if (!prospect.contact_email) return;
    setSending(prospect.id);
    try {
      const { error } = await supabase.functions.invoke("send-prospect-email", {
        body: { prospectId: prospect.id },
      });
      if (error) throw error;
      toast({ title: "E-mail enviado", description: `Para ${prospect.contact_email}` });
      await fetchProspects();
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e.message, variant: "destructive" });
    } finally {
      setSending(null);
    }
  };

  const handleMarkDmQueued = async (prospect: Prospect) => {
    setSending(prospect.id);
    const { error } = await (supabase as any)
      .from("prospects")
      .update({ status: "dm_queued", outreach_channel: "instagram" })
      .eq("id", prospect.id);
    if (!error) {
      toast({ title: "Adicionado à fila de DM", description: `@${prospect.instagram_handle}` });
      await fetchProspects();
    }
    setSending(null);
  };

  const handleCopyDm = (prospect: Prospect) => {
    const msg = getDmTemplate(prospect);
    navigator.clipboard.writeText(msg);
    toast({ title: "Mensagem copiada", description: "Cole no Instagram DM" });
  };

  const handleRunProspector = async () => {
    setProspecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("run-prospector", {
        body: { keywordsCount: 3, maxPerKeyword: 6 },
      });
      if (error) throw error;
      toast({
        title: `+${data.added} prospects adicionados`,
        description: `${data.withEmail} e-mails · ${data.withIG} Instagram · ${data.filtered} filtrados`,
      });
      await fetchProspects();
    } catch (e: any) {
      toast({ title: "Erro ao prospectar", description: e.message, variant: "destructive" });
    } finally {
      setProspecting(false);
    }
  };

  const handleMarkDmSent = async (prospect: Prospect) => {
    setSending(prospect.id);
    const { error } = await (supabase as any)
      .from("prospects")
      .update({
        status: "dm_sent",
        outreach_channel: "instagram",
        contacted_at: new Date().toISOString(),
        template_used: `instagram_${prospect.size_tier}`,
      })
      .eq("id", prospect.id);
    if (!error) {
      toast({ title: "Marcado como enviado", description: `@${prospect.instagram_handle}` });
      await fetchProspects();
    }
    setSending(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkSend = async () => {
    const toSend = filtered.filter(p => selectedIds.has(p.id) && p.status === "pending" && p.contact_email);
    if (!toSend.length) return;
    for (const p of toSend) await handleSendEmail(p);
    setSelectedIds(new Set());
  };

  if (authLoading) return <GlobalLoader />;
  if (!user || role !== "admin") return <Navigate to="/" />;

  const previewTemplate = previewProspect
    ? previewProspect.outreach_channel === "instagram"
      ? getDmTemplate(previewProspect)
      : getEmailTemplate(previewProspect)
    : "";

  return (
    <AdminLayout title="Prospecção de Creators">
      <div className="p-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { label: "Total", value: stats.total, color: "text-foreground" },
            { label: "Aguardando", value: stats.pending, color: "text-yellow-400" },
            { label: "Fila DM", value: stats.dmQueued, color: "text-blue-400" },
            { label: "Enviados", value: stats.contacted, color: "text-green-400" },
            { label: "Responderam", value: stats.replied, color: "text-emerald-400" },
            { label: "Sem contato", value: stats.noEmail, color: "text-zinc-500" },
          ].map(s => (
            <Card key={s.label} className="p-3 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            </Card>
          ))}
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar canal, e-mail ou @..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterTier} onValueChange={setFilterTier}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tiers</SelectItem>
              {Object.entries(TIER_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterChannel} onValueChange={setFilterChannel}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Canal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchProspects} disabled={prospecting}>
            <RefreshCw className={`w-4 h-4 ${prospecting ? "animate-spin" : ""}`} />
          </Button>
          <Button
            onClick={handleRunProspector}
            disabled={prospecting}
            className="gap-2"
          >
            {prospecting ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Prospectando...</>
            ) : (
              <><Play className="w-4 h-4" /> Rodar Prospector</>
            )}
          </Button>
          {selectedIds.size > 0 && (
            <Button onClick={handleBulkSend} className="gap-2">
              <Send className="w-4 h-4" />
              Disparar selecionados ({selectedIds.size})
            </Button>
          )}
        </div>

        {/* Tabela */}
        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              Nenhum prospect encontrado
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    <th className="w-8 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === filtered.filter(p => p.status === "pending").length && filtered.filter(p => p.status === "pending").length > 0}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedIds(new Set(filtered.filter(p => p.status === "pending").map(p => p.id)));
                          } else {
                            setSelectedIds(new Set());
                          }
                        }}
                      />
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Canal</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Tier</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Score</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contato</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => {
                    const statusCfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.no_email;
                    const StatusIcon = statusCfg.icon;
                    return (
                      <tr key={p.id} className={`border-b last:border-0 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/5"}`}>
                        <td className="px-4 py-3">
                          {p.status === "pending" && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(p.id)}
                              onChange={() => toggleSelect(p.id)}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="font-medium leading-tight">{p.channel_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {p.subscriber_count ? `${p.subscriber_count >= 1000 ? (p.subscriber_count / 1000).toFixed(1) + "k" : p.subscriber_count} subs` : "—"}
                                {p.niche && p.niche !== "geral" ? ` · ${p.niche}` : ""}
                              </div>
                            </div>
                            {p.channel_url && (
                              <a href={p.channel_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-muted-foreground capitalize">{p.size_tier || "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-sm font-semibold ${p.score && p.score >= 70 ? "text-green-400" : p.score && p.score >= 50 ? "text-yellow-400" : "text-muted-foreground"}`}>
                            {p.score ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-0.5">
                            {p.contact_email && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Mail className="w-3 h-3" /> {p.contact_email}
                              </div>
                            )}
                            {p.instagram_handle && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Instagram className="w-3 h-3" /> @{p.instagram_handle}
                              </div>
                            )}
                            {!p.contact_email && !p.instagram_handle && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs gap-1 ${statusCfg.color}`}>
                            <StatusIcon className="w-3 h-3" />
                            {statusCfg.label}
                          </Badge>
                          {p.contacted_at && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {new Date(p.contacted_at).toLocaleDateString("pt-BR")}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            {/* Preview */}
                            {(p.status === "pending" || p.status === "dm_queued") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => setPreviewProspect(p)}
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {/* Enviar e-mail */}
                            {p.status === "pending" && p.contact_email && (
                              <Button
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                onClick={() => handleSendEmail(p)}
                                disabled={sending === p.id}
                              >
                                {sending === p.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Send className="w-3 h-3" />
                                )}
                                Enviar e-mail
                              </Button>
                            )}
                            {/* DM manual: copiar + abrir + marcar enviado */}
                            {p.instagram_handle && (p.status === "pending" || p.status === "dm_queued" || p.status === "no_email") && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1 text-xs"
                                  onClick={() => handleCopyDm(p)}
                                >
                                  <Copy className="w-3 h-3" />
                                  Copiar DM
                                </Button>
                                <a
                                  href={`https://ig.me/m/${p.instagram_handle}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-pink-400 border-pink-500/30 hover:border-pink-400">
                                    <MessageCircle className="w-3 h-3" />
                                    Abrir DM
                                  </Button>
                                </a>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 text-xs text-muted-foreground"
                                  onClick={() => handleMarkDmSent(p)}
                                  disabled={sending === p.id}
                                >
                                  {sending === p.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                  Enviado
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          {filtered.length} de {prospects.length} prospects · DMs Instagram: rode <code className="bg-muted px-1 rounded">python3 src/instagram_dm.py</code> para processar a fila
        </p>
      </div>

      {/* Modal de preview */}
      <Dialog open={!!previewProspect} onOpenChange={() => setPreviewProspect(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewProspect?.outreach_channel === "instagram" ? (
                <><Instagram className="w-4 h-4" /> Preview DM — @{previewProspect?.instagram_handle}</>
              ) : (
                <><Mail className="w-4 h-4" /> Preview E-mail — {previewProspect?.contact_email}</>
              )}
            </DialogTitle>
          </DialogHeader>
          {previewProspect && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <div>
                  <div className="font-medium text-sm">{previewProspect.channel_name}</div>
                  <div className="text-xs text-muted-foreground capitalize">{previewProspect.size_tier} · score {previewProspect.score}</div>
                </div>
              </div>
              {previewProspect.outreach_channel !== "instagram" && (
                <div className="text-sm font-medium text-muted-foreground">
                  Assunto: <span className="text-foreground">{previewProspect.channel_name} — {
                    previewProspect.size_tier === "bigplayer" ? "uma proposta diferente" :
                    previewProspect.size_tier === "grande" ? "40% da receita pra criadores. Sem algoritmo opaco." :
                    "a Classfy tem uma proposta"
                  }</span>
                </div>
              )}
              <div className="bg-muted/20 rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed border">
                {previewTemplate}
              </div>
              <div className="flex gap-2 justify-end flex-wrap">
                <Button variant="outline" onClick={() => setPreviewProspect(null)}>Fechar</Button>
                {previewProspect.instagram_handle && (
                  <>
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={() => handleCopyDm(previewProspect)}
                    >
                      <Copy className="w-4 h-4" /> Copiar DM
                    </Button>
                    <a
                      href={`https://ig.me/m/${previewProspect.instagram_handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" className="gap-2 text-pink-400 border-pink-500/30">
                        <MessageCircle className="w-4 h-4" /> Abrir DM
                      </Button>
                    </a>
                  </>
                )}
                {previewProspect.status === "pending" && previewProspect.contact_email && (
                  <Button
                    onClick={async () => {
                      setPreviewProspect(null);
                      await handleSendEmail(previewProspect);
                    }}
                    disabled={sending === previewProspect.id}
                    className="gap-2"
                  >
                    <Send className="w-4 h-4" /> Confirmar e-mail
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
