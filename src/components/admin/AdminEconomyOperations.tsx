import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle2, Coins, DollarSign, RefreshCw, ShieldCheck, Users, XCircle } from "lucide-react";

interface ReconciliationRun {
  id: string;
  run_at: string;
  period: string | null;
  wallets_ok: number;
  wallets_drift: number;
  total_drift: number;
  cycles_ok: number;
  cycles_drift: number;
  status: 'ok' | 'warning' | 'error';
  details: {
    wallet_issues?: Array<{
      user_id: string;
      wallet_id: string;
      balance_stored: number;
      balance_ledger: number;
      drift: number;
    }>;
    cycle_issues?: Array<{
      cycle_id: string;
      year_month: string;
      distributed_stored: number;
      distributed_from_txs: number;
      drift: number;
    }>;
  };
}

interface WalletLedgerEntry {
  user_id: string;
  wallet_id: string;
  balance_stored: number;
  balance_from_ledger: number;
  drift: number;
  tx_count: number;
  credit_count: number;
  debit_count: number;
  total_credited: number;
  total_debited: number;
  last_tx_at: string | null;
}

type Section = "overview" | "revenue" | "audit";

function currentCycleMonth() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "numeric" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value?.padStart(2, "0")}`;
}

export function AdminEconomyOperations({ section, poolPercentage }: { section: Section; poolPercentage: number }) {
  const [rbm, setRbm] = useState(0);
  const [prm, setPrm] = useState(0);
  const [totalCyclePoints, setTotalCyclePoints] = useState(0);
  const [cycleUsersCount, setCycleUsersCount] = useState(0);
  const [manualBonus, setManualBonus] = useState("");
  const [bonusDescription, setBonusDescription] = useState("");
  const [addingBonus, setAddingBonus] = useState(false);
  const [revenueHistory, setRevenueHistory] = useState<any[]>([]);
  const [reconciliationRuns, setReconciliationRuns] = useState<ReconciliationRun[]>([]);
  const [walletLedger, setWalletLedger] = useState<WalletLedgerEntry[]>([]);
  const [runningReconciliation, setRunningReconciliation] = useState(false);
  const [previewPercentage, setPreviewPercentage] = useState(poolPercentage);

  useEffect(() => {
    if (section === "audit") void fetchAuditData();
    else void fetchEconomyData();
  }, [section]);

  useEffect(() => {
    if (section !== "audit") return;
    const channel = supabase.channel("reconciliation-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reconciliation_runs", filter: "status=neq.ok" }, (payload) => {
        const run = payload.new as ReconciliationRun;
        if (run.status !== "ok") {
          toast.error(`Reconciliação detectou divergência (${run.status}): R$ ${Number(run.total_drift).toFixed(2)} em ${run.wallets_drift} wallet(s)`, { duration: 10000 });
          void fetchAuditData();
        }
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [section]);

  const fetchEconomyData = async () => {
    try {
      const yearMonth = currentCycleMonth();
      const [previewResult, revenueResult] = await Promise.all([
        supabase.rpc("get_economic_cycle_preview_v1", { p_year_month: yearMonth }),
        supabase.from("revenue_entries").select("*").eq("year_month", yearMonth).order("created_at", { ascending: false }),
      ]);
      if (previewResult.error) throw previewResult.error;
      if (revenueResult.error) throw revenueResult.error;
      const preview = previewResult.data as any;
      setRevenueHistory(revenueResult.data || []);
      setPreviewPercentage(Number(preview?.pool_percentage ?? poolPercentage));
      setRbm(Number(preview?.eligible_net_revenue ?? 0));
      setPrm(Number(preview?.pool_amount ?? 0));
      setTotalCyclePoints(Number(preview?.total_points ?? 0));
      setCycleUsersCount(Number(preview?.participants ?? 0));
    } catch (error: any) {
      toast.error(`Erro ao carregar economia: ${error.message}`);
    }
  };

  const fetchAuditData = async () => {
    try {
      const [runsRes, ledgerRes] = await Promise.all([
        supabase.from("reconciliation_runs").select("*").order("run_at", { ascending: false }).limit(10),
        supabase.from("v_wallet_ledger").select("*").order("drift", { ascending: false }),
      ]);
      if (runsRes.error) throw runsRes.error;
      if (ledgerRes.error) throw ledgerRes.error;
      setReconciliationRuns((runsRes.data as ReconciliationRun[]) || []);
      setWalletLedger((ledgerRes.data as WalletLedgerEntry[]) || []);
    } catch (error: any) {
      toast.error(`Erro ao carregar auditoria: ${error.message}`);
    }
  };

  const handleRunReconciliation = async () => {
    setRunningReconciliation(true);
    try {
      const { data, error } = await supabase.rpc("run_reconciliation_v1", { p_period: null });
      if (error) throw error;
      const result = data as { status?: string } | null;
      toast.success(`Reconciliação concluída: ${result?.status === "ok" ? "OK" : result?.status === "warning" ? "Atenção" : "Erro"}`);
      await fetchAuditData();
    } catch (error: any) {
      toast.error(`Erro ao executar reconciliação: ${error.message}`);
    } finally {
      setRunningReconciliation(false);
    }
  };

  const handleAddManualBonus = async () => {
    const amount = Number(manualBonus);
    if (!Number.isFinite(amount) || amount <= 0 || !bonusDescription.trim()) {
      toast.error("Informe um valor maior que zero e uma justificativa.");
      return;
    }
    setAddingBonus(true);
    try {
      const { error } = await supabase.rpc("record_manual_eligible_revenue_v1" as any, {
        p_amount: amount,
        p_description: bonusDescription.trim(),
        p_reason: bonusDescription.trim(),
      } as any);
      if (error) throw error;
      toast.success(`Receita elegível de R$ ${amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} registrada.`);
      setManualBonus("");
      setBonusDescription("");
      await fetchEconomyData();
    } catch (error: any) {
      toast.error(`Erro ao registrar receita: ${error.message}`);
    } finally {
      setAddingBonus(false);
    }
  };

  if (section === "overview") return <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <DollarSign className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Receita Líquida Elegível</p>
                    <h3 className="text-2xl font-bold">
                      R$ {rbm.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </h3>
                    <p className="text-xs text-muted-foreground">Mês atual</p>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-accent/10 rounded-lg">
                    <Coins className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Pool estimado</p>
                    <h3 className="text-2xl font-bold">
                      R$ {prm.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </h3>
                    <p className="text-xs text-muted-foreground">{previewPercentage}% da receita</p>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-muted rounded-lg">
                    <Activity className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Points</p>
                    <h3 className="text-2xl font-bold">{totalCyclePoints.toLocaleString('pt-BR')}</h3>
                    <p className="text-xs text-muted-foreground">Total no ciclo</p>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-muted rounded-lg">
                    <Users className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Usuários no Pool</p>
                    <h3 className="text-2xl font-bold">{cycleUsersCount}</h3>
                    <p className="text-xs text-muted-foreground">Com Points este mês</p>
                  </div>
                </div>
              </Card>
            </div>

    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-2">Como o pool é calculado</h3>
      <p className="text-sm text-muted-foreground">O pool estimado corresponde a {previewPercentage}% da receita líquida elegível do ciclo. Os valores são confirmados no fechamento mensal.</p>
      <p className="mt-3 text-sm">Média simples estimada por participante: <strong>R$ {cycleUsersCount ? (prm / cycleUsersCount).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "0,00"}</strong></p>
    </Card>
  </div>;

  if (section === "revenue") return <div className="space-y-6">
            {/* Manual Bonus Injection */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-2">Registrar receita elegível manual</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Registre uma receita líquida elegível confirmada. O pool recebe apenas o percentual configurado; a operação exige justificativa e fica auditada.
              </p>
              <div className="grid gap-4 md:grid-cols-3 items-end">
                <div>
                  <label className="text-sm font-medium">Valor (R$)</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Ex: 50000"
                    value={manualBonus}
                    onChange={(e) => setManualBonus(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Descrição e justificativa</label>
                  <Input
                    placeholder="Ex: Ação de marketing março"
                    value={bonusDescription}
                    onChange={(e) => setBonusDescription(e.target.value)}
                  />
                </div>
                <div>
                  <Button onClick={handleAddManualBonus} disabled={addingBonus || !manualBonus || !bonusDescription.trim()}>
                    {addingBonus ? 'Registrando...' : 'Registrar receita'}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Revenue History */}
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Histórico de Receitas do Mês</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueHistory.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhuma receita registrada neste mês.</TableCell></TableRow>}
                    {revenueHistory.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-muted-foreground">
                          {new Date(entry.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {entry.revenue_type === 'other' ? 'Receita manual' : entry.revenue_type?.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {(entry.metadata as any)?.description || '—'}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          R$ {parseFloat(String(entry.net_eligible_amount || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

  </div>;

  return <div className="space-y-6">
            {/* Status da última reconciliação */}
            {(() => {
              const last = reconciliationRuns[0];
              const statusConfig = {
                ok:      { icon: CheckCircle2, color: 'text-green-600',  bg: 'bg-green-50 border-green-200',  label: 'Sistema Íntegro' },
                warning: { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200', label: 'Atenção' },
                error:   { icon: XCircle,       color: 'text-red-600',    bg: 'bg-red-50 border-red-200',       label: 'Divergência Detectada' },
              };
              const cfg = last ? statusConfig[last.status] : null;
              const Icon = cfg?.icon ?? ShieldCheck;
              return (
                <Card className={`p-6 border-2 ${cfg ? cfg.bg : 'bg-muted/30'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-full ${cfg ? cfg.bg : 'bg-muted'}`}>
                        <Icon className={`h-8 w-8 ${cfg ? cfg.color : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <h3 className={`text-xl font-bold ${cfg ? cfg.color : 'text-muted-foreground'}`}>
                          {cfg ? cfg.label : 'Nenhuma reconciliação executada'}
                        </h3>
                        {last && (
                          <p className="text-sm text-muted-foreground mt-0.5">
                            Última verificação: {new Date(last.run_at).toLocaleString('pt-BR')}
                            {' · '}{last.wallets_ok + last.wallets_drift} wallets verificadas
                            {' · '}{last.cycles_ok + last.cycles_drift} ciclos verificados
                          </p>
                        )}
                        {last?.wallets_drift > 0 && (
                          <p className="text-sm text-red-600 font-medium mt-1">
                            {last.wallets_drift} wallet(s) com drift · Total: R$ {Number(last.total_drift).toFixed(2)}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      onClick={handleRunReconciliation}
                      disabled={runningReconciliation}
                      variant="outline"
                      className="gap-2"
                    >
                      <RefreshCw className={`h-4 w-4 ${runningReconciliation ? 'animate-spin' : ''}`} />
                      {runningReconciliation ? 'Verificando...' : 'Rodar Agora'}
                    </Button>
                  </div>

                  {/* Issues detalhadas se houver */}
                  {last?.details?.wallet_issues && last.details.wallet_issues.length > 0 && (
                    <div className="mt-4 p-4 rounded-lg bg-red-100 border border-red-200">
                      <p className="text-sm font-semibold text-red-700 mb-2">Wallets com divergência:</p>
                      {last.details.wallet_issues.map((issue, i) => (
                        <div key={i} className="text-xs text-red-600 font-mono">
                          user {issue.user_id.slice(0, 8)}… · stored: R${Number(issue.balance_stored).toFixed(2)} · ledger: R${Number(issue.balance_ledger).toFixed(2)} · drift: R${Number(issue.drift).toFixed(2)}
                        </div>
                      ))}
                    </div>
                  )}
                  {last?.details?.cycle_issues && last.details.cycle_issues.length > 0 && (
                    <div className="mt-4 p-4 rounded-lg bg-yellow-100 border border-yellow-200">
                      <p className="text-sm font-semibold text-yellow-700 mb-2">Ciclos com divergência:</p>
                      {last.details.cycle_issues.map((issue, i) => (
                        <div key={i} className="text-xs text-yellow-700 font-mono">
                          {issue.year_month} · distribuído: R${Number(issue.distributed_stored).toFixed(2)} · txs: R${Number(issue.distributed_from_txs).toFixed(2)} · drift: R${Number(issue.drift).toFixed(2)}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })()}

            {/* Ledger — estado de todas as wallets */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">Ledger — Integridade de Saldos</h3>
                  <p className="text-sm text-muted-foreground">
                    Drift = balance armazenado − soma das transações. Deve ser sempre R$0,00.
                  </p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead className="text-right">Saldo Armazenado</TableHead>
                    <TableHead className="text-right">Saldo pelo Ledger</TableHead>
                    <TableHead className="text-right">Drift</TableHead>
                    <TableHead className="text-right">Txs</TableHead>
                    <TableHead className="text-right">Última Tx</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {walletLedger.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Nenhuma wallet encontrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    walletLedger.map((entry) => {
                      const hasDrift = Math.abs(Number(entry.drift)) > 0.01;
                      return (
                        <TableRow key={entry.wallet_id} className={hasDrift ? 'bg-red-50' : ''}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {entry.user_id.slice(0, 8)}…
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            R$ {Number(entry.balance_stored).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            R$ {Number(entry.balance_from_ledger).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className={`text-right font-semibold ${hasDrift ? 'text-red-600' : 'text-green-600'}`}>
                            {hasDrift ? `R$ ${Number(entry.drift).toFixed(4)}` : '—'}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground text-sm">
                            {entry.tx_count}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground text-sm">
                            {entry.last_tx_at
                              ? new Date(entry.last_tx_at).toLocaleDateString('pt-BR')
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {hasDrift ? (
                              <Badge variant="destructive" className="gap-1">
                                <XCircle className="w-3 h-3" /> Divergente
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-green-700 border-green-300">
                                <CheckCircle2 className="w-3 h-3" /> OK
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Card>

            {/* Histórico de execuções */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Histórico de Reconciliações</h3>
              {reconciliationRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Nenhuma execução ainda. Clique em "Rodar Agora" para começar.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data / Hora</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead className="text-right">Wallets OK</TableHead>
                      <TableHead className="text-right">Wallets c/ drift</TableHead>
                      <TableHead className="text-right">Ciclos OK</TableHead>
                      <TableHead className="text-right">Drift Total</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconciliationRuns.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="text-sm">
                          {new Date(run.run_at).toLocaleString('pt-BR')}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {run.period ?? 'Completo'}
                        </TableCell>
                        <TableCell className="text-right text-green-700">
                          {run.wallets_ok}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${run.wallets_drift > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {run.wallets_drift}
                        </TableCell>
                        <TableCell className="text-right text-green-700">
                          {run.cycles_ok}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${Number(run.total_drift) > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {Number(run.total_drift) > 0 ? `R$ ${Number(run.total_drift).toFixed(4)}` : '—'}
                        </TableCell>
                        <TableCell>
                          {run.status === 'ok' && (
                            <Badge variant="outline" className="text-green-700 border-green-300 gap-1">
                              <CheckCircle2 className="w-3 h-3" /> OK
                            </Badge>
                          )}
                          {run.status === 'warning' && (
                            <Badge variant="outline" className="text-yellow-700 border-yellow-400 gap-1">
                              <AlertTriangle className="w-3 h-3" /> Warning
                            </Badge>
                          )}
                          {run.status === 'error' && (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="w-3 h-3" /> Erro
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

  </div>;
}
