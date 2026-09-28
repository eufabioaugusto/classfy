import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Gift, Users, MousePointer2, Wallet, Share2, Download, ExternalLink, ArrowUpRight, FileText, Loader2, RefreshCw } from "lucide-react";
import { referralShareUrl } from "@/lib/referrals/attribution";
import "./AffiliateModal.css";

interface AffiliateModalProps { open: boolean; onOpenChange: (open: boolean) => void }
interface ReferralStats { code: string; clicks: number; conversions: number; credited: number; pending: number }
interface Material { id: string; title: string; description: string | null; type: string; file_url: string | null; thumbnail_url: string | null; category: string }
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const inviteText = (url: string) => `Encontrei conteúdos e creators interessantes na Classfy. Conheça a plataforma e descubra o que combina com você: ${url}`;
const safeUrl = (url: string | null) => { try { const parsed = new URL(url || ''); return parsed.protocol === 'https:' ? parsed.href : null; } catch { return null; } };

export function AffiliateModal({ open, onOpenChange }: AffiliateModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsError, setMaterialsError] = useState(false);
  const [terms, setTerms] = useState<{ commission_percent: number; enabled: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStats(null); setTerms(null); setMaterials([]); setCopied(null); setError(false); setMaterialsError(false); setLoading(true);
    if (!user) { setError(true); setLoading(false); return; }
    const load = async () => {
      try {
        const { data: code, error: rpcError } = await supabase.rpc('get_or_create_referral_link', { p_user_id: user.id });
        if (rpcError || !code) throw rpcError || new Error('Missing code');
        const [links, commissions, program, kit] = await Promise.all([
          supabase.from('referral_links').select('total_clicks,total_conversions').eq('user_id', user.id).single(),
          supabase.from('referral_commissions').select('commission_amount,status,reversed_amount').eq('referrer_id', user.id),
          supabase.rpc('get_referral_program_terms_v1'),
          supabase.from('marketing_materials').select('id,title,description,type,file_url,thumbnail_url,category').eq('active', true).order('category'),
        ]);
        if (cancelled) return;
        if (links.error || commissions.error || program.error) throw links.error || commissions.error || program.error;
        const rows = commissions.data || [];
        setStats({ code, clicks: links.data.total_clicks || 0, conversions: links.data.total_conversions || 0,
          credited: rows.filter(c => c.status === 'paid').reduce((sum, c) => sum + Number(c.commission_amount) - Number(c.reversed_amount || 0), 0),
          pending: rows.filter(c => c.status === 'pending').reduce((sum, c) => sum + Number(c.commission_amount), 0) });
        setTerms(program.data as unknown as { commission_percent: number; enabled: boolean });
        setMaterialsError(!!kit.error); setMaterials(kit.data || []);
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [open, user?.id, retry]);

  useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(null), 2500); return () => window.clearTimeout(timer); }, [copied]);
  const link = stats ? referralShareUrl(stats.code) : '';
  const copy = async (text: string, id: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); toast({ title: id === 'link' ? 'Link copiado' : 'Convite copiado', description: 'Pronto para compartilhar.' }); }
    catch { toast({ title: 'Não foi possível copiar', description: 'Selecione o link e copie manualmente.', variant: 'destructive' }); }
  };
  const share = (platform: 'whatsapp' | 'x') => {
    const text = encodeURIComponent(inviteText(link));
    window.open(platform === 'whatsapp' ? `https://wa.me/?text=${text}` : `https://twitter.com/intent/tweet?text=${text}`, '_blank', 'noopener,noreferrer');
  };
  const CopyIcon = copied === 'link' ? Check : Copy;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="cf-referral-modal">
      <DialogHeader className="cf-referral-header">
        <span className="cf-referral-brand"><Gift size={22} /></span>
        <div><span className="cf-referral-eyebrow">CRESÇA COM A CLASSFY</span>
          <DialogTitle>Boas descobertas merecem ser compartilhadas.</DialogTitle>
          <DialogDescription>Convide pessoas para a Classfy e acompanhe suas indicações aqui.</DialogDescription>
        </div>
      </DialogHeader>
      <Tabs defaultValue="link" className="cf-referral-tabs">
        <TabsList><TabsTrigger value="link">Meu link</TabsTrigger><TabsTrigger value="materials">Kit de divulgação {materials.length > 0 && <span>{materials.length}</span>}</TabsTrigger></TabsList>
        {loading ? <div className="cf-referral-status" role="status"><Loader2 className="animate-spin" size={24} /><p>Preparando seu programa de indicações…</p></div>
          : error ? <div className="cf-referral-status" role="alert"><p>Não foi possível carregar suas indicações.</p><Button variant="outline" onClick={() => setRetry(v => v + 1)}><RefreshCw size={15} /> Tentar novamente</Button></div>
          : stats && terms && <>
            {!terms.enabled && <p className="cf-referral-notice">O programa está pausado. Seus registros anteriores continuam disponíveis.</p>}
            <TabsContent value="link" className="cf-referral-content">
              <section className="cf-referral-link-card">
                <div className="cf-referral-section-label"><Share2 size={16} /><label htmlFor="classfy-referral-url">Seu convite começa aqui</label></div>
                <p>Um link só seu, pronto para compartilhar.</p>
                <div className="cf-referral-link-row"><input id="classfy-referral-url" readOnly value={link} onFocus={e => e.target.select()} /><Button disabled={!terms.enabled} onClick={() => void copy(link, 'link')}><CopyIcon size={16} />{copied === 'link' ? 'Copiado' : 'Copiar link'}</Button></div>
                <div className="cf-referral-share"><Button disabled={!terms.enabled} variant="outline" onClick={() => share('whatsapp')}><Share2 size={15} /> WhatsApp <ArrowUpRight size={14} /></Button><Button disabled={!terms.enabled} variant="outline" onClick={() => share('x')}><ExternalLink size={15} /> Compartilhar no X</Button></div>
              </section>
              <section aria-label="Resultados das indicações" className="cf-referral-metrics">
                {[{ icon: MousePointer2, label: 'Cliques', value: stats.clicks.toLocaleString('pt-BR') }, { icon: Users, label: 'Cadastros indicados', value: stats.conversions.toLocaleString('pt-BR') }, { icon: Wallet, label: 'Comissões creditadas', value: money(stats.credited) }, { icon: Wallet, label: 'Comissões pendentes', value: money(stats.pending) }].map(({ icon: Icon, label, value }) => <div key={label}><Icon size={15} /><strong>{value}</strong><span>{label}</span></div>)}
              </section>
              <section className="cf-referral-steps"><h3>Como funciona</h3>
                <ol>{[{ title: 'Compartilhe seu link', text: 'Envie para quem vai gostar das suas descobertas.' }, { title: 'A pessoa se cadastra', text: 'A indicação é registrada quando o novo cadastro é confirmado.' }, { title: 'A primeira compra gera comissão', text: `${terms.commission_percent.toLocaleString('pt-BR')}% sobre a primeira compra paga, conforme as regras do programa.` }].map((step, i) => <li key={step.title}><span>{i + 1}</span><div><strong>{step.title}</strong><p>{step.text}</p></div></li>)}</ol>
              </section>
              <p className="cf-referral-fineprint">O convite vale por 30 dias antes do cadastro. Reembolsos e contestações podem estornar comissões. Indicações contribuem para a qualificação no pool mensal, conforme as regras do ciclo.</p>
            </TabsContent>
            <TabsContent value="materials" className="cf-referral-content">
              <div className="cf-referral-kit-heading"><h3>Convites com a sua voz.</h3><p>Copie um texto com seu link ou abra os materiais disponíveis.</p></div>
              {materialsError ? <p role="alert" className="cf-referral-notice">O kit não carregou. <button onClick={() => setRetry(v => v + 1)}>Tentar novamente</button></p> : <div className="cf-referral-kit">
                {(materials.length ? materials : [{ id: 'invite', title: 'Convite para compartilhar', description: null, type: 'text', file_url: null, thumbnail_url: null, category: 'social' }]).map(material => {
                  const file = safeUrl(material.file_url);
                  const text = material.title.toLowerCase().includes('instagram') ? `Uma boa descoberta para compartilhar: conteúdos, creators e novos assuntos para explorar na Classfy. Conheça pelo meu link: ${link}` : inviteText(link);
                  return <article key={material.id}><span className="cf-referral-material-icon"><FileText size={20} /></span><h4>{material.title}</h4><p>{material.type === 'text' ? text : material.description}</p>
                    {material.type === 'text' ? <Button disabled={!terms.enabled} variant="outline" onClick={() => void copy(text, material.id)}>{copied === material.id ? <Check size={15} /> : <Copy size={15} />}{copied === material.id ? 'Copiado' : 'Copiar convite'}</Button> : file ? <Button variant="outline" asChild><a href={file} target="_blank" rel="noopener noreferrer"><Download size={15} /> Abrir material</a></Button> : <span className="cf-referral-unavailable">Material em preparação</span>}
                  </article>;
                })}
              </div>}
            </TabsContent>
          </>}
      </Tabs>
    </DialogContent>
  </Dialog>;
}
