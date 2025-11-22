import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Users,
  Video,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
  Shield,
  Crown,
  FileText,
  Trophy,
  Settings,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface DashboardStats {
  totalUsers: number;
  totalCreators: number;
  totalAdmins: number;
  totalContents: number;
  pendingContents: number;
  approvedContents: number;
  totalWithdrawals: number;
  pendingWithdrawals: number;
  pendingWithdrawalAmount: number;
  totalEarnings: number;
  totalWithdrawn: number;
  pendingCreatorRequests: number;
}

export default function AdminDashboard() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    totalCreators: 0,
    totalAdmins: 0,
    totalContents: 0,
    pendingContents: 0,
    approvedContents: 0,
    totalWithdrawals: 0,
    pendingWithdrawals: 0,
    pendingWithdrawalAmount: 0,
    totalEarnings: 0,
    totalWithdrawn: 0,
    pendingCreatorRequests: 0,
  });

  useEffect(() => {
    if (role !== "admin") {
      navigate("/");
      return;
    }
    fetchDashboardStats();
  }, [role, navigate]);

  const fetchDashboardStats = async () => {
    try {
      const [
        profilesRes,
        rolesRes,
        contentsRes,
        withdrawalsRes,
        walletsRes,
        creatorRequestsRes,
      ] = await Promise.all([
        supabase.from("profiles").select("id"),
        supabase.from("user_roles").select("role"),
        supabase.from("contents").select("status"),
        supabase.from("withdraw_requests").select("status, amount"),
        supabase.from("wallets").select("total_earned, total_withdrawn"),
        supabase.from("creator_requests").select("status"),
      ]);

      const totalUsers = profilesRes.data?.length || 0;
      const creators = rolesRes.data?.filter((r) => r.role === "creator").length || 0;
      const admins = rolesRes.data?.filter((r) => r.role === "admin").length || 0;

      const totalContents = contentsRes.data?.length || 0;
      const pendingContents = contentsRes.data?.filter((c) => c.status === "pending").length || 0;
      const approvedContents = contentsRes.data?.filter((c) => c.status === "approved").length || 0;

      const totalWithdrawals = withdrawalsRes.data?.length || 0;
      const pendingWithdrawals = withdrawalsRes.data?.filter((w) => w.status === "pending").length || 0;
      const pendingWithdrawalAmount = withdrawalsRes.data
        ?.filter((w) => w.status === "pending")
        .reduce((sum, w) => sum + w.amount, 0) || 0;

      const totalEarnings = walletsRes.data?.reduce((sum, w) => sum + w.total_earned, 0) || 0;
      const totalWithdrawn = walletsRes.data?.reduce((sum, w) => sum + w.total_withdrawn, 0) || 0;

      const pendingCreatorRequests = creatorRequestsRes.data?.filter((r) => r.status === "pending").length || 0;

      setStats({
        totalUsers,
        totalCreators: creators,
        totalAdmins: admins,
        totalContents,
        pendingContents,
        approvedContents,
        totalWithdrawals,
        pendingWithdrawals,
        pendingWithdrawalAmount,
        totalEarnings,
        totalWithdrawn,
        pendingCreatorRequests,
      });
    } catch (error: any) {
      toast({
        title: "Erro ao carregar estatísticas",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const QuickAccessCard = ({ 
    title, 
    description, 
    icon: Icon, 
    href, 
    badge 
  }: { 
    title: string; 
    description: string; 
    icon: any; 
    href: string; 
    badge?: number 
  }) => (
    <Card 
      className="p-6 hover:shadow-lg transition-all cursor-pointer group"
      onClick={() => navigate(href)}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-accent" />
            <h3 className="font-semibold">{title}</h3>
            {badge !== undefined && badge > 0 && (
              <Badge variant="destructive">{badge}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-accent transition-colors" />
      </div>
    </Card>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin">
          <TrendingUp className="w-12 h-12 text-accent" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold">Dashboard Administrativo</h1>
        <p className="text-muted-foreground mt-2">
          Visão geral da plataforma e acesso rápido às principais funcionalidades
        </p>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total de Usuários</p>
              <p className="text-3xl font-bold">{stats.totalUsers}</p>
              <div className="flex gap-2 mt-2">
                <Badge variant="secondary" className="text-xs">
                  <Shield className="w-3 h-3 mr-1" />
                  {stats.totalCreators} Creators
                </Badge>
                <Badge className="text-xs bg-red-500">
                  <Crown className="w-3 h-3 mr-1" />
                  {stats.totalAdmins} Admins
                </Badge>
              </div>
            </div>
            <Users className="w-12 h-12 text-blue-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Conteúdos</p>
              <p className="text-3xl font-bold">{stats.totalContents}</p>
              <div className="flex gap-2 mt-2">
                <Badge variant="secondary" className="text-xs">
                  <Clock className="w-3 h-3 mr-1" />
                  {stats.pendingContents} Pendentes
                </Badge>
                <Badge className="text-xs bg-green-500">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  {stats.approvedContents} Aprovados
                </Badge>
              </div>
            </div>
            <Video className="w-12 h-12 text-purple-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Saques</p>
              <p className="text-3xl font-bold">{stats.totalWithdrawals}</p>
              <div className="flex gap-2 mt-2">
                <Badge variant="destructive" className="text-xs">
                  <Clock className="w-3 h-3 mr-1" />
                  {stats.pendingWithdrawals} Pendentes
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                R$ {stats.pendingWithdrawalAmount.toFixed(2)} aguardando
              </p>
            </div>
            <DollarSign className="w-12 h-12 text-green-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Ganhos Totais</p>
              <p className="text-3xl font-bold">R$ {stats.totalEarnings.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-2">
                R$ {stats.totalWithdrawn.toFixed(2)} sacados
              </p>
              <p className="text-xs text-accent">
                R$ {(stats.totalEarnings - stats.totalWithdrawn).toFixed(2)} em carteiras
              </p>
            </div>
            <TrendingUp className="w-12 h-12 text-amber-500" />
          </div>
        </Card>
      </div>

      {/* Pending Actions */}
      {(stats.pendingContents > 0 || stats.pendingWithdrawals > 0 || stats.pendingCreatorRequests > 0) && (
        <div>
          <h2 className="text-2xl font-bold mb-4">Ações Pendentes</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {stats.pendingContents > 0 && (
              <Card className="p-6 border-yellow-500/50 bg-yellow-500/5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Clock className="w-6 h-6 text-yellow-500" />
                    <Badge variant="secondary">{stats.pendingContents}</Badge>
                  </div>
                  <h3 className="font-semibold">Conteúdos para Aprovar</h3>
                  <p className="text-sm text-muted-foreground">
                    {stats.pendingContents} conteúdo{stats.pendingContents > 1 ? 's' : ''} aguardando revisão
                  </p>
                  <Button 
                    className="w-full mt-4" 
                    variant="outline"
                    onClick={() => navigate("/admin/contents")}
                  >
                    Revisar Agora
                  </Button>
                </div>
              </Card>
            )}

            {stats.pendingWithdrawals > 0 && (
              <Card className="p-6 border-green-500/50 bg-green-500/5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <DollarSign className="w-6 h-6 text-green-500" />
                    <Badge variant="secondary">{stats.pendingWithdrawals}</Badge>
                  </div>
                  <h3 className="font-semibold">Saques Pendentes</h3>
                  <p className="text-sm text-muted-foreground">
                    R$ {stats.pendingWithdrawalAmount.toFixed(2)} aguardando aprovação
                  </p>
                  <Button 
                    className="w-full mt-4" 
                    variant="outline"
                    onClick={() => navigate("/admin/withdrawals")}
                  >
                    Processar Saques
                  </Button>
                </div>
              </Card>
            )}

            {stats.pendingCreatorRequests > 0 && (
              <Card className="p-6 border-purple-500/50 bg-purple-500/5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Shield className="w-6 h-6 text-purple-500" />
                    <Badge variant="secondary">{stats.pendingCreatorRequests}</Badge>
                  </div>
                  <h3 className="font-semibold">Solicitações de Creator</h3>
                  <p className="text-sm text-muted-foreground">
                    {stats.pendingCreatorRequests} solicitaç{stats.pendingCreatorRequests > 1 ? 'ões' : 'ão'} para revisar
                  </p>
                  <Button 
                    className="w-full mt-4" 
                    variant="outline"
                    onClick={() => navigate("/admin/creators")}
                  >
                    Analisar Pedidos
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Quick Access */}
      <div>
        <h2 className="text-2xl font-bold mb-4">Acesso Rápido</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <QuickAccessCard
            title="Gerenciar Usuários"
            description="Visualizar e gerenciar todos os usuários"
            icon={Users}
            href="/admin/users"
          />
          
          <QuickAccessCard
            title="Aprovar Creators"
            description="Revisar solicitações de creators"
            icon={Shield}
            href="/admin/creators"
            badge={stats.pendingCreatorRequests}
          />
          
          <QuickAccessCard
            title="Aprovar Conteúdos"
            description="Moderar conteúdos publicados"
            icon={Video}
            href="/admin/contents"
            badge={stats.pendingContents}
          />
          
          <QuickAccessCard
            title="Processar Saques"
            description="Gerenciar solicitações de saque"
            icon={DollarSign}
            href="/admin/withdrawals"
            badge={stats.pendingWithdrawals}
          />
          
          <QuickAccessCard
            title="Gerenciar Recompensas"
            description="Configurar sistema de recompensas"
            icon={Trophy}
            href="/admin/rewards"
          />
          
          <QuickAccessCard
            title="Transcrições"
            description="Gerenciar transcrições de conteúdo"
            icon={FileText}
            href="/admin/transcriptions"
          />
          
          <QuickAccessCard
            title="Configurações"
            description="Configurar parâmetros do sistema"
            icon={Settings}
            href="/admin/settings"
          />
        </div>
      </div>
    </div>
  );
}
