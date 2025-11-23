import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
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
import { BoostModal } from "@/components/BoostModal";
import { useBoostContent } from "@/hooks/useBoostContent";
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
  const { isBoostModalOpen, selectedContent, openBoostModal, closeBoostModal } = useBoostContent();
  useEffect(() => {
    if (user) {
      fetchContents();
      
      // Subscribe to realtime updates for creator's contents and courses
      const contentsChannel = supabase
        .channel('studio-contents')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'contents',
            filter: `creator_id=eq.${user.id}`,
          },
          (payload) => {
            console.log('Content updated:', payload);
            fetchContents();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'courses',
            filter: `creator_id=eq.${user.id}`,
          },
          (payload) => {
            console.log('Course updated:', payload);
            fetchContents();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(contentsChannel);
      };
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
      // Buscar conteúdos regulares
      const {
        data: contentsData,
        error: contentsError
      } = await supabase.from('contents').select('*').eq('creator_id', user.id).order('created_at', {
        ascending: false
      });
      
      if (contentsError) throw contentsError;
      
      // Buscar cursos
      const {
        data: coursesData,
        error: coursesError
      } = await supabase.from('courses').select('*').eq('creator_id', user.id).order('created_at', {
        ascending: false
      });
      
      if (coursesError) throw coursesError;
      
      // Mapear cursos para o formato de Content
      const mappedCourses = (coursesData || []).map(course => ({
        id: course.id,
        title: course.title,
        description: course.description,
        content_type: 'curso',
        thumbnail_url: course.thumbnail_url,
        status: course.status,
        created_at: course.created_at,
        views_count: course.views_count,
        visibility: course.visibility
      }));
      
      // Combinar e ordenar por data de criação
      const allContent = [...(contentsData || []), ...mappedCourses].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      
      setContents(allContent);
      setFilteredContents(allContent);
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
  const handleDelete = async (contentId: string, contentType: string) => {
    if (!confirm('Tem certeza que deseja deletar este conteúdo?')) return;
    try {
      // Determinar qual tabela usar baseado no tipo
      const table = contentType === 'curso' ? 'courses' : 'contents';
      
      const {
        error
      } = await supabase.from(table).delete().eq('id', contentId);
      
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
          <Header variant="studio" title="Meus Conteúdos" />

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
                        <TableHead className="w-[5%]">
                          <Checkbox checked={selectedContents.size === filteredContents.length} onCheckedChange={toggleSelectAll} />
                        </TableHead>
                        <TableHead className="w-[40%]">Vídeo</TableHead>
                        <TableHead className="w-[10%]">Visibilidade</TableHead>
                        <TableHead className="w-[10%]">Status</TableHead>
                        <TableHead className="w-[15%]">Data</TableHead>
                        <TableHead className="text-right w-[10%]">Visualizações</TableHead>
                        <TableHead className="w-[5%]"></TableHead>
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
                              <div className="flex flex-col gap-1.5">
                                {getStatusBadge(content.status)}
                                {content.status === 'approved' && (
                                  <Button
                                    size="sm"
                                    onClick={() => openBoostModal(content.id, content.title)}
                                    className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0 h-7 px-2 text-xs gap-1"
                                  >
                                    <Zap className="w-3 h-3" />
                                    Boost
                                  </Button>
                                )}
                              </div>
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
                                  <DropdownMenuItem onClick={() => navigate(content.content_type === 'curso' ? `/study/${content.id}` : `/watch/${content.id}`)}>
                                    <Eye className="w-4 h-4 mr-2" />
                                    Ver
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openBoostModal(content.id, content.title)}>
                                    <Zap className="w-4 h-4 mr-2" />
                                    Impulsionar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => navigate(`/studio/upload?edit=${content.id}`)}>
                                    <Edit className="w-4 h-4 mr-2" />
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDelete(content.id, content.content_type)} className="text-destructive">
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

      <BoostModal 
        open={isBoostModalOpen}
        onOpenChange={closeBoostModal}
        contentId={selectedContent?.id}
        contentTitle={selectedContent?.title}
      />
    </SidebarProvider>;
}