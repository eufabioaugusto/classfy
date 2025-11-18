import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock, Video, Music, Film, Eye } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface Content {
  id: string;
  content_type: "aula" | "short" | "podcast";
  title: string;
  description: string | null;
  thumbnail_url: string;
  status: string;
  created_at: string;
  creator: {
    display_name: string;
    avatar_url: string | null;
  };
}

export default function AdminContents() {
  const { user, role, loading } = useAuth();
  const [contents, setContents] = useState<Content[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedContents, setSelectedContents] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user && role === 'admin') {
      fetchPendingContents();
    }
  }, [user, role]);

  const fetchPendingContents = async () => {
    try {
      const { data, error } = await supabase
        .from('contents')
        .select(`
          id,
          content_type,
          title,
          description,
          thumbnail_url,
          status,
          created_at,
          creator:profiles!creator_id(display_name, avatar_url)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setContents(data || []);
    } catch (error: any) {
      toast.error(error.message || "Erro ao carregar conteúdos");
    } finally {
      setLoadingData(false);
    }
  };

  const handleApprove = async (contentId: string) => {
    setProcessingId(contentId);
    try {
      const { error } = await supabase
        .from('contents')
        .update({ status: 'approved' })
        .eq('id', contentId);

      if (error) throw error;

      toast.success("Conteúdo aprovado!");
      setContents(prev => prev.filter(c => c.id !== contentId));
    } catch (error: any) {
      toast.error(error.message || "Erro ao aprovar");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (contentId: string) => {
    setProcessingId(contentId);
    try {
      const { error } = await supabase
        .from('contents')
        .update({ status: 'rejected' })
        .eq('id', contentId);

      if (error) throw error;

      toast.success("Conteúdo reprovado");
      setContents(prev => prev.filter(c => c.id !== contentId));
    } catch (error: any) {
      toast.error(error.message || "Erro ao reprovar");
    } finally {
      setProcessingId(null);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedContents.size === 0) return;
    
    try {
      const { error } = await supabase
        .from('contents')
        .update({ status: 'approved' })
        .in('id', Array.from(selectedContents));

      if (error) throw error;

      toast.success(`${selectedContents.size} conteúdos aprovados!`);
      setContents(prev => prev.filter(c => !selectedContents.has(c.id)));
      setSelectedContents(new Set());
    } catch (error: any) {
      toast.error(error.message || "Erro ao aprovar em massa");
    }
  };

  const handleBulkReject = async () => {
    if (selectedContents.size === 0) return;
    
    try {
      const { error } = await supabase
        .from('contents')
        .update({ status: 'rejected' })
        .in('id', Array.from(selectedContents));

      if (error) throw error;

      toast.success(`${selectedContents.size} conteúdos reprovados`);
      setContents(prev => prev.filter(c => !selectedContents.has(c.id)));
      setSelectedContents(new Set());
    } catch (error: any) {
      toast.error(error.message || "Erro ao reprovar em massa");
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "aula": return Video;
      case "short": return Film;
      case "podcast": return Music;
      default: return Video;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'aula': return 'Aula';
      case 'podcast': return 'Podcast';
      case 'short': return 'Short';
      default: return type;
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
    if (selectedContents.size === contents.length) {
      setSelectedContents(new Set());
    } else {
      setSelectedContents(new Set(contents.map(c => c.id)));
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

  if (!user || role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <header className="sticky top-0 z-50 border-b border-border/20 bg-background/95 backdrop-blur-xl">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
                <h1 className="text-2xl font-bold text-foreground">Aprovar Conteúdos</h1>
              </div>
              
              {selectedContents.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {selectedContents.size} selecionados
                  </span>
                  <Button onClick={handleBulkApprove} size="sm" className="gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Aprovar Selecionados
                  </Button>
                  <Button onClick={handleBulkReject} size="sm" variant="destructive" className="gap-2">
                    <XCircle className="w-4 h-4" />
                    Reprovar Selecionados
                  </Button>
                </div>
              )}
            </div>
          </header>

          <main className="flex-1 p-6">
            <div className="max-w-full space-y-4">
              {loadingData ? (
                <div className="text-center py-12">Carregando...</div>
              ) : contents.length === 0 ? (
                <div className="border border-dashed rounded-lg p-12 text-center">
                  <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-bold mb-2">Nenhum conteúdo pendente</h3>
                  <p className="text-muted-foreground">
                    Todos os conteúdos foram revisados
                  </p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox 
                            checked={selectedContents.size === contents.length}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                        <TableHead className="w-[450px]">Conteúdo</TableHead>
                        <TableHead>Creator</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contents.map((content) => {
                        const TypeIcon = getTypeIcon(content.content_type);
                        return (
                          <TableRow key={content.id} className="hover:bg-muted/50">
                            <TableCell>
                              <Checkbox 
                                checked={selectedContents.has(content.id)}
                                onCheckedChange={() => toggleSelect(content.id)}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                {/* Thumbnail */}
                                <div className="relative w-40 h-24 bg-muted rounded overflow-hidden flex-shrink-0">
                                  <img 
                                    src={content.thumbnail_url} 
                                    alt={content.title}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                
                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <TypeIcon className="w-4 h-4 text-muted-foreground" />
                                    <Badge variant="secondary" className="text-xs">
                                      {getTypeLabel(content.content_type)}
                                    </Badge>
                                  </div>
                                  <h3 className="font-medium text-foreground line-clamp-2 mb-1">
                                    {content.title}
                                  </h3>
                                  {content.description && (
                                    <p className="text-sm text-muted-foreground line-clamp-2">
                                      {content.description}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Avatar className="w-8 h-8">
                                  <AvatarImage src={content.creator.avatar_url || ''} />
                                  <AvatarFallback>
                                    {content.creator.display_name.charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm font-medium">
                                  {content.creator.display_name}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground">
                                {formatDate(content.created_at)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => window.open(`/watch/${content.id}`, '_blank')}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleApprove(content.id)}
                                  disabled={processingId === content.id}
                                  className="gap-2"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                  Aprovar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleReject(content.id)}
                                  disabled={processingId === content.id}
                                  className="gap-2"
                                >
                                  <XCircle className="w-4 h-4" />
                                  Reprovar
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
