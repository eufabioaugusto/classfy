import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { AdminLayout } from "@/components/AdminLayout";
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
      const { data: approvedContents, error: contentsError } = await supabase
        .from('contents')
        .select('id, content_type')
        .eq('status', 'approved')
        .in('content_type', ['aula', 'podcast'])
        .not('file_url', 'is', null);

      if (contentsError) throw contentsError;

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

      setTimeout(() => fetchStats(), 2000);
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
    <AdminLayout title="Transcrições">
      <div className="p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Aprovados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalApproved || 0}</div>
              <Badge variant="outline" className="mt-2">
                <FileText className="h-3 w-3 mr-1" />
                Aulas + Podcasts
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Com Transcrição</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats?.withTranscription || 0}</div>
              <Badge className="mt-2 bg-green-500">
                <CheckCircle className="h-3 w-3 mr-1" />
                Completos
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Sem Transcrição</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats?.withoutTranscription || 0}</div>
              <Badge variant="secondary" className="mt-2">
                <XCircle className="h-3 w-3 mr-1" />
                Pendentes
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Aulas Pendentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.aulas || 0}</div>
              <Badge variant="outline" className="mt-2">Aulas</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Podcasts Pendentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.podcasts || 0}</div>
              <Badge variant="outline" className="mt-2">Podcasts</Badge>
            </CardContent>
          </Card>
        </div>

        {/* Batch Transcription Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Processamento em Lote
            </CardTitle>
            <CardDescription>
              Gere transcrições automaticamente para múltiplos conteúdos de uma vez
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="batchLimit">
                Limite de Processamento
              </Label>
              <Input
                id="batchLimit"
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
      </div>
    </AdminLayout>
  );
}
