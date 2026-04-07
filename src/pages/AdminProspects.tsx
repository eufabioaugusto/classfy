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
  Users,
  CheckCircle,
  Clock,
  XCircle,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { GlobalLoader } from "@/components/GlobalLoader";

interface Prospect {
  id: string;
  channel_name: string;
  channel_url: string | null;
  youtube_channel_id: string | null;
  subscribers: number | null;
  avg_views: number | null;
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
    micro: `Oi, tudo bem?\n\nVi o canal ${name} e queria falar sobre algo que estamos construindo.\n\nA Classfy é uma plataforma de conhecimento onde criadores ganham de verdade — 40% de toda a receita da plataforma é distribuída mensalmente entre quem publica conteúdo.\n\nVocê estaria chegando no momento certo. Quem entra agora como Creator Fundador ajuda a moldar as regras e garante condições que não estarão disponíveis depois do lançamento público.\n\nSe quiser saber mais, acesse classfy.com.br ou responda esse e-mail.\n\nAbs,\nFabio — Classfy`,
    pequeno: `Oi,\n\nVi o ${name} e queria fazer uma pergunta direta: quanto você ganhou com seu conteúdo no último mês?\n\nA maioria dos criadores${niche} ganha muito menos do que merece. A Classfy funciona diferente: 40% da receita total vai diretamente para os criadores, por fórmula pública.\n\nEstamos convidando Creators Fundadores — pessoas que entram antes de todo mundo.\n\nAcesse classfy.com.br ou responda aqui.\n\nAbs,\nFabio — Classfy`,
    medio: `Oi,\n\nAcompanhei o ${name}${niche} e você claramente sabe criar conteúdo de qualidade.\n\nEstamos lançando a Classfy — 40% da receita total vai para criadores, por fórmula pública. Você pode calcular sua participação antes de receber. Nenhuma plataforma faz isso.\n\nTemos vagas de Creator Fundador abertas. Vale 10 minutos? classfy.com.br\n\nAbs,\nFabio — Classfy`,
    grande: `Oi,\n\nVocê já passou pela frustração de ver seu CPM cair sem explicação? Estamos construindo a Classfy exatamente por isso.\n\n40% da receita total vai para criadores todo mês — fórmula pública, sem corte surpresa. Vi o ${name} e acredito que você seria um dos criadores que mais se beneficia desse modelo.\n\nEstamos convidando um grupo seleto como Creators Fundadores.\n\nclassfy.com.br\n\nAbs,\nFabio — Classfy`,
    bigplayer: `Oi,\n\nDireto ao ponto: estou lançando a Classfy, plataforma de conhecimento com modelo econômico diferente.\n\n40% da receita total vai para criadores e alunos todo mês, por fórmula pública. Se a plataforma cresce, você cresce matematicamente junto.\n\nVi o ${name} e acredito que faz sentido conversar.\n\nclassfy.com.br\n\nAbs,\nFabio — Classfy`,
  };

  return templates[tier] || templates.pequeno;
}

function getDmTemplate(prospect: Prospect): string {
  const name = prospect.channel_name;
  const tier = prospect.size_tier || "pequeno";
  const niche = prospect.niche && prospect.niche !== "geral" ? ` de ${prospect.niche}` : "";

  const templates: Record<string, string> = {
    micro: `Oi! Vi o canal ${name} e queria falar sobre algo que estamos construindo. A Classfy é uma plataforma onde criadores ganham de verdade — 40% da receita distribuída por fórmula pública. Posso te mandar mais detalhes? 🙏`,
    pequeno: `Oi! Acompanhei o ${name}${niche} e queria fazer uma pergunta: quanto você ganhou com seu conteúdo no último mês? A Classfy distribui 40% da receita diretamente pra criadores. Vale uma conversa rápida? 👇`,
    medio: `Oi! Vi o ${name} e você cria conteúdo de qualidade${niche}. Estou lançando a Classfy — 40% da receita vai pra criadores por fórmula pública. Temos vagas de Creator Fundador. Quer saber mais? 🚀`,
    grande: `Oi! Você cria conteúdo incrível no ${name}. Direto ao ponto: estou lançando a Classfy. 40% da receita total vai pra criadores todo mês — fórmula pública, sem corte surpresa. Posso te mandar os detalhes? 👊`,
    bigplayer: `Oi! Admiro muito o trabalho do ${name}. Estou lançando a Classfy — 40% da receita da plataforma vai direto pra criadores por fórmula pública. Tem interesse em conversar sobre uma parceria como Creator Fundador?`,
  };

  return templates[tier] || templates.pequeno;
}

export default function AdminProspects() {
  const { user, role, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
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
          <Button variant="outline" size="icon" onClick={fetchProspects}>
            <RefreshCw className="w-4 h-4" />
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
                                {p.subscribers ? `${(p.subscribers / 1000).toFixed(p.subscribers >= 1000 ? 1 : 0)}${p.subscribers >= 1000 ? "k" : ""} subs` : "—"}
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
                          <div className="flex items-center justify-end gap-1">
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
                                Enviar
                              </Button>
                            )}
                            {/* Marcar para DM */}
                            {p.status === "pending" && !p.contact_email && p.instagram_handle && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-xs"
                                onClick={() => handleMarkDmQueued(p)}
                                disabled={sending === p.id}
                              >
                                <Instagram className="w-3 h-3" />
                                Fila DM
                              </Button>
                            )}
                            {/* DM na fila */}
                            {p.status === "dm_queued" && (
                              <Badge variant="outline" className="text-xs text-blue-400 border-blue-500/30">
                                Aguarda script
                              </Badge>
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
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setPreviewProspect(null)}>Fechar</Button>
                {previewProspect.status === "pending" && previewProspect.contact_email && (
                  <Button
                    onClick={async () => {
                      setPreviewProspect(null);
                      await handleSendEmail(previewProspect);
                    }}
                    disabled={sending === previewProspect.id}
                    className="gap-2"
                  >
                    <Send className="w-4 h-4" /> Confirmar envio
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
