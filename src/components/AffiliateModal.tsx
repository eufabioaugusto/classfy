import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Copy, Gift, Users, MousePointer, DollarSign, Share2, Download, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";

interface AffiliateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ReferralStats {
  code: string;
  clicks: number;
  conversions: number;
  totalCommissions: number;
  pendingCommissions: number;
}

interface Material {
  id: string;
  title: string;
  description: string | null;
  type: string;
  file_url: string | null;
  thumbnail_url: string | null;
  category: string;
}

const TYPE_LABEL: Record<string, string> = {
  banner: 'Banner',
  text: 'Texto pronto',
  post: 'Post',
  video_template: 'Vídeo',
};

export function AffiliateModal({ open, onOpenChange }: AffiliateModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);

  useEffect(() => {
    if (open && user) {
      fetchReferralData();
      fetchMaterials();
    }
  }, [open, user]);

  const fetchReferralData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Usar RPC que garante criação automática do link
      const { data: code, error: rpcError } = await supabase
        .rpc('get_or_create_referral_link', { p_user_id: user.id });
      if (rpcError) throw rpcError;

      const [linkRes, commissionsRes] = await Promise.all([
        supabase.from('referral_links').select('total_clicks, total_conversions').eq('user_id', user.id).single(),
        supabase.from('referral_commissions').select('commission_amount, status').eq('referrer_id', user.id),
      ]);

      const totalCommissions = commissionsRes.data?.filter(c => c.status === 'paid')
        .reduce((sum, c) => sum + Number(c.commission_amount), 0) || 0;
      const pendingCommissions = commissionsRes.data?.filter(c => c.status === 'pending')
        .reduce((sum, c) => sum + Number(c.commission_amount), 0) || 0;

      setStats({
        code: code as string,
        clicks: linkRes.data?.total_clicks || 0,
        conversions: linkRes.data?.total_conversions || 0,
        totalCommissions,
        pendingCommissions,
      });
    } catch (error) {
      console.error('Error fetching referral data:', error);
      toast({ title: 'Erro', description: 'Não foi possível carregar os dados do programa.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fetchMaterials = async () => {
    const { data } = await supabase
      .from('marketing_materials')
      .select('id, title, description, type, file_url, thumbnail_url, category')
      .eq('active', true)
      .order('category', { ascending: true });
    setMaterials(data || []);
  };

  const referralLink = stats ? `${window.location.origin}?ref=${stats.code}` : '';

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast({ title: 'Link copiado!', description: 'Cole em qualquer rede social ou mensagem.' });
  };

  const shareWhatsApp = () => {
    const msg = encodeURIComponent(
      `Ei! Tô usando a Classfy pra aprender de verdade. Entra pelo meu link e começa hoje: ${referralLink}`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  const shareTwitter = () => {
    const msg = encodeURIComponent(`Descobri a @Classfy — plataforma de aprendizado que te paga por estudar! Entra pelo meu link: ${referralLink}`);
    window.open(`https://twitter.com/intent/tweet?text=${msg}`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Gift className="w-6 h-6 text-primary" />
            Programa de Indicações
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="link">
          <TabsList className="w-full">
            <TabsTrigger value="link" className="flex-1">Meu Link</TabsTrigger>
            <TabsTrigger value="materiais" className="flex-1 gap-1">
              Materiais
              {materials.length > 0 && <Badge variant="secondary" className="text-xs">{materials.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="space-y-5 mt-4">
            {/* Como funciona */}
            <Card className="p-4 bg-muted/50">
              <h3 className="font-semibold mb-3">Como funciona:</h3>
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="space-y-1">
                  <div className="text-2xl">📤</div>
                  <p className="font-medium">Compartilhe</p>
                  <p className="text-xs text-muted-foreground">Seu link único</p>
                </div>
                <div className="space-y-1">
                  <div className="text-2xl">👥</div>
                  <p className="font-medium">Pessoa se cadastra</p>
                  <p className="text-xs text-muted-foreground">+25 QP para você</p>
                </div>
                <div className="space-y-1">
                  <div className="text-2xl">💰</div>
                  <p className="font-medium">Ela compra</p>
                  <p className="text-xs text-muted-foreground">10% de comissão +50 QP</p>
                </div>
              </div>
            </Card>

            {/* Link + share */}
            {stats && (
              <div className="space-y-3">
                <label className="text-sm font-medium">Seu link de convite:</label>
                <div className="flex gap-2">
                  <input
                    type="text" readOnly value={referralLink}
                    className="flex-1 px-3 py-2 rounded-md border bg-background text-sm font-mono"
                  />
                  <Button onClick={copyLink} size="icon" variant="outline">
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button onClick={shareWhatsApp} className="flex-1 bg-green-600 hover:bg-green-700 gap-2">
                    <Share2 className="w-4 h-4" /> WhatsApp
                  </Button>
                  <Button onClick={shareTwitter} variant="outline" className="flex-1 gap-2">
                    <ExternalLink className="w-4 h-4" /> Twitter / X
                  </Button>
                  <Button onClick={copyLink} variant="outline" className="flex-1 gap-2">
                    <Copy className="w-4 h-4" /> Copiar
                  </Button>
                </div>
              </div>
            )}

            {/* Stats */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { icon: MousePointer, label: 'Cliques', value: stats.clicks, color: '' },
                  { icon: Users, label: 'Cadastros', value: stats.conversions, color: '' },
                  { icon: DollarSign, label: 'Comissões', value: `R$ ${stats.totalCommissions.toFixed(2)}`, color: 'text-green-600' },
                  { icon: DollarSign, label: 'Pendente', value: `R$ ${stats.pendingCommissions.toFixed(2)}`, color: 'text-yellow-600' },
                ].map(({ icon: Icon, label, value, color }) => (
                  <Card key={label} className="p-4">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <p className={`text-xl font-bold ${color}`}>{value}</p>
                  </Card>
                ))}
              </div>
            )}

            {loading && <p className="text-center py-4 text-muted-foreground text-sm">Carregando...</p>}

            <p className="text-xs text-muted-foreground text-center">
              Comissões creditadas automaticamente após a primeira compra do indicado.
              QP contam para sua qualificação no pool mensal.
            </p>
          </TabsContent>

          <TabsContent value="materiais" className="mt-4 space-y-4">
            {materials.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Download className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhum material disponível ainda.</p>
                <p className="text-xs mt-1">O admin está preparando o kit — volte em breve.</p>
              </div>
            ) : (
              <>
                {/* Agrupar por categoria */}
                {[...new Set(materials.map(m => m.category))].map(cat => (
                  <div key={cat}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 capitalize">{cat}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {materials.filter(m => m.category === cat).map(material => (
                        <Card key={material.id} className="p-4 flex gap-3 items-start">
                          {material.thumbnail_url ? (
                            <img src={material.thumbnail_url} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
                              <span className="text-lg">{material.type === 'banner' ? '🖼️' : material.type === 'text' ? '📝' : '📦'}</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-sm font-medium truncate">{material.title}</p>
                              <Badge variant="outline" className="text-xs shrink-0">{TYPE_LABEL[material.type] || material.type}</Badge>
                            </div>
                            {material.description && (
                              <p className="text-xs text-muted-foreground line-clamp-2">{material.description}</p>
                            )}
                            {material.file_url ? (
                              <a href={material.file_url} target="_blank" rel="noopener noreferrer">
                                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs gap-1">
                                  <Download className="w-3 h-3" /> Baixar
                                </Button>
                              </a>
                            ) : (
                              <p className="text-xs text-muted-foreground mt-1 italic">Em breve</p>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
