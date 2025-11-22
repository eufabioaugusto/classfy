import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Save, DollarSign } from "lucide-react";

export default function AdminSettings() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [maturationDays, setMaturationDays] = useState(7);
  const [minWithdrawalAmount, setMinWithdrawalAmount] = useState(10);

  useEffect(() => {
    if (role !== "admin") {
      navigate("/");
      return;
    }
    fetchConfig();
  }, [role, navigate]);

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
    <div className="container mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-4xl font-bold">Configurações do Sistema</h1>
        <p className="text-muted-foreground mt-2">
          Gerencie configurações globais da plataforma
        </p>
      </div>

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
  );
}
