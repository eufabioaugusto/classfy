import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Header } from "@/components/Header";
import { Zap, TrendingUp, Users, Calendar, DollarSign, Eye, MousePointerClick } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const StudioBoosts = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [boosts, setBoosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }
    loadBoosts();
  }, [user, navigate]);

  const loadBoosts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('boosts')
        .select(`
          *,
          contents (
            title,
            thumbnail_url
          )
        `)
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setBoosts(data || []);
    } catch (error: any) {
      console.error('Error loading boosts:', error);
      toast.error('Erro ao carregar boosts');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      pending_payment: { label: 'Pagamento Pendente', color: 'bg-yellow-500' },
      active: { label: 'Ativo', color: 'bg-green-500' },
      paused: { label: 'Pausado', color: 'bg-gray-500' },
      completed: { label: 'Concluído', color: 'bg-blue-500' },
      cancelled: { label: 'Cancelado', color: 'bg-red-500' },
    };
    const badge = badges[status as keyof typeof badges] || { label: status, color: 'bg-gray-500' };
    return <Badge className={`${badge.color} text-white`}>{badge.label}</Badge>;
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <Header variant="studio" />
          <main className="flex-1 p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold flex items-center gap-2">
                  <Zap className="w-8 h-8 text-primary" />
                  Meus Boosts
                </h1>
                <p className="text-muted-foreground mt-1">
                  Gerencie suas campanhas de impulsionamento
                </p>
              </div>
            </div>

            {loading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="animate-pulse">
                    <CardHeader className="h-40 bg-muted" />
                    <CardContent className="p-4 space-y-3">
                      <div className="h-4 bg-muted rounded w-3/4" />
                      <div className="h-4 bg-muted rounded w-1/2" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : boosts.length === 0 ? (
              <Card className="p-12 text-center">
                <Zap className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-xl font-semibold mb-2">Nenhum boost ativo</h3>
                <p className="text-muted-foreground mb-6">
                  Comece a impulsionar seus conteúdos para alcançar mais pessoas.
                </p>
                <Button onClick={() => navigate('/studio/contents')}>
                  Ver Meus Conteúdos
                </Button>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {boosts.map((boost) => (
                  <Card key={boost.id} className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-lg">
                          {boost.objective === 'profile' ? 'Boost de Perfil' : boost.contents?.title || 'Conteúdo'}
                        </CardTitle>
                        {getStatusBadge(boost.status)}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {boost.contents?.thumbnail_url && (
                        <img 
                          src={boost.contents.thumbnail_url} 
                          alt={boost.contents.title}
                          className="w-full h-32 object-cover rounded-md"
                        />
                      )}
                      
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">Orçamento</p>
                            <p className="font-semibold">R$ {boost.daily_budget}/dia</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">Duração</p>
                            <p className="font-semibold">{boost.duration_days} dias</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Eye className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">Impressões</p>
                            <p className="font-semibold">{boost.impressions_count}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <MousePointerClick className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">Cliques</p>
                            <p className="font-semibold">{boost.clicks_count}</p>
                          </div>
                        </div>
                      </div>

                      {boost.start_date && (
                        <div className="text-xs text-muted-foreground pt-2 border-t">
                          <p>Início: {format(new Date(boost.start_date), "dd 'de' MMMM", { locale: ptBR })}</p>
                          <p>Fim: {format(new Date(boost.end_date), "dd 'de' MMMM", { locale: ptBR })}</p>
                        </div>
                      )}

                      <div className="pt-2 border-t">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold">Total Investido:</span>
                          <span className="text-primary font-bold text-lg">
                            R$ {boost.total_budget}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default StudioBoosts;