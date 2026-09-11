import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { CalendarClock, DollarSign, Play, Save, Settings } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EconomySettings {
  pool_percentage: number;
  user_points_multipliers: { free: number; pro: number; premium: number };
  reward_maturation_days: { free: number; pro: number; premium: number };
  minimum_withdrawal_amount: number;
  sales_commission_percent: number;
  creator_sales_hold_days: number;
  subscription_grace_period_days: number;
  referral_commission_percent: number;
  approved_content_monthly_limit: number | null;
}

const defaults: EconomySettings = {
  pool_percentage: 40,
  user_points_multipliers: { free: 1, pro: 1.5, premium: 2 },
  reward_maturation_days: { free: 30, pro: 7, premium: 2 },
  minimum_withdrawal_amount: 10,
  sales_commission_percent: 20,
  creator_sales_hold_days: 7,
  subscription_grace_period_days: 3,
  referral_commission_percent: 10,
  approved_content_monthly_limit: null,
};

export default function AdminSettings() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closingCycle, setClosingCycle] = useState(false);
  const [settings, setSettings] = useState<EconomySettings>(defaults);
  const [reason, setReason] = useState("");
  const [lastCycle, setLastCycle] = useState<Record<string, any> | null>(null);
  const [cycleYearMonth, setCycleYearMonth] = useState(previousMonth());

  useEffect(() => {
    if (role === "admin") void fetchData();
  }, [role]);

  const fetchData = async () => {
    try {
      const [settingsResult, cycleResult] = await Promise.all([
        supabase.rpc("get_economic_v1_settings"),
        supabase.from("economic_cycles").select("*").order("year_month", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (settingsResult.error) throw settingsResult.error;
      const value = settingsResult.data as unknown as Partial<EconomySettings>;
      setSettings({
        ...defaults,
        ...value,
        user_points_multipliers: { ...defaults.user_points_multipliers, ...(value?.user_points_multipliers || {}) },
        reward_maturation_days: { ...defaults.reward_maturation_days, ...(value?.reward_maturation_days || {}) },
      });
      setLastCycle(cycleResult.data as Record<string, any> | null);
    } catch (error: any) {
      toast({ title: "Erro ao carregar configurações", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const setNumber = (key: keyof EconomySettings, value: number | null) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!reason.trim()) {
      toast({ title: "Informe o motivo da alteração", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("update_economic_v1_settings", {
        p_value: settings as any,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      setSettings(data as unknown as EconomySettings);
      setReason("");
      toast({ title: "Economia V1 atualizada", description: "Alteração validada e registrada na auditoria." });
    } catch (error: any) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCloseCycle = async () => {
    if (!window.confirm(`Fechar definitivamente o ciclo ${cycleYearMonth}?`)) return;
    setClosingCycle(true);
    try {
      const { data, error } = await supabase.functions.invoke("close-economic-cycle", {
        body: { year_month: cycleYearMonth },
      });
      if (error) throw error;
      toast({
        title: "Ciclo fechado",
        description: `Receita líquida: R$ ${Number(data.eligible_net_revenue || 0).toFixed(2)} · Pool: R$ ${Number(data.pool_amount || 0).toFixed(2)} · ${Number(data.total_points || 0).toLocaleString("pt-BR")} Points`,
      });
      await fetchData();
    } catch (error: any) {
      toast({ title: "Erro ao fechar ciclo", description: error.message, variant: "destructive" });
    } finally {
      setClosingCycle(false);
    }
  };

  if (role !== "admin") return <Navigate to="/" replace />;
  if (loading) return <div className="min-h-screen grid place-items-center"><Settings className="w-10 h-10 animate-spin text-accent" /></div>;

  return (
    <AdminLayout title="Configurações">
      <div className="container mx-auto px-4 py-8 space-y-8">
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <CalendarClock className="w-6 h-6 text-accent" />
            <div><h2 className="text-2xl font-bold">Ciclo econômico</h2><p className="text-sm text-muted-foreground">Points viram um valor definitivo em reais no fechamento mensal.</p></div>
          </div>
          {lastCycle && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 rounded-lg border p-4 text-sm">
              <Metric label="Ciclo" value={String(lastCycle.year_month)} />
              <Metric label="Status" value={lastCycle.status === "closed" ? "Fechado" : "Aberto"} />
              <Metric label="Receita líquida" value={`R$ ${Number(lastCycle.eligible_net_revenue || lastCycle.rbm || 0).toFixed(2)}`} />
              <Metric label="Pool confirmado" value={`R$ ${Number(lastCycle.prm || 0).toFixed(2)}`} />
              <Metric label="Points" value={Number((lastCycle.total_user_points || 0) + (lastCycle.total_creator_points || 0)).toLocaleString("pt-BR")} />
            </div>
          )}
          <div className="flex flex-col md:flex-row items-end gap-3">
            <Field label="Mês do ciclo"><Input value={cycleYearMonth} onChange={(event) => setCycleYearMonth(event.target.value)} placeholder="2026-09" /></Field>
            <Button onClick={handleCloseCycle} disabled={closingCycle || !cycleYearMonth} className="md:min-w-[220px]">
              {closingCycle ? <Settings className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              {closingCycle ? "Processando..." : "Fechar ciclo"}
            </Button>
          </div>
        </Card>

        <Card className="p-6 space-y-6">
          <div className="flex items-center gap-3"><DollarSign className="w-6 h-6 text-accent" /><div><h2 className="text-2xl font-bold">Economia Classfy V1</h2><p className="text-sm text-muted-foreground">Fonte única usada pelo backend e pela interface.</p></div></div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            <NumberField label="Pool da receita líquida (%)" value={settings.pool_percentage} min={0} max={100} onChange={(value) => setNumber("pool_percentage", value)} />
            <NumberField label="Saque mínimo (R$)" value={settings.minimum_withdrawal_amount} min={0} step={0.01} onChange={(value) => setNumber("minimum_withdrawal_amount", value)} />
            <NumberField label="Comissão Classfy nas vendas (%)" value={settings.sales_commission_percent} min={0} max={100} onChange={(value) => setNumber("sales_commission_percent", value)} />
            <NumberField label="Hold de venda do Creator (dias)" value={settings.creator_sales_hold_days} min={0} max={365} onChange={(value) => setNumber("creator_sales_hold_days", value)} />
            <NumberField label="Carência da assinatura (dias)" value={settings.subscription_grace_period_days} min={0} max={30} onChange={(value) => setNumber("subscription_grace_period_days", value)} />
            <NumberField label="Comissão de indicação (%)" value={settings.referral_commission_percent} min={0} max={50} onChange={(value) => setNumber("referral_commission_percent", value)} />
            <NumberField label="Teto mensal de conteúdos aprovados" value={settings.approved_content_monthly_limit ?? ""} min={1} placeholder="Sem teto definido" onChange={(value) => setNumber("approved_content_monthly_limit", value === "" ? null : value)} />
          </div>

          <section className="space-y-3"><h3 className="font-semibold">Multiplicador de User Points</h3><div className="grid md:grid-cols-3 gap-4">{(["free", "pro", "premium"] as const).map((plan) => <NumberField key={plan} label={plan.toUpperCase()} value={settings.user_points_multipliers[plan]} min={0} max={10} step={0.1} onChange={(value) => setSettings((current) => ({ ...current, user_points_multipliers: { ...current.user_points_multipliers, [plan]: Number(value) } }))} />)}</div></section>
          <section className="space-y-3"><h3 className="font-semibold">Maturação das recompensas</h3><div className="grid md:grid-cols-3 gap-4">{(["free", "pro", "premium"] as const).map((plan) => <NumberField key={plan} label={`${plan.toUpperCase()} (dias)`} value={settings.reward_maturation_days[plan]} min={0} max={365} onChange={(value) => setSettings((current) => ({ ...current, reward_maturation_days: { ...current.reward_maturation_days, [plan]: Number(value) } }))} />)}</div></section>

          <Field label="Motivo da alteração (obrigatório)"><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: ajuste aprovado para o beta" /></Field>
          <Button onClick={handleSave} disabled={saving} className="w-full"><Save className="w-4 h-4 mr-2" />{saving ? "Salvando..." : "Salvar configuração auditada"}</Button>
        </Card>
      </div>
    </AdminLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2 flex-1"><Label>{label}</Label>{children}</div>;
}

function NumberField({ label, value, onChange, min, max, step = 1, placeholder }: {
  label: string; value: number | string; onChange: (value: number | "") => void;
  min?: number; max?: number; step?: number; placeholder?: string;
}) {
  return <Field label={label}><Input type="number" value={value} min={min} max={max} step={step} placeholder={placeholder} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} /></Field>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{value}</p></div>;
}

function previousMonth() {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
}
