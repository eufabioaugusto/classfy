import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { FileText, RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { GlobalLoader } from "@/components/GlobalLoader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TranscriptionStats {
  totalApproved: number;
  withTranscription: number;
  withoutTranscription: number;
  aulas: number;
  podcasts: number;
}

export default function AdminTranscriptions() {
  const { user, role, loading } = useAuth();
  const [stats, setStats] = useState<TranscriptionStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [batchLimit, setBatchLimit] = useState(10);

  useEffect(() => {
    if (user && role === 'admin') {
      fetchStats();
    }
  }, [user, role]);

  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      // Get all approved contents (aula or podcast)
      const { data: approvedContents, error: contentsError } = await supabase
        .from('contents')
        .select('id, content_type')
        .eq('status', 'approved')
        .in('content_type', ['aula', 'podcast'])
        .not('file_url', 'is', null);

      if (contentsError) throw contentsError;

      // Get all existing transcriptions
      const { data: transcriptions, error: transcriptionsError } = await supabase
        .from('transcriptions')
        .select('content_id');

      if (transcriptionsError) throw transcriptionsError;

      const transcriptionIds = new Set(transcriptions?.map(t => t.content_id) || []);
      
      const withTranscription = approvedContents?.filter(c => transcriptionIds.has(c.id)).length || 0;
      const withoutTranscription = (approvedContents?.length || 0) - withTranscription;
      const aulas = approvedContents?.filter(c => c.content_type === 'aula' && !transcriptionIds.has(c.id)).length || 0;
      const podcasts = approvedContents?.filter(c => c.content_type === 'podcast' && !transcriptionIds.has(c.id)).length || 0;

      setStats({
        totalApproved: approvedContents?.length || 0,
        withTranscription,
        withoutTranscription,
        aulas,
        podcasts
      });
    } catch (error: any) {
      console.error('Error fetching stats:', error);
      toast.error(error.message || "Erro ao carregar estatísticas");
    } finally {
      setLoadingStats(false);
    }
  };

  const handleBatchTranscribe = async () => {
    if (!stats || stats.withoutTranscription === 0) {
      toast.error("Não há conteúdos sem transcrição para processar");
      return;
    }

    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('batch-transcribe-contents', {
        body: { limit: batchLimit }
      });

      if (error) throw error;

      toast.success(
        `Iniciado processamento de ${data.total} transcrições em segundo plano!`,
        { 
          description: "As transcrições serão geradas automaticamente. Recarregue esta página em alguns minutos para ver o progresso."
        }
      );

      // Refresh stats after a delay
      setTimeout(() => {
        fetchStats();
      }, 2000);
    } catch (error: any) {
      console.error('Error starting batch transcription:', error);
      toast.error(error.message || "Erro ao iniciar processamento em lote");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <GlobalLoader />;
  if (!user || role !== 'admin') return <Navigate to="/" replace />;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background px-6">
            <SidebarTrigger />
            <h1 className="text-xl font-semibold">Gerenciar Transcrições</h1>
          </header>

          <main className="flex-1 p-6 space-y-6">
            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Aprovados</CardTitle>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {loadingStats ? <Loader2 className="h-6 w-6 animate-spin" /> : stats?.totalApproved || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Conteúdos de áudio/vídeo</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Com Transcrição</CardTitle>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {loadingStats ? <Loader2 className="h-6 w-6 animate-spin" /> : stats?.withTranscription || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Já processados</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Sem Transcrição</CardTitle>
                  <AlertCircle className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600">
                    {loadingStats ? <Loader2 className="h-6 w-6 animate-spin" /> : stats?.withoutTranscription || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {stats?.aulas || 0} aulas, {stats?.podcasts || 0} podcasts
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Taxa de Conclusão</CardTitle>
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {loadingStats ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      `${stats?.totalApproved ? Math.round((stats.withTranscription / stats.totalApproved) * 100) : 0}%`
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Transcrições completas</p>
                </CardContent>
              </Card>
            </div>

            {/* Batch Processing Card */}
            <Card>
              <CardHeader>
                <CardTitle>Processamento em Lote</CardTitle>
                <CardDescription>
                  Processe automaticamente transcrições de conteúdos que ainda não foram transcritos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="batch-limit">Quantidade de conteúdos por lote</Label>
                  <Input
                    id="batch-limit"
                    type="number"
                    min="1"
                    max="50"
                    value={batchLimit}
                    onChange={(e) => setBatchLimit(parseInt(e.target.value) || 10)}
                    className="w-32"
                  />
                  <p className="text-sm text-muted-foreground">
                    Recomendado: 10-20 conteúdos por vez para evitar sobrecarga
                  </p>
                </div>

                <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Como funciona o processamento em lote:</p>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                      <li>O sistema busca conteúdos aprovados sem transcrição</li>
                      <li>Inicia o processamento em segundo plano (não trava a interface)</li>
                      <li>Cada transcrição pode levar alguns minutos</li>
                      <li>Recarregue esta página periodicamente para ver o progresso</li>
                      <li>Use lotes menores se houver problemas de memória</li>
                    </ul>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleBatchTranscribe}
                    disabled={processing || !stats || stats.withoutTranscription === 0}
                    className="gap-2"
                  >
                    {processing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processando...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        Iniciar Processamento em Lote
                      </>
                    )}
                  </Button>

                  <Button
                    onClick={fetchStats}
                    variant="outline"
                    disabled={loadingStats}
                    className="gap-2"
                  >
                    {loadingStats ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Atualizar Estatísticas
                  </Button>
                </div>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
