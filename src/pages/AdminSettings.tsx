import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Save, DollarSign, CalendarClock, Play, CheckCircle, AlertCircle } from "lucide-react";

export default function AdminSettings() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closingCycle, setClosingCycle] = useState(false);
  const [maturationDays, setMaturationDays] = useState(7);
  const [minWithdrawalAmount, setMinWithdrawalAmount] = useState(10);
  const [lastCycle, setLastCycle] = useState<any>(null);
  const [cycleYearMonth, setCycleYearMonth] = useState("");

  useEffect(() => {
    if (role === "admin") {
      fetchConfig();
      fetchLastCycle();
    }
  }, [role]);

  const fetchConfig = async () => {
    try {
      const { data, error } = await supabase
        .from("system_config")
        .select("*")
        .in("config_key", ["earnings_maturation_days", "minimum_withdrawal_amount"]);

      if (error) throw error;
      
      data?.forEach((config) => {
        const configValue = config.config_value as any;
        if (config.config_key === "earnings_maturation_days") {
          setMaturationDays(configValue.days);
        } else if (config.config_key === "minimum_withdrawal_amount") {
          setMinWithdrawalAmount(configValue.amount);
        }
      });
    } catch (error: any) {
      toast({
        title: "Erro ao carregar configurações",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchLastCycle = async () => {
    try {
      const { data } = await supabase
        .from("economic_cycles")
        .select("*")
        .order("year_month", { ascending: false })
        .limit(1)
        .maybeSingle();
      setLastCycle(data);
      // Default to previous month
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      setCycleYearMonth(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = [
        {
          config_key: "earnings_maturation_days",
          config_value: { days: maturationDays },
        },
        {
          config_key: "minimum_withdrawal_amount",
          config_value: { amount: minWithdrawalAmount },
        },
      ];

      for (const update of updates) {
        const { error } = await supabase
          .from("system_config")
          .update({
            config_value: update.config_value,
            updated_at: new Date().toISOString(),
          })
          .eq("config_key", update.config_key);

        if (error) throw error;
      }

      toast({
        title: "Configurações salvas!",
        description: "As alterações foram aplicadas com sucesso.",
      });
    } catch (error: any) {
      toast({
        title: "Erro ao salvar",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCloseCycle = async () => {
    if (!cycleYearMonth) return;
    const confirmed = window.confirm(
      `Tem certeza que deseja fechar o ciclo ${cycleYearMonth}? Isso distribuirá o pool de recompensas para todos os usuários elegíveis.`
    );
    if (!confirmed) return;

    setClosingCycle(true);
    try {
      const { data, error } = await supabase.functions.invoke("close-economic-cycle", {
        body: { year_month: cycleYearMonth },
      });

      if (error) throw error;

      toast({
        title: "Ciclo fechado com sucesso! ✅",
        description: `RBM: R$ ${data.rbm?.toFixed(2)} | PRM: R$ ${data.prm?.toFixed(2)} | ${data.users_paid} usuários pagos | Distribuído: R$ ${data.distributed_amount?.toFixed(2)}`,
      });
      fetchLastCycle();
    } catch (error: any) {
      toast({
        title: "Erro ao fechar ciclo",
        description: error.message || "Verifique os logs para mais detalhes.",
        variant: "destructive",
      });
    } finally {
      setClosingCycle(false);
    }
  };

  if (role !== 'admin') return <Navigate to="/" replace />;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin">
          <Settings className="w-12 h-12 text-accent" />
        </div>
      </div>
    );
  }

  return (
    <AdminLayout title="Configurações">
      <div className="container mx-auto px-4 py-8 space-y-8">

      {/* Economic Cycle Management */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <CalendarClock className="w-6 h-6 text-accent" />
          <h2 className="text-2xl font-bold">Ciclo Econômico (PRM)</h2>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            O CRON automático executa no <strong>dia 1 de cada mês às 03:00 UTC</strong>. 
            Use o botão abaixo como fallback manual caso necessário.
          </p>

          {lastCycle && (
            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="font-semibold text-sm">Último Ciclo: {lastCycle.year_month}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <span className={lastCycle.status === "closed" ? "text-green-500" : "text-yellow-500"}>
                    {lastCycle.status === "closed" ? "Fechado ✅" : "Aberto 🟡"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">RBM:</span>{" "}
                  R$ {parseFloat(lastCycle.rbm || 0).toFixed(2)}
                </div>
                <div>
                  <span className="text-muted-foreground">PRM:</span>{" "}
                  R$ {parseFloat(lastCycle.prm || 0).toFixed(2)}
                </div>
                <div>
                  <span className="text-muted-foreground">Distribuído:</span>{" "}
                  R$ {parseFloat(lastCycle.distributed_amount || 0).toFixed(2)}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-end gap-3">
            <div className="space-y-2 flex-1">
              <Label htmlFor="cycleMonth">Mês do Ciclo (YYYY-MM)</Label>
              <Input
                id="cycleMonth"
                value={cycleYearMonth}
                onChange={(e) => setCycleYearMonth(e.target.value)}
                placeholder="2026-02"
              />
            </div>
            <Button
              onClick={handleCloseCycle}
              disabled={closingCycle || !cycleYearMonth}
              variant="default"
              className="min-w-[200px]"
            >
              {closingCycle ? (
                <>
                  <Settings className="w-4 h-4 mr-2 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Fechar Ciclo Manualmente
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Financial Settings */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <DollarSign className="w-6 h-6 text-accent" />
          <h2 className="text-2xl font-bold">Configurações Financeiras</h2>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="maturation">
              Período de Maturação (dias)
            </Label>
            <Input
              id="maturation"
              type="number"
              min="0"
              max="365"
              value={maturationDays}
              onChange={(e) => setMaturationDays(parseInt(e.target.value))}
            />
            <p className="text-sm text-muted-foreground">
              Define quantos dias os ganhos precisam maturar antes de poderem ser sacados.
              Período atual: <strong>{maturationDays} dias</strong>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="minAmount">
              Valor Mínimo para Saque (R$)
            </Label>
            <Input
              id="minAmount"
              type="number"
              min="0"
              step="0.01"
              value={minWithdrawalAmount}
              onChange={(e) => setMinWithdrawalAmount(parseFloat(e.target.value))}
            />
            <p className="text-sm text-muted-foreground">
              Define o valor mínimo que um usuário pode solicitar para saque.
              Valor atual: <strong>R$ {minWithdrawalAmount.toFixed(2)}</strong>
            </p>
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full">
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Salvando..." : "Salvar Configurações"}
          </Button>
        </div>
      </Card>

      {/* Future Settings Sections */}
      <Card className="p-6 opacity-60">
        <h2 className="text-2xl font-bold mb-4">Configurações de Plataforma</h2>
        <p className="text-muted-foreground">
          Em breve: configurações de taxas, limites de upload, políticas de conteúdo, etc.
        </p>
      </Card>

      <Card className="p-6 opacity-60">
        <h2 className="text-2xl font-bold mb-4">Configurações de Recompensas</h2>
        <p className="text-muted-foreground">
          Em breve: ajuste de multiplicadores, valores base de recompensas, etc.
        </p>
      </Card>
      </div>
    </AdminLayout>
  );
}
