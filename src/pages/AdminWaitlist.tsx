import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Crown, Search, ExternalLink, Users, UserCheck } from "lucide-react";

interface WaitlistEntry {
  id: string;
  name: string;
  email: string;
  type: "creator" | "consumer";
  niche: string | null;
  social_url: string | null;
  followers_range: string | null;
  created_at: string;
}

export default function AdminWaitlist() {
  const { role } = useAuth();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "creator" | "consumer">("all");

  useEffect(() => {
    fetchEntries();
  }, []);

  async function fetchEntries() {
    setLoading(true);
    const { data, error } = await supabase
      .from("waitlist")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) setEntries(data as WaitlistEntry[]);
    setLoading(false);
  }

  if (role !== "admin") return <Navigate to="/" replace />;

  const filtered = entries.filter((e) => {
    const matchesFilter = filter === "all" || e.type === filter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (e.niche || "").toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  const creatorCount = entries.filter((e) => e.type === "creator").length;
  const consumerCount = entries.filter((e) => e.type === "consumer").length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Waitlist — LP</h1>
            <p className="text-muted-foreground mt-1">
              Candidaturas recebidas via classfy.com.br
            </p>
          </div>
          <Button variant="outline" onClick={fetchEntries}>
            Atualizar
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-4 flex items-center gap-3">
            <Users className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{entries.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3">
            <Crown className="w-5 h-5 text-yellow-500" />
            <div>
              <p className="text-2xl font-bold">{creatorCount}</p>
              <p className="text-xs text-muted-foreground">Embaixadores Fundadores</p>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3">
            <UserCheck className="w-5 h-5 text-blue-500" />
            <div>
              <p className="text-2xl font-bold">{consumerCount}</p>
              <p className="text-xs text-muted-foreground">Alunos</p>
            </div>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, email ou nicho..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {(["all", "creator", "consumer"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Todos" : f === "creator" ? "Creators" : "Alunos"}
            </Button>
          ))}
        </div>

        {/* Table */}
        <Card>
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Nenhuma entrada encontrada.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="text-left p-4">Nome</th>
                    <th className="text-left p-4">Email</th>
                    <th className="text-left p-4">Tipo</th>
                    <th className="text-left p-4">Nicho</th>
                    <th className="text-left p-4">Seguidores</th>
                    <th className="text-left p-4">Perfil</th>
                    <th className="text-left p-4">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b last:border-0 hover:bg-muted/40 transition-colors"
                    >
                      <td className="p-4 font-medium">{entry.name}</td>
                      <td className="p-4 text-muted-foreground">{entry.email}</td>
                      <td className="p-4">
                        {entry.type === "creator" ? (
                          <Badge className="gap-1 bg-yellow-500/10 text-yellow-600 border-yellow-500/20 hover:bg-yellow-500/20">
                            <Crown className="w-3 h-3" />
                            Fundador
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Aluno</Badge>
                        )}
                      </td>
                      <td className="p-4 text-muted-foreground">{entry.niche || "—"}</td>
                      <td className="p-4 text-muted-foreground">{entry.followers_range || "—"}</td>
                      <td className="p-4">
                        {entry.social_url ? (
                          <a
                            href={entry.social_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            Ver <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {new Date(entry.created_at).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}
