import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Users, MousePointer2, Wallet, Share2, ChevronDown, Download, ExternalLink, ArrowUpRight, FileText, Loader2, RefreshCw } from "lucide-react";
import { referralShareUrl } from "@/lib/referrals/attribution";
import { REFERRAL_ARTWORKS, createReferralArtwork } from "@/lib/referrals/artwork";
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
  const [artworkUrls, setArtworkUrls] = useState<Record<string, string>>({});
  const [artworkError, setArtworkError] = useState(false);
  const [artworkRetry, setArtworkRetry] = useState(0);
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
  useEffect(() => {
    if (!open || !link) return;
    let cancelled = false;
    const generated: string[] = [];
    setArtworkUrls({}); setArtworkError(false);
    void Promise.all(REFERRAL_ARTWORKS.map(async art => {
      const url = await createReferralArtwork(art, link);
      if (cancelled) { URL.revokeObjectURL(url); return null; }
      generated.push(url);
      return [art.id, url] as const;
    })).then(results => {
      if (!cancelled) setArtworkUrls(Object.fromEntries(results.filter(value => value !== null)));
    }).catch(() => { if (!cancelled) setArtworkError(true); });
    return () => { cancelled = true; generated.forEach(url => URL.revokeObjectURL(url)); };
  }, [open, link, artworkRetry]);
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
    <DialogContent className="cf-referral-modal" overlayClassName="cf-referral-overlay">
      <div className="cf-referral-sheet-scroll">
      <div className="cf-referral-sheet-inner">
      <DialogHeader className="cf-referral-header">
        <div><span className="cf-referral-eyebrow">PROGRAMA DE INDICAÇÕES</span>
          <DialogTitle>Indique a Classfy.<br />Ganhe com suas indicações.</DialogTitle>
          <DialogDescription>{terms ? `Receba ${terms.commission_percent.toLocaleString('pt-BR')}% de comissão na primeira compra paga de quem você indicar.` : 'Convide pessoas para a Classfy e acompanhe suas comissões.'}</DialogDescription>
        </div>
        <img src="/referrals/sharing-illustration.svg" className="cf-referral-illustration" alt="" />
      </DialogHeader>
      <div className="cf-referral-sheet-body">
        {loading ? <div className="cf-referral-status" role="status"><Loader2 className="animate-spin" size={24} /><p>Preparando seu programa de indicações…</p></div>
          : error ? <div className="cf-referral-status" role="alert"><p>Não foi possível carregar suas indicações.</p><Button variant="outline" onClick={() => setRetry(v => v + 1)}><RefreshCw size={15} /> Tentar novamente</Button></div>
          : stats && terms && <>
            {!terms.enabled && <p className="cf-referral-notice">O programa está pausado. Seus registros anteriores continuam disponíveis.</p>}
            <div className="cf-referral-columns">
            <section className="cf-referral-content cf-referral-overview" aria-labelledby="referral-overview-title">
              <div className="cf-referral-column-heading"><span>01 / INDIQUE E GANHE</span><h3 id="referral-overview-title">Seu próximo ganho começa aqui.</h3></div>
              <section className="cf-referral-link-card">
                <div className="cf-referral-section-label"><Share2 size={16} /><label htmlFor="classfy-referral-url">Seu link de convite</label></div>
                <div className="cf-referral-link-row"><input id="classfy-referral-url" readOnly value={link} onFocus={e => e.target.select()} /><Button disabled={!terms.enabled} onClick={() => void copy(link, 'link')}><CopyIcon size={16} />{copied === 'link' ? 'Copiado' : 'Copiar link'}</Button></div>
                <div className="cf-referral-share"><Button disabled={!terms.enabled} variant="outline" onClick={() => share('whatsapp')}><Share2 size={15} /> WhatsApp <ArrowUpRight size={14} /></Button><Button disabled={!terms.enabled} variant="outline" onClick={() => share('x')}><ExternalLink size={15} /> Compartilhar no X</Button></div>
              </section>
              <section aria-label="Seus ganhos e indicações" className="cf-referral-metrics">
                {[{ icon: MousePointer2, label: 'Cliques', value: stats.clicks.toLocaleString('pt-BR') }, { icon: Users, label: 'Cadastros indicados', value: stats.conversions.toLocaleString('pt-BR') }, { icon: Wallet, label: 'Ganhos creditados', value: money(stats.credited) }, { icon: Wallet, label: 'Ganhos pendentes', value: money(stats.pending) }].map(({ icon: Icon, label, value }) => <div key={label}><Icon size={15} /><strong>{value}</strong><span>{label}</span></div>)}
              </section>
              <section className="cf-referral-journey" aria-label="Como funciona">
                <div><span>1</span><strong>Compartilhe seu link</strong></div><ArrowUpRight size={14} />
                <div><span>2</span><strong>A pessoa se cadastra e compra</strong></div><ArrowUpRight size={14} />
                <div><span>3</span><strong>Você ganha {terms.commission_percent.toLocaleString('pt-BR')}%</strong></div>
              </section>
              <details className="cf-referral-rules"><summary>Regras do programa<ChevronDown size={14} /></summary><p>Convite válido por 30 dias antes do cadastro. A comissão é calculada sobre a primeira compra paga; reembolsos e contestações podem estorná-la. Indicações contribuem para a qualificação no pool mensal conforme as regras do ciclo.</p></details>
            </section>
            <section className="cf-referral-content cf-referral-materials" aria-labelledby="referral-kit-title">
              <div className="cf-referral-kit-heading cf-referral-column-heading"><span>02 / KIT DE DIVULGAÇÃO</span><h3 id="referral-kit-title">Pronto para compartilhar.</h3><p>Artes com seu link e QR code. No story, adicione também o sticker de link.</p></div>
              <div className="cf-referral-artworks">
                {REFERRAL_ARTWORKS.map(art => <article key={art.id}>
                  <div className={`cf-referral-art-preview cf-referral-art-preview--${art.id}`}>
                    <img src={artworkUrls[art.id] || art.source} alt={`${art.title}, arte para ${art.format}`} />
                    {!artworkUrls[art.id] && !artworkError && <span><Loader2 size={17} className="animate-spin" /> Preparando seu convite</span>}
                  </div>
                  <div className="cf-referral-art-meta"><strong>{art.format}</strong><span>{art.width} × {art.height}</span></div>
                  {artworkUrls[art.id] ? <Button asChild disabled={!terms.enabled}><a aria-disabled={!terms.enabled} href={terms.enabled ? artworkUrls[art.id] : undefined} download={`classfy-convite-${art.id}.png`}><Download size={15} /> Baixar imagem</a></Button> : <Button variant="outline" disabled={!artworkError} onClick={() => setArtworkRetry(v => v + 1)}>{artworkError ? 'Tentar novamente' : 'Preparando imagem…'}</Button>}
                </article>)}
              </div>
              <div className="cf-referral-kit-link"><Button variant="outline" disabled={!terms.enabled} onClick={() => void copy(link, 'link')}><CopyIcon size={14} />{copied === 'link' ? 'Link copiado' : 'Copiar link para o story'}</Button></div>
              {materialsError ? <p role="alert" className="cf-referral-notice">O kit não carregou. <button onClick={() => setRetry(v => v + 1)}>Tentar novamente</button></p> : <div className="cf-referral-kit">
                {(materials.length ? materials : [{ id: 'invite', title: 'Convite para compartilhar', description: null, type: 'text', file_url: null, thumbnail_url: null, category: 'social' }]).map(material => {
                  const file = safeUrl(material.file_url);
                  const text = material.title.toLowerCase().includes('instagram') ? `Uma boa descoberta para compartilhar: conteúdos, creators e novos assuntos para explorar na Classfy. Conheça pelo meu link: ${link}` : inviteText(link);
                  return <article key={material.id}><span className="cf-referral-material-icon"><FileText size={20} /></span><h4>{material.title}</h4><p>{material.type === 'text' ? text : material.description}</p>
                    {material.type === 'text' ? <Button disabled={!terms.enabled} variant="outline" onClick={() => void copy(text, material.id)}>{copied === material.id ? <Check size={15} /> : <Copy size={15} />}{copied === material.id ? 'Copiado' : 'Copiar convite'}</Button> : file ? <Button variant="outline" asChild><a href={file} target="_blank" rel="noopener noreferrer"><Download size={15} /> Abrir material</a></Button> : <span className="cf-referral-unavailable">Material em preparação</span>}
                  </article>;
                })}
              </div>}
            </section>
            </div>
          </>}
      </div>
      </div>
      </div>
    </DialogContent>
  </Dialog>;
}
