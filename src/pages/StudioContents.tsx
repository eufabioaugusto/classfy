import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Video, Podcast, Zap, Radio, BookOpen, Eye, Trash2, MoreVertical, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
interface Content {
  id: string;
  title: string;
  description: string | null;
  content_type: string;
  thumbnail_url: string | null;
  status: string | null;
  created_at: string;
  views_count: number | null;
  visibility: string | null;
}
export default function StudioContents() {
  const {
    user,
    role,
    loading
  } = useAuth();
  const navigate = useNavigate();
  const {
    toast
  } = useToast();
  const [contents, setContents] = useState<Content[]>([]);
  const [filteredContents, setFilteredContents] = useState<Content[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [selectedContents, setSelectedContents] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (user) {
      fetchContents();
    }
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
      const {
        data,
        error
      } = await supabase.from('contents').select('*').eq('creator_id', user.id).order('created_at', {
        ascending: false
      });
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
      const {
        error
      } = await supabase.from('contents').delete().eq('id', contentId);
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
      case 'aula':
        return Video;
      case 'podcast':
        return Podcast;
      case 'short':
        return Zap;
      case 'live':
        return Radio;
      case 'curso':
        return BookOpen;
      default:
        return Video;
    }
  };
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'aula':
        return 'Aula';
      case 'podcast':
        return 'Podcast';
      case 'short':
        return 'Short';
      case 'live':
        return 'Live';
      case 'curso':
        return 'Curso';
      default:
        return type;
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
  const getVisibilityLabel = (visibility: string | null) => {
    switch (visibility) {
      case 'free':
        return 'Público';
      case 'pro':
        return 'Pro';
      case 'premium':
        return 'Premium';
      case 'paid':
        return 'Pago';
      default:
        return 'Público';
    }
  };
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };
  const toggleSelectAll = () => {
    if (selectedContents.size === filteredContents.length) {
      setSelectedContents(new Set());
    } else {
      setSelectedContents(new Set(filteredContents.map(c => c.id)));
    }
  };
  const toggleSelect = (contentId: string) => {
    const newSelected = new Set(selectedContents);
    if (newSelected.has(contentId)) {
      newSelected.delete(contentId);
    } else {
      newSelected.add(contentId);
    }
    setSelectedContents(newSelected);
  };
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }
  if (!user || role !== 'creator' && role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <SidebarProvider defaultOpen={true}>
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

          <main className="flex-1 p-6">
            <div className="max-w-full space-y-4">
              {/* Filtros */}
              <div className="flex items-center justify-between">
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
              </div>

              {/* Tabela de Conteúdos */}
              {isLoading ? <div className="text-center py-12">Carregando...</div> : filteredContents.length === 0 ? <div className="border border-dashed rounded-lg p-12 text-center">
                  <Video className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-bold mb-2">
                    {filterType === 'all' ? 'Nenhum conteúdo ainda' : 'Nenhum conteúdo deste tipo'}
                  </h3>
                  <p className="text-muted-foreground mb-6">
                    {filterType === 'all' ? 'Comece criando seu primeiro conteúdo' : 'Tente outro filtro ou crie um novo conteúdo'}
                  </p>
                  <Button onClick={() => navigate('/studio/upload')}>
                    Criar Conteúdo
                  </Button>
                </div> : <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox checked={selectedContents.size === filteredContents.length} onCheckedChange={toggleSelectAll} />
                        </TableHead>
                        <TableHead className="w-[400px]">Vídeo</TableHead>
                        <TableHead>Visibilidade</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead className="text-right">Visualizações</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredContents.map(content => {
                    const TypeIcon = getTypeIcon(content.content_type);
                    return <TableRow key={content.id} className="hover:bg-muted/50">
                            <TableCell>
                              <Checkbox checked={selectedContents.has(content.id)} onCheckedChange={() => toggleSelect(content.id)} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                {/* Thumbnail */}
                                <div className="relative w-32 h-18 bg-muted rounded overflow-hidden flex-shrink-0">
                                  {content.thumbnail_url ? <img src={content.thumbnail_url} alt={content.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center">
                                      <TypeIcon className="w-6 h-6 text-muted-foreground" />
                                    </div>}
                                </div>
                                
                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-medium text-foreground line-clamp-2 mb-1 text-sm">
                                    {content.title}
                                  </h3>
                                  {content.description && <p className="text-sm text-muted-foreground line-clamp-1">
                                      {content.description}
                                    </p>}
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-muted-foreground capitalize">
                                      {getTypeLabel(content.content_type)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm">
                                {getVisibilityLabel(content.visibility)}
                              </span>
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(content.status)}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground">
                                {formatDate(content.created_at)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Eye className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm">{content.views_count || 0}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => navigate(`/watch/${content.id}`)}>
                                    <Eye className="w-4 h-4 mr-2" />
                                    Ver
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => {}}>
                                    <Edit className="w-4 h-4 mr-2" />
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDelete(content.id)} className="text-destructive">
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Deletar
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>;
                  })}
                    </TableBody>
                  </Table>
                </div>}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>;
}