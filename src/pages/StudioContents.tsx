import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Video, Podcast, Zap, Radio, BookOpen, Eye, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Content {
  id: string;
  title: string;
  description: string | null;
  content_type: string;
  thumbnail_url: string | null;
  status: string | null;
  created_at: string;
  views_count: number | null;
}

export default function StudioContents() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [contents, setContents] = useState<Content[]>([]);
  const [filteredContents, setFilteredContents] = useState<Content[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }

  if (!user || (role !== 'creator' && role !== 'admin')) {
    return <Navigate to="/" replace />;
  }

  useEffect(() => {
    fetchContents();
  }, [user]);

  useEffect(() => {
    if (filterType === "all") {
      setFilteredContents(contents);
    } else {
      setFilteredContents(contents.filter(c => c.content_type === filterType));
    }
  }, [filterType, contents]);

  const fetchContents = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('contents')
        .select('*')
        .eq('creator_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setContents(data || []);
      setFilteredContents(data || []);
    } catch (error) {
      console.error('Error fetching contents:', error);
      toast({
        title: "Erro ao carregar conteúdos",
        description: "Não foi possível carregar seus conteúdos",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (contentId: string) => {
    if (!confirm('Tem certeza que deseja deletar este conteúdo?')) return;

    try {
      const { error } = await supabase
        .from('contents')
        .delete()
        .eq('id', contentId);

      if (error) throw error;

      toast({
        title: "Conteúdo deletado",
        description: "O conteúdo foi removido com sucesso"
      });

      fetchContents();
    } catch (error) {
      console.error('Error deleting content:', error);
      toast({
        title: "Erro ao deletar",
        description: "Não foi possível deletar o conteúdo",
        variant: "destructive"
      });
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'aula': return Video;
      case 'podcast': return Podcast;
      case 'short': return Zap;
      case 'live': return Radio;
      case 'curso': return BookOpen;
      default: return Video;
    }
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'approved':
        return <Badge variant="default" className="bg-green-500">Aprovado</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pendente</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejeitado</Badge>;
      default:
        return <Badge variant="outline">Desconhecido</Badge>;
    }
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <header className="sticky top-0 z-50 border-b border-border/20 bg-background/95 backdrop-blur-xl">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
                <h1 className="text-2xl font-bold text-foreground">Meus Conteúdos</h1>
              </div>
              
              <Button onClick={() => navigate('/studio/upload')}>
                Criar Novo Conteúdo
              </Button>
            </div>
          </header>

          <main className="flex-1 p-6 md:p-12">
            <div className="max-w-7xl mx-auto space-y-6">
              {/* Filtros */}
              <div className="flex items-center gap-4">
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Filtrar por tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="aula">Aulas</SelectItem>
                    <SelectItem value="curso">Cursos</SelectItem>
                    <SelectItem value="podcast">Podcasts</SelectItem>
                    <SelectItem value="short">Shorts</SelectItem>
                    <SelectItem value="live">Lives</SelectItem>
                  </SelectContent>
                </Select>
                
                <p className="text-sm text-muted-foreground">
                  {filteredContents.length} {filteredContents.length === 1 ? 'conteúdo' : 'conteúdos'}
                </p>
              </div>

              {/* Lista de Conteúdos */}
              {isLoading ? (
                <div className="text-center py-12">Carregando...</div>
              ) : filteredContents.length === 0 ? (
                <Card className="p-12 text-center bg-card border-dashed">
                  <Video className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-bold mb-2">
                    {filterType === 'all' ? 'Nenhum conteúdo ainda' : 'Nenhum conteúdo deste tipo'}
                  </h3>
                  <p className="text-muted-foreground mb-6">
                    {filterType === 'all' 
                      ? 'Comece criando seu primeiro conteúdo'
                      : 'Tente outro filtro ou crie um novo conteúdo'}
                  </p>
                  <Button onClick={() => navigate('/studio/upload')}>
                    Criar Conteúdo
                  </Button>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredContents.map((content) => {
                    const TypeIcon = getTypeIcon(content.content_type);
                    return (
                      <Card key={content.id} className="overflow-hidden group">
                        {/* Thumbnail */}
                        <div className="aspect-video bg-muted relative overflow-hidden">
                          {content.thumbnail_url ? (
                            <img 
                              src={content.thumbnail_url} 
                              alt={content.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <TypeIcon className="w-12 h-12 text-muted-foreground" />
                            </div>
                          )}
                          
                          {/* Overlay com ações */}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => navigate(`/watch/${content.id}`)}
                            >
                              <Eye className="w-4 h-4 mr-2" />
                              Ver
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDelete(content.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Info */}
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 className="font-semibold text-foreground line-clamp-2">
                              {content.title}
                            </h3>
                            {getStatusBadge(content.status)}
                          </div>
                          
                          {content.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                              {content.description}
                            </p>
                          )}
                          
                          <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <TypeIcon className="w-4 h-4" />
                              <span className="capitalize">{content.content_type}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Eye className="w-4 h-4" />
                              <span>{content.views_count || 0}</span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
