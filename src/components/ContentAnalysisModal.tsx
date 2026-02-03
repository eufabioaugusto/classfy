import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Bot,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  Target,
  BookOpen,
  Users,
  Tag,
  ThumbsUp,
  ThumbsDown,
  Eye,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AnalysisResult {
  approvalScore: number;
  summary: string;
  mainTopic: string;
  category: string;
  targetAudience: string;
  suggestedTags: string[];
  contentWarnings: {
    hasExplicitContent: boolean;
    hasProfanity: boolean;
    hasOffensiveLanguage: boolean;
    hasViolence: boolean;
    hasMisleadingInfo: boolean;
    details: string[];
  };
  qualityAssessment: {
    educationalValue: "low" | "medium" | "high";
    contentClarity: "low" | "medium" | "high";
    engagement: "low" | "medium" | "high";
  };
  recommendation: "approve" | "review" | "reject";
  recommendationReason: string;
}

interface ContentAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
  contentTitle: string;
  onApprove?: () => void;
  onReject?: () => void;
}

export function ContentAnalysisModal({
  open,
  onOpenChange,
  contentId,
  contentTitle,
  onApprove,
  onReject,
}: ContentAnalysisModalProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [hasTranscription, setHasTranscription] = useState(false);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setAnalysis(null);

    try {
      const { data, error } = await supabase.functions.invoke("analyze-content", {
        body: { contentId },
      });

      if (error) throw error;

      if (data.success && data.analysis) {
        setAnalysis(data.analysis);
        setHasTranscription(data.hasTranscription);
      } else {
        throw new Error(data.error || "Erro desconhecido");
      }
    } catch (error: any) {
      console.error("Analysis error:", error);
      toast.error(error.message || "Erro ao analisar conteúdo");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 71) return "text-green-500";
    if (score >= 41) return "text-yellow-500";
    return "text-red-500";
  };

  const getScoreGradient = (score: number) => {
    if (score >= 71) return "from-green-500 to-green-600";
    if (score >= 41) return "from-yellow-500 to-orange-500";
    return "from-red-500 to-red-600";
  };

  const getScoreBg = (score: number) => {
    if (score >= 71) return "bg-green-500/10";
    if (score >= 41) return "bg-yellow-500/10";
    return "bg-red-500/10";
  };

  const getRecommendationBadge = (recommendation: string) => {
    switch (recommendation) {
      case "approve":
        return (
          <Badge className="bg-green-500/10 text-green-600 border-green-500/20 gap-1">
            <ThumbsUp className="h-3 w-3" />
            Aprovar
          </Badge>
        );
      case "review":
        return (
          <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 gap-1">
            <Eye className="h-3 w-3" />
            Revisar
          </Badge>
        );
      case "reject":
        return (
          <Badge className="bg-red-500/10 text-red-600 border-red-500/20 gap-1">
            <ThumbsDown className="h-3 w-3" />
            Rejeitar
          </Badge>
        );
    }
  };

  const getQualityBadge = (level: "low" | "medium" | "high") => {
    switch (level) {
      case "high":
        return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">Alto</Badge>;
      case "medium":
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30">Médio</Badge>;
      case "low":
        return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">Baixo</Badge>;
    }
  };

  const hasWarnings = analysis?.contentWarnings && (
    analysis.contentWarnings.hasExplicitContent ||
    analysis.contentWarnings.hasProfanity ||
    analysis.contentWarnings.hasOffensiveLanguage ||
    analysis.contentWarnings.hasViolence ||
    analysis.contentWarnings.hasMisleadingInfo
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Análise de Curadoria com IA
          </DialogTitle>
          <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
            {contentTitle}
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-180px)]">
          <div className="px-6 pb-6 space-y-6">
            {!analysis && !isAnalyzing && (
              <div className="text-center py-12 space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Analisar Conteúdo</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                    A IA irá analisar a transcrição, contexto, e verificar se há conteúdo impróprio para acelerar sua curadoria.
                  </p>
                </div>
                <Button onClick={handleAnalyze} className="gap-2">
                  <Bot className="h-4 w-4" />
                  Iniciar Análise
                </Button>
              </div>
            )}

            {isAnalyzing && (
              <div className="text-center py-12 space-y-4">
                <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
                <div>
                  <h3 className="font-semibold">Analisando conteúdo...</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Verificando transcrição, contexto e moderação
                  </p>
                </div>
              </div>
            )}

            {analysis && (
              <div className="space-y-6">
                {/* Score Thermometer */}
                <div className={cn("rounded-xl p-6 space-y-4", getScoreBg(analysis.approvalScore))}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {analysis.approvalScore >= 71 ? (
                        <ShieldCheck className="h-8 w-8 text-green-500" />
                      ) : analysis.approvalScore >= 41 ? (
                        <AlertTriangle className="h-8 w-8 text-yellow-500" />
                      ) : (
                        <ShieldAlert className="h-8 w-8 text-red-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Score de Aprovação</p>
                        <p className={cn("text-4xl font-bold", getScoreColor(analysis.approvalScore))}>
                          {analysis.approvalScore}
                          <span className="text-lg font-normal text-muted-foreground">/100</span>
                        </p>
                      </div>
                    </div>
                    {getRecommendationBadge(analysis.recommendation)}
                  </div>
                  
                  <div className="relative h-3 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("absolute inset-y-0 left-0 rounded-full bg-gradient-to-r transition-all duration-500", getScoreGradient(analysis.approvalScore))}
                      style={{ width: `${analysis.approvalScore}%` }}
                    />
                    {/* Markers */}
                    <div className="absolute inset-y-0 left-[40%] w-px bg-muted-foreground/30" />
                    <div className="absolute inset-y-0 left-[70%] w-px bg-muted-foreground/30" />
                  </div>
                  
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Rejeitar</span>
                    <span>Revisar</span>
                    <span>Aprovar</span>
                  </div>
                </div>

                {/* Recommendation Reason */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" />
                    Justificativa
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {analysis.recommendationReason}
                  </p>
                </div>

                <Separator />

                {/* Content Summary */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary" />
                    Resumo do Conteúdo
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {analysis.summary}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Badge variant="outline" className="gap-1">
                      <span className="text-muted-foreground">Tema:</span>
                      {analysis.mainTopic}
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      <span className="text-muted-foreground">Categoria:</span>
                      {analysis.category}
                    </Badge>
                  </div>
                </div>

                {/* Warnings */}
                {hasWarnings && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <h4 className="font-medium flex items-center gap-2 text-red-500">
                        <AlertCircle className="h-4 w-4" />
                        Alertas de Conteúdo
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        {analysis.contentWarnings.hasExplicitContent && (
                          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 gap-1">
                            <XCircle className="h-3 w-3" />
                            Conteúdo Explícito
                          </Badge>
                        )}
                        {analysis.contentWarnings.hasProfanity && (
                          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 gap-1">
                            <XCircle className="h-3 w-3" />
                            Palavrões
                          </Badge>
                        )}
                        {analysis.contentWarnings.hasOffensiveLanguage && (
                          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 gap-1">
                            <XCircle className="h-3 w-3" />
                            Linguagem Ofensiva
                          </Badge>
                        )}
                        {analysis.contentWarnings.hasViolence && (
                          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 gap-1">
                            <XCircle className="h-3 w-3" />
                            Violência
                          </Badge>
                        )}
                        {analysis.contentWarnings.hasMisleadingInfo && (
                          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Info Enganosa
                          </Badge>
                        )}
                      </div>
                      {analysis.contentWarnings.details.length > 0 && (
                        <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                          {analysis.contentWarnings.details.map((detail, i) => (
                            <li key={i} className="list-disc">{detail}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}

                {!hasWarnings && (
                  <>
                    <Separator />
                    <div className="flex items-center gap-2 text-green-600">
                      <ShieldCheck className="h-5 w-5" />
                      <span className="text-sm font-medium">Nenhum alerta de conteúdo detectado</span>
                    </div>
                  </>
                )}

                <Separator />

                {/* Quality Assessment */}
                <div className="space-y-3">
                  <h4 className="font-medium">Avaliação de Qualidade</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Valor Educacional</p>
                      {getQualityBadge(analysis.qualityAssessment.educationalValue)}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Clareza</p>
                      {getQualityBadge(analysis.qualityAssessment.contentClarity)}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Engajamento</p>
                      {getQualityBadge(analysis.qualityAssessment.engagement)}
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Target Audience & Tags */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Público-alvo:</span>
                    <Badge variant="secondary">{analysis.targetAudience}</Badge>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Tags Sugeridas</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {analysis.suggestedTags.map((tag, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Transcription Status */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
                  {hasTranscription ? (
                    <>
                      <CheckCircle className="h-3 w-3 text-green-500" />
                      Análise baseada na transcrição completa
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3 w-3 text-yellow-500" />
                      Análise baseada apenas em título e descrição
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer Actions */}
        {analysis && (
          <div className="border-t p-4 flex items-center justify-between gap-3 bg-muted/30">
            <Button variant="ghost" size="sm" onClick={handleAnalyze} disabled={isAnalyzing}>
              <Bot className="h-4 w-4 mr-1" />
              Reanalisar
            </Button>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onReject?.();
                  onOpenChange(false);
                }}
              >
                <XCircle className="h-4 w-4 mr-1" />
                Reprovar
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  onApprove?.();
                  onOpenChange(false);
                }}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Aprovar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
