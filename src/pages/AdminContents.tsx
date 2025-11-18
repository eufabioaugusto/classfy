import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock, Video, Music, Film } from "lucide-react";

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

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "aula": return <Video className="w-5 h-5" />;
      case "short": return <Film className="w-5 h-5" />;
      case "podcast": return <Music className="w-5 h-5" />;
      default: return null;
    }
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
            </div>
          </header>

          <main className="flex-1 p-6 md:p-12">
            <div className="max-w-6xl mx-auto space-y-6">
              {loadingData ? (
                <div className="text-center py-12">Carregando...</div>
              ) : contents.length === 0 ? (
                <Card className="p-12 text-center">
                  <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-bold mb-2">Nenhum conteúdo pendente</h3>
                  <p className="text-muted-foreground">
                    Todos os conteúdos foram revisados
                  </p>
                </Card>
              ) : (
                contents.map((content) => (
                  <Card key={content.id} className="p-6">
                    <div className="flex gap-6">
                      <img
                        src={content.thumbnail_url}
                        alt={content.title}
                        className="w-48 h-32 object-cover rounded"
                      />
                      
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              {getTypeIcon(content.content_type)}
                              <Badge variant="secondary">
                                {content.content_type}
                              </Badge>
                            </div>
                            <h3 className="text-xl font-bold mb-1">{content.title}</h3>
                            {content.description && (
                              <p className="text-muted-foreground text-sm line-clamp-2">
                                {content.description}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-4 mb-4">
                          {content.creator.avatar_url && (
                            <img
                              src={content.creator.avatar_url}
                              alt={content.creator.display_name}
                              className="w-8 h-8 rounded-full"
                            />
                          )}
                          <span className="text-sm text-muted-foreground">
                            {content.creator.display_name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            • {new Date(content.created_at).toLocaleDateString('pt-BR')}
                          </span>
                        </div>

                        <div className="flex gap-3">
                          <Button
                            onClick={() => handleApprove(content.id)}
                            disabled={processingId === content.id}
                            className="gap-2"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Aprovar
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => handleReject(content.id)}
                            disabled={processingId === content.id}
                            className="gap-2"
                          >
                            <XCircle className="w-4 h-4" />
                            Reprovar
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
