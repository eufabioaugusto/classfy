import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Copy, Gift, Users, MousePointer, DollarSign } from "lucide-react";
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

export function AffiliateModal({ open, onOpenChange }: AffiliateModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ReferralStats | null>(null);

  useEffect(() => {
    if (open && user) {
      fetchReferralData();
    }
  }, [open, user]);

  const fetchReferralData = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Get or create referral link
      let { data: link, error: linkError } = await supabase
        .from("referral_links")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (linkError && linkError.code === "PGRST116") {
        // Create new referral link
        const code = generateReferralCode();
        const { data: newLink, error: createError } = await supabase
          .from("referral_links")
          .insert({ user_id: user.id, referral_code: code })
          .select()
          .single();

        if (createError) throw createError;
        link = newLink;
      } else if (linkError) {
        throw linkError;
      }

      // Get commissions stats
      const { data: commissions } = await supabase
        .from("referral_commissions")
        .select("commission_amount, status")
        .eq("referrer_id", user.id);

      const totalCommissions = commissions
        ?.filter(c => c.status === "paid")
        .reduce((sum, c) => sum + Number(c.commission_amount), 0) || 0;

      const pendingCommissions = commissions
        ?.filter(c => c.status === "pending")
        .reduce((sum, c) => sum + Number(c.commission_amount), 0) || 0;

      setStats({
        code: link!.referral_code,
        clicks: link!.total_clicks || 0,
        conversions: link!.total_conversions || 0,
        totalCommissions,
        pendingCommissions,
      });
    } catch (error) {
      console.error("Error fetching referral data:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os dados do programa de afiliados.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const generateReferralCode = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const copyLink = () => {
    if (!stats) return;
    const link = `${window.location.origin}?ref=${stats.code}`;
    navigator.clipboard.writeText(link);
    toast({
      title: "Link copiado!",
      description: "O link de convite foi copiado para a área de transferência.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Gift className="w-6 h-6 text-primary" />
            Ganhe Comissões
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Como funciona */}
          <Card className="p-4 bg-muted/50">
            <h3 className="font-semibold mb-3">Como funciona:</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="text-lg">📤</span>
                <span>Compartilhe seu link de convite único</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg">👥</span>
                <span>Pessoa se cadastra usando seu link</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg">💰</span>
                <span>Você ganha 10% da primeira compra dela</span>
              </div>
            </div>
          </Card>

          {/* Link de convite */}
          {stats && (
            <div>
              <label className="text-sm font-medium mb-2 block">
                Seu link de convite:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}?ref=${stats.code}`}
                  className="flex-1 px-3 py-2 rounded-md border bg-background text-sm"
                />
                <Button onClick={copyLink} size="icon">
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Estatísticas */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MousePointer className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Cliques</span>
                </div>
                <p className="text-2xl font-bold">{stats.clicks}</p>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Cadastros</span>
                </div>
                <p className="text-2xl font-bold">{stats.conversions}</p>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-success" />
                  <span className="text-xs text-muted-foreground">Ganhos</span>
                </div>
                <p className="text-2xl font-bold text-success">
                  R$ {stats.totalCommissions.toFixed(2)}
                </p>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-warning" />
                  <span className="text-xs text-muted-foreground">Pendente</span>
                </div>
                <p className="text-2xl font-bold text-warning">
                  R$ {stats.pendingCommissions.toFixed(2)}
                </p>
              </Card>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="text-center py-8 text-muted-foreground">
              Carregando dados...
            </div>
          )}

          {/* Rodapé */}
          <p className="text-xs text-muted-foreground text-center">
            As comissões são creditadas automaticamente após a primeira compra do
            usuário indicado.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
