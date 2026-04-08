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
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle, XCircle, Clock, DollarSign, Settings } from "lucide-react";

interface WithdrawRequest {
  id: string;
  user_id: string;
  amount: number;
  pix_key: string;
  status: string;
  created_at: string;
  admin_notes: string | null;
  profiles: {
    display_name: string;
    avatar_url: string | null;
  } | null;
}

export default function AdminWithdrawals() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [withdrawals, setWithdrawals] = useState<WithdrawRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<WithdrawRequest | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [processing, setProcessing] = useState(false);
  const [maturationDays, setMaturationDays] = useState(7);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [updatingConfig, setUpdatingConfig] = useState(false);

  useEffect(() => {
    if (role === "admin") {
      fetchData();
    }
  }, [role]);

  const fetchData = async () => {
    try {
      const [withdrawalsRes, configRes] = await Promise.all([
        supabase
          .from("withdraw_requests")
          .select("*, profiles!withdraw_requests_user_id_fkey(display_name, avatar_url)")
          .order("created_at", { ascending: false }),
        supabase
          .from("system_config")
          .select("*")
          .eq("config_key", "earnings_maturation_days")
          .single(),
      ]);

      if (withdrawalsRes.error) throw withdrawalsRes.error;
      setWithdrawals(withdrawalsRes.data as any);

      if (configRes.data) {
        const configValue = configRes.data.config_value as { days: number };
        setMaturationDays(configValue.days);
      }
    } catch (error: any) {
      toast({
        title: "Erro ao carregar dados",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateConfig = async () => {
    setUpdatingConfig(true);
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
        title: "Configuração atualizada!",
        description: `Período de maturação alterado para ${maturationDays} dias.`,
      });
      setShowConfigModal(false);
    } catch (error: any) {
      toast({
        title: "Erro ao atualizar configuração",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUpdatingConfig(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedRequest) return;
    setProcessing(true);

    try {
      // Get current wallet data
      const { data: walletData, error: walletFetchError } = await supabase
        .from("wallets")
        .select("balance, total_withdrawn")
        .eq("user_id", selectedRequest.user_id)
        .single();

      if (walletFetchError || !walletData) {
        throw new Error("Erro ao buscar carteira do usuário");
      }

      // Check if user has enough balance
      if (walletData.balance < selectedRequest.amount) {
        throw new Error("Saldo insuficiente na carteira do usuário");
      }

      // Update wallet - subtract the amount from balance and add to total_withdrawn
      const { error: walletError } = await supabase
        .from("wallets")
        .update({
          balance: walletData.balance - selectedRequest.amount,
          total_withdrawn: walletData.total_withdrawn + selectedRequest.amount,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", selectedRequest.user_id);

      if (walletError) throw walletError;

      // Update withdrawal request
      const { error: updateError } = await supabase
        .from("withdraw_requests")
        .update({
          status: "approved",
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          admin_notes: adminNotes,
        })
        .eq("id", selectedRequest.id);

      if (updateError) throw updateError;

      // Create notification
      await supabase.from("notifications").insert({
        user_id: selectedRequest.user_id,
        type: "withdraw",
        title: "Saque Aprovado!",
        message: `Seu saque de R$ ${selectedRequest.amount.toFixed(2)} foi aprovado e processado. Valor deduzido do saldo.`,
      });

      // Send email
      supabase.functions.invoke("send-transactional-email", {
        body: {
          type: "withdrawal_approved",
          user_id: selectedRequest.user_id,
          data: { amount: selectedRequest.amount, pix_key: selectedRequest.pix_key, admin_notes: adminNotes }
        }
      }).catch(console.error);

      toast({
        title: "Saque aprovado!",
        description: `Pagamento de R$ ${selectedRequest.amount.toFixed(2)} processado. Carteira atualizada.`,
      });

      setSelectedRequest(null);
      setAdminNotes("");
      fetchData();
    } catch (error: any) {
      console.error("Erro ao aprovar saque:", error);
      toast({
        title: "Erro ao aprovar saque",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    setProcessing(true);

    try {
      const { error } = await supabase
        .from("withdraw_requests")
        .update({
          status: "rejected",
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          admin_notes: adminNotes,
        })
        .eq("id", selectedRequest.id);

      if (error) throw error;

      // Create notification
      await supabase.from("notifications").insert({
        user_id: selectedRequest.user_id,
        type: "withdraw",
        title: "Saque Recusado",
        message: `Seu saque de R$ ${selectedRequest.amount.toFixed(2)} foi recusado. ${adminNotes ? `Motivo: ${adminNotes}` : ""}`,
      });

      // Send email
      supabase.functions.invoke("send-transactional-email", {
        body: {
          type: "withdrawal_rejected",
          user_id: selectedRequest.user_id,
          data: { amount: selectedRequest.amount, admin_notes: adminNotes }
        }
      }).catch(console.error);

      toast({
        title: "Saque recusado",
        description: "O usuário foi notificado.",
      });

      setSelectedRequest(null);
      setAdminNotes("");
      fetchData();
    } catch (error: any) {
      toast({
        title: "Erro ao recusar saque",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Pendente
          </Badge>
        );
      case "approved":
        return (
          <Badge className="flex items-center gap-1 bg-green-500">
            <CheckCircle className="w-3 h-3" />
            Aprovado
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            Recusado
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  if (role !== 'admin') return <Navigate to="/" replace />;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin">
          <DollarSign className="w-12 h-12 text-accent" />
        </div>
      </div>
    );
  }

  return (
    <AdminLayout title="Saques">
      <div className="container mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            onClick={() => setShowConfigModal(true)}
            className="flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            Configurações
          </Button>
        </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Pendentes</p>
              <p className="text-3xl font-bold">
                {withdrawals.filter((w) => w.status === "pending").length}
              </p>
            </div>
            <Clock className="w-10 h-10 text-yellow-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Aprovados</p>
              <p className="text-3xl font-bold">
                {withdrawals.filter((w) => w.status === "approved").length}
              </p>
            </div>
            <CheckCircle className="w-10 h-10 text-green-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Recusados</p>
              <p className="text-3xl font-bold">
                {withdrawals.filter((w) => w.status === "rejected").length}
              </p>
            </div>
            <XCircle className="w-10 h-10 text-red-500" />
          </div>
        </Card>
      </div>

      {/* Withdrawals Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Chave PIX</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {withdrawals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Nenhuma solicitação de saque encontrada
                </TableCell>
              </TableRow>
            ) : (
              withdrawals.map((withdrawal) => (
                <TableRow key={withdrawal.id}>
                  <TableCell className="font-medium">
                    {withdrawal.profiles?.display_name || "Usuário"}
                  </TableCell>
                  <TableCell>R$ {withdrawal.amount.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-sm">{withdrawal.pix_key}</TableCell>
                  <TableCell>
                    {new Date(withdrawal.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>{getStatusBadge(withdrawal.status)}</TableCell>
                  <TableCell>
                    {withdrawal.status === "pending" && (
                      <Button
                        size="sm"
                        onClick={() => setSelectedRequest(withdrawal)}
                      >
                        Analisar
                      </Button>
                    )}
                    {withdrawal.status !== "pending" && withdrawal.admin_notes && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          toast({
                            title: "Observações",
                            description: withdrawal.admin_notes,
                          });
                        }}
                      >
                        Ver Notas
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Review Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Analisar Solicitação de Saque</DialogTitle>
            <DialogDescription>
              Revise os detalhes e aprove ou recuse a solicitação
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Usuário:</span>
                  <span className="font-medium">{selectedRequest.profiles?.display_name || "Usuário"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Valor:</span>
                  <span className="font-bold text-lg">R$ {selectedRequest.amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Chave PIX:</span>
                  <span className="font-mono text-sm">{selectedRequest.pix_key}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Data:</span>
                  <span>{new Date(selectedRequest.created_at).toLocaleString("pt-BR")}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Observações (opcional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Adicione observações sobre esta solicitação..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSelectedRequest(null);
                setAdminNotes("");
              }}
              disabled={processing}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={processing}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Recusar
            </Button>
            <Button onClick={handleApprove} disabled={processing}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Aprovar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Config Dialog */}
      <Dialog open={showConfigModal} onOpenChange={setShowConfigModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurações de Maturação</DialogTitle>
            <DialogDescription>
              Configure o tempo que os ganhos precisam maturar antes de poderem ser sacados
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="maturation">Dias de Maturação</Label>
              <Input
                id="maturation"
                type="number"
                min="0"
                max="365"
                value={maturationDays}
                onChange={(e) => setMaturationDays(parseInt(e.target.value))}
              />
              <p className="text-sm text-muted-foreground">
                Os ganhos só poderão ser sacados após este período desde que foram ganhos.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfigModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateConfig} disabled={updatingConfig}>
              Salvar Configuração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </AdminLayout>
  );
}
