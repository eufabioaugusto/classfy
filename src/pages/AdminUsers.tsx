import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Search, Shield, Crown, User as UserIcon } from "lucide-react";

interface UserData {
  id: string;
  display_name: string;
  avatar_url: string | null;
  plan: string;
  creator_status: string;
  created_at: string;
  user_roles: Array<{ role: string }>;
  wallets: Array<{ balance: number; total_earned: number }> | null;
}

export default function AdminUsers() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserData[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [newRole, setNewRole] = useState<string>("");
  const [newPlan, setNewPlan] = useState<string>("");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (role !== "admin") {
      navigate("/");
      return;
    }
    fetchUsers();
  }, [role, navigate]);

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(`
          *,
          user_roles(role),
          wallets(balance, total_earned)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setUsers(data as any);
    } catch (error: any) {
      toast({
        title: "Erro ao carregar usuários",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveChanges = async () => {
    if (!selectedUser) return;
    setProcessing(true);

    try {
      // Update role if changed
      const currentRole = selectedUser.user_roles[0]?.role || "user";
      if (newRole && newRole !== currentRole) {
        await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", selectedUser.id);

        const { error: roleError } = await supabase
          .from("user_roles")
          .insert({
            user_id: selectedUser.id,
            role: newRole as "user" | "creator" | "admin",
          });

        if (roleError) throw roleError;
      }

      // Update plan if changed
      if (newPlan && newPlan !== selectedUser.plan) {
        const { error: planError } = await supabase
          .from("profiles")
          .update({ 
            plan: newPlan as "free" | "pro" | "premium",
            plan_expires_at: newPlan === "free" ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
          })
          .eq("id", selectedUser.id);

        if (planError) throw planError;
      }

      toast({
        title: "Usuário atualizado!",
        description: `${selectedUser.display_name} foi atualizado com sucesso.`,
      });

      setSelectedUser(null);
      setNewRole("");
      setNewPlan("");
      fetchUsers();
    } catch (error: any) {
      toast({
        title: "Erro ao atualizar usuário",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const getRoleBadge = (userRoles: Array<{ role: string }>) => {
    const roleData = userRoles[0];
    if (!roleData) return <Badge variant="secondary">User</Badge>;

    switch (roleData.role) {
      case "admin":
        return (
          <Badge className="bg-red-500">
            <Crown className="w-3 h-3 mr-1" />
            Admin
          </Badge>
        );
      case "creator":
        return (
          <Badge className="bg-purple-500">
            <Shield className="w-3 h-3 mr-1" />
            Creator
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <UserIcon className="w-3 h-3 mr-1" />
            User
          </Badge>
        );
    }
  };

  const getPlanBadge = (plan: string) => {
    const colors = {
      free: "bg-gray-500",
      pro: "bg-yellow-500",
      premium: "bg-gradient-to-r from-purple-500 to-pink-500",
    };

    return (
      <Badge className={colors[plan as keyof typeof colors] || "bg-gray-500"}>
        {plan.toUpperCase()}
      </Badge>
    );
  };

  const filteredUsers = users.filter((user) =>
    user.display_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin">
          <Users className="w-12 h-12 text-accent" />
        </div>
      </div>
    );
  }

  return (
    <AdminLayout title="Usuários">
      <div className="container mx-auto px-4 py-8 space-y-8">

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total de Usuários</p>
              <p className="text-3xl font-bold">{users.length}</p>
            </div>
            <Users className="w-10 h-10 text-muted-foreground" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Creators</p>
              <p className="text-3xl font-bold">
                {users.filter((u) => u.user_roles[0]?.role === "creator").length}
              </p>
            </div>
            <Shield className="w-10 h-10 text-purple-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Admins</p>
              <p className="text-3xl font-bold">
                {users.filter((u) => u.user_roles[0]?.role === "admin").length}
              </p>
            </div>
            <Crown className="w-10 h-10 text-red-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Planos Premium</p>
              <p className="text-3xl font-bold">
                {users.filter((u) => u.plan === "premium").length}
              </p>
            </div>
            <Crown className="w-10 h-10 text-purple-500" />
          </div>
        </Card>
      </div>

      {/* Search */}
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Search className="w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="Buscar usuário por nome..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border-0 focus-visible:ring-0"
          />
        </div>
      </Card>

      {/* Users Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Status Creator</TableHead>
              <TableHead>Saldo</TableHead>
              <TableHead>Total Ganho</TableHead>
              <TableHead>Cadastro</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Nenhum usuário encontrado
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt={user.display_name}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                          <UserIcon className="w-4 h-4" />
                        </div>
                      )}
                      <span>{user.display_name}</span>
                    </div>
                  </TableCell>
                  <TableCell>{getRoleBadge(user.user_roles)}</TableCell>
                  <TableCell>{getPlanBadge(user.plan)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        user.creator_status === "approved"
                          ? "default"
                          : user.creator_status === "pending"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {user.creator_status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    R$ {user.wallets?.[0]?.balance?.toFixed(2) || "0.00"}
                  </TableCell>
                  <TableCell>
                    R$ {user.wallets?.[0]?.total_earned?.toFixed(2) || "0.00"}
                  </TableCell>
                  <TableCell>
                    {new Date(user.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedUser(user);
                        setNewRole(user.user_roles[0]?.role || "user");
                        setNewPlan(user.plan || "free");
                      }}
                    >
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Edit User Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription>
              Altere a função ou plano de {selectedUser?.display_name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label>Função Atual</Label>
              <div>{getRoleBadge(selectedUser?.user_roles || [])}</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Nova Função</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma função" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="creator">Creator</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Plano Atual</Label>
              <div>{getPlanBadge(selectedUser?.plan || "free")}</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="plan">Novo Plano</Label>
              <Select value={newPlan} onValueChange={setNewPlan}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um plano" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Planos Pro/Premium terão validade de 1 ano a partir de agora.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedUser(null);
                setNewRole("");
                setNewPlan("");
              }}
              disabled={processing}
            >
              Cancelar
            </Button>
            <Button onClick={handleSaveChanges} disabled={processing}>
              Salvar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </AdminLayout>
  );
}
