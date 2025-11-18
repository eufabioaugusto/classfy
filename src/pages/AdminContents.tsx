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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useRewardSystem } from "@/hooks/useRewardSystem";

interface Content {
  id: string;
  content_type: "aula" | "short" | "podcast";
  title: string;
  description: string | null;
  thumbnail_url: string;
  status: string;
  created_at: string;
  creator_id: string;
  creator: { display_name: string; avatar_url: string | null };
}

export default function AdminContents() {
  const { user, role, loading } = useAuth();
  const [contents, setContents] = useState<Content[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedContents, setSelectedContents] = useState<Set<string>>(new Set());
  const { processReward } = useRewardSystem();

  useEffect(() => { if (user && role === 'admin') fetchPendingContents(); }, [user, role]);

  const fetchPendingContents = async () => {
    try {
      const { data, error } = await supabase.from('contents').select(`id, content_type, title, description, thumbnail_url, status, created_at, creator_id, creator:profiles!creator_id(display_name, avatar_url)`).eq('status', 'pending').order('created_at', { ascending: false });
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
    const content = contents.find((c) => c.id === contentId);
    if (!content) return;
    try {
      const { error } = await supabase.from('contents').update({ status: 'approved', published_at: new Date().toISOString() }).eq('id', contentId);
      if (error) throw error;
      await processReward({ actionKey: 'CONTENT_APPROVED', userId: content.creator_id, contentId: content.id, metadata: { content_title: content.title } });
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
      const { error } = await supabase.from('contents').update({ status: 'rejected' }).eq('id', contentId);
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
      const { error } = await supabase.from('contents').update({ status: 'approved', published_at: new Date().toISOString() }).in('id', Array.from(selectedContents));
      if (error) throw error;
      for (const contentId of Array.from(selectedContents)) {
        const content = contents.find((c) => c.id === contentId);
        if (content) await processReward({ actionKey: 'CONTENT_APPROVED', userId: content.creator_id, contentId: content.id, metadata: { content_title: content.title } });
      }
      toast.success(`${selectedContents.size} conteúdos aprovados!`);
      setContents(prev => prev.filter(c => !selectedContents.has(c.id)));
      setSelectedContents(new Set());
    } catch (error: any) {
      toast.error(error.message || "Erro ao aprovar");
    }
  };

  const handleBulkReject = async () => {
    if (selectedContents.size === 0) return;
    try {
      const { error } = await supabase.from('contents').update({ status: 'rejected' }).in('id', Array.from(selectedContents));
      if (error) throw error;
      toast.success(`${selectedContents.size} conteúdos reprovados`);
      setContents(prev => prev.filter(c => !selectedContents.has(c.id)));
      setSelectedContents(new Set());
    } catch (error: any) {
      toast.error(error.message || "Erro ao reprovar");
    }
  };

  const toggleSelection = (contentId: string) => {
    setSelectedContents(prev => { const newSet = new Set(prev); if (newSet.has(contentId)) newSet.delete(contentId); else newSet.add(contentId); return newSet; });
  };

  const toggleSelectAll = () => {
    if (selectedContents.size === contents.length) setSelectedContents(new Set()); else setSelectedContents(new Set(contents.map(c => c.id)));
  };

  const getContentTypeIcon = (type: string) => {
    switch (type) {
      case 'aula': return <Video className="h-4 w-4" />;
      case 'podcast': return <Music className="h-4 w-4" />;
      case 'short': return <Film className="h-4 w-4" />;
      default: return null;
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
  if (!user || role !== 'admin') return <Navigate to="/" replace />;

  return (
    <SidebarProvider><div className="flex min-h-screen w-full"><AppSidebar /><main className="flex-1 overflow-hidden"><div className="p-6"><div className="flex items-center justify-between mb-6"><div className="flex items-center gap-4"><SidebarTrigger /><div><h1 className="text-3xl font-bold">Aprovar Conteúdos</h1><p className="text-muted-foreground">{contents.length} conteúdo{contents.length !== 1 ? 's' : ''} aguardando aprovação</p></div></div>{selectedContents.size > 0 && <div className="flex gap-2"><Button variant="default" onClick={handleBulkApprove}><CheckCircle className="h-4 w-4 mr-2" />Aprovar Selecionados ({selectedContents.size})</Button><Button variant="destructive" onClick={handleBulkReject}><XCircle className="h-4 w-4 mr-2" />Reprovar Selecionados ({selectedContents.size})</Button></div>}</div>{loadingData ? <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div> : contents.length === 0 ? <div className="text-center py-12"><Clock className="h-12 w-12 mx-auto mb-4 text-muted-foreground" /><h3 className="text-lg font-semibold mb-2">Nenhum conteúdo pendente</h3></div> : <div className="border rounded-lg overflow-hidden"><Table><TableHeader><TableRow><TableHead className="w-12"><Checkbox checked={selectedContents.size === contents.length} onCheckedChange={toggleSelectAll} /></TableHead><TableHead>Conteúdo</TableHead><TableHead>Creator</TableHead><TableHead>Data</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>{contents.map((content) => <TableRow key={content.id}><TableCell><Checkbox checked={selectedContents.has(content.id)} onCheckedChange={() => toggleSelection(content.id)} /></TableCell><TableCell><div className="flex items-center gap-3"><img src={content.thumbnail_url} alt={content.title} className="h-16 w-24 object-cover rounded" /><div className="flex-1 min-w-0"><p className="font-medium truncate">{content.title}</p><p className="text-sm text-muted-foreground truncate">{content.description || 'Sem descrição'}</p><div className="flex items-center gap-2 mt-1"><Badge variant="outline" className="flex items-center gap-1">{getContentTypeIcon(content.content_type)}{content.content_type}</Badge></div></div></div></TableCell><TableCell><div className="flex items-center gap-2"><Avatar className="h-8 w-8"><AvatarImage src={content.creator.avatar_url || undefined} /><AvatarFallback>{content.creator.display_name.charAt(0)}</AvatarFallback></Avatar><span className="text-sm">{content.creator.display_name}</span></div></TableCell><TableCell><span className="text-sm text-muted-foreground">{new Date(content.created_at).toLocaleDateString('pt-BR')}</span></TableCell><TableCell className="text-right"><div className="flex items-center justify-end gap-2"><Button variant="ghost" size="icon" onClick={() => window.open(`/watch/${content.id}`, '_blank')}><Eye className="h-4 w-4" /></Button><Button variant="default" size="sm" onClick={() => handleApprove(content.id)} disabled={processingId === content.id}><CheckCircle className="h-4 w-4 mr-1" />Aprovar</Button><Button variant="destructive" size="sm" onClick={() => handleReject(content.id)} disabled={processingId === content.id}><XCircle className="h-4 w-4 mr-1" />Reprovar</Button></div></TableCell></TableRow>)}</TableBody></Table></div>}</div></main></div></SidebarProvider>
  );
}
