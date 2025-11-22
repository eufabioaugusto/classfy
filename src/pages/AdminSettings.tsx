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
        .eq("config_key", "earnings_maturation_days")
        .single();

      if (error) throw error;
      if (data) {
        const configValue = data.config_value as { days: number };
        setMaturationDays(configValue.days);
      }
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
      const { error } = await supabase
        .from("system_config")
        .update({
          config_value: { days: maturationDays },
          updated_at: new Date().toISOString(),
        })
        .eq("config_key", "earnings_maturation_days");

      if (error) throw error;

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
