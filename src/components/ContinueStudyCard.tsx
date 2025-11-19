import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BookOpen, PlayCircle, StickyNote, Trophy, Clock, Coins } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface StudyMetrics {
  id: string;
  title: string;
  description: string | null;
  lastActivityAt: string;
  playlistsCount: number;
  videosWatchedCount: number;
  notesCount: number;
  totalStudyTime: number;
  totalRewards: number;
  progressPercent: number;
}

interface ContinueStudyCardProps {
  userId: string;
}

export function ContinueStudyCard({ userId }: ContinueStudyCardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [mainStudy, setMainStudy] = useState<StudyMetrics | null>(null);
  const [otherStudies, setOtherStudies] = useState<StudyMetrics[]>([]);

  useEffect(() => {
    fetchStudiesWithMetrics();
  }, [userId]);

  const fetchStudiesWithMetrics = async () => {
    try {
      // Fetch active studies
      const { data: studies, error: studiesError } = await supabase
        .from("studies")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("last_activity_at", { ascending: false });

      if (studiesError) throw studiesError;
      if (!studies || studies.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch metrics for each study
      const studiesWithMetrics = await Promise.all(
        studies.map(async (study) => {
          // Playlists count
          const { count: playlistsCount } = await supabase
            .from("study_playlists")
            .select("*", { count: "exact", head: true })
            .eq("study_id", study.id);

          // Notes count
          const { count: notesCount } = await supabase
            .from("study_notes")
            .select("*", { count: "exact", head: true })
            .eq("study_id", study.id);

          // Messages count (to estimate videos watched)
          const { data: messages } = await supabase
            .from("study_messages")
            .select("related_contents")
            .eq("study_id", study.id)
            .eq("role", "assistant");

          let videosWatchedCount = 0;
          if (messages) {
            messages.forEach((msg) => {
              if (msg.related_contents && Array.isArray(msg.related_contents)) {
                videosWatchedCount += msg.related_contents.length;
              }
            });
          }

          // Estimate study time (10 minutes per video + 2 minutes per note)
          const totalStudyTime = videosWatchedCount * 10 + (notesCount || 0) * 2;

          // Calculate progress (based on activity)
          const progressPercent = Math.min(
            Math.round(
              ((playlistsCount || 0) * 20 +
                videosWatchedCount * 10 +
                (notesCount || 0) * 5) /
                2
            ),
            100
          );

          return {
            id: study.id,
            title: study.title,
            description: study.description,
            lastActivityAt: study.last_activity_at,
            playlistsCount: playlistsCount || 0,
            videosWatchedCount,
            notesCount: notesCount || 0,
            totalStudyTime,
            totalRewards: 0, // TODO: Calculate from reward_events
            progressPercent,
          };
        })
      );

      setMainStudy(studiesWithMetrics[0]);
      setOtherStudies(studiesWithMetrics.slice(1));
    } catch (error) {
      console.error("Error fetching studies:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleContinueStudy = (studyId: string) => {
    navigate(`/study/${studyId}`);
  };

  if (loading) {
    return (
      <Card className="w-full p-8 bg-gradient-to-br from-background to-muted/30 border-border/50">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-4 w-96 mb-8" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-12 w-48" />
      </Card>
    );
  }

  if (!mainStudy) return null;

  return (
    <div className="w-full space-y-4">
      {/* Main Study Card */}
      <Card className="w-full p-8 bg-gradient-to-br from-background to-muted/30 border-border/50 hover:border-primary/30 transition-all duration-300">
        <div className="space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-foreground">{mainStudy.title}</h2>
            <p className="text-muted-foreground text-lg">
              Você já começou essa jornada. Vamos continuar?
            </p>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progresso da jornada</span>
              <span className="font-semibold text-foreground">{mainStudy.progressPercent}%</span>
            </div>
            <Progress value={mainStudy.progressPercent} className="h-2" />
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <MetricCard
              icon={<PlayCircle className="w-5 h-5" />}
              value={mainStudy.playlistsCount}
              label="Playlists"
            />
            <MetricCard
              icon={<BookOpen className="w-5 h-5" />}
              value={mainStudy.videosWatchedCount}
              label="Vídeos"
            />
            <MetricCard
              icon={<StickyNote className="w-5 h-5" />}
              value={mainStudy.notesCount}
              label="Anotações"
            />
            <MetricCard
              icon={<Clock className="w-5 h-5" />}
              value={`${mainStudy.totalStudyTime}m`}
              label="Tempo"
            />
            <MetricCard
              icon={<Coins className="w-5 h-5" />}
              value={`R$ ${mainStudy.totalRewards.toFixed(2)}`}
              label="Ganhos"
            />
            <MetricCard
              icon={<Trophy className="w-5 h-5" />}
              value={mainStudy.progressPercent}
              label="Conclusão"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-4 pt-2">
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => handleContinueStudy(mainStudy.id)}
            >
              Continuar estudo
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => handleContinueStudy(mainStudy.id)}
            >
              Ver detalhes
            </Button>
          </div>

          {/* AI Message */}
          <div className="pt-4 border-t border-border/50">
            <p className="text-sm text-muted-foreground italic">
              <span className="font-semibold text-cinematic-accent">Classy:</span> Você está a{" "}
              {mainStudy.progressPercent}% de concluir este estudo. Continue assim!
            </p>
          </div>
        </div>
      </Card>

      {/* Other Studies */}
      {otherStudies.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">Outros estudos em andamento</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {otherStudies.map((study) => (
              <Card
                key={study.id}
                className="p-4 bg-background border-border/50 hover:border-primary/30 transition-all cursor-pointer"
                onClick={() => handleContinueStudy(study.id)}
              >
                <div className="space-y-3">
                  <h4 className="font-semibold text-foreground line-clamp-1">{study.title}</h4>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Progresso</span>
                      <span className="font-medium">{study.progressPercent}%</span>
                    </div>
                    <Progress value={study.progressPercent} className="h-1.5" />
                  </div>
                  <Button size="sm" variant="ghost" className="w-full">
                    Continuar
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}

function MetricCard({ icon, value, label }: MetricCardProps) {
  return (
    <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-muted/50 border border-border/30">
      <div className="text-primary">{icon}</div>
      <div className="text-xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground text-center">{label}</div>
    </div>
  );
}
