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
  thumbnailUrl: string | null;
  videoUrl: string | null;
  lastPlaylistMessageId?: string | null;
}

interface ContinueStudyCardProps {
  userId: string;
}

export function ContinueStudyCard({ userId }: ContinueStudyCardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [studies, setStudies] = useState<StudyMetrics[]>([]);

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

      // Fetch saved playlists for the first study to auto-open
      const firstStudyId = studies[0].id;
      const { data: playlists } = await supabase
        .from("study_playlists")
        .select("message_id")
        .eq("study_id", firstStudyId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      
      const lastPlaylistMessageId = playlists?.[0]?.message_id || null;

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

          // Messages count (to estimate videos watched) and get first content thumbnail
          const { data: messages } = await supabase
            .from("study_messages")
            .select("related_contents")
            .eq("study_id", study.id)
            .eq("role", "assistant")
            .order("created_at", { ascending: true });

          let videosWatchedCount = 0;
          let firstContentId: string | null = null;
          let thumbnailUrl = null;
          let videoUrl = null;

          if (messages && messages.length > 0) {
            // Find the first message with content IDs
            for (const msg of messages) {
              if (msg.related_contents && Array.isArray(msg.related_contents) && msg.related_contents.length > 0) {
                if (!firstContentId) {
                  // Extract ID from content object or use string directly
                  const firstContent = msg.related_contents[0];
                  if (typeof firstContent === 'object' && firstContent !== null && 'id' in firstContent) {
                    firstContentId = firstContent.id as string;
                  } else if (typeof firstContent === 'string') {
                    firstContentId = firstContent;
                  }
                  console.log('First content ID extracted:', firstContentId);
                }
                videosWatchedCount += msg.related_contents.length;
              }
            }

            // Fetch thumbnail and video from first content
            if (firstContentId) {
              try {
                const { data: content, error: contentError } = await supabase
                  .from("contents")
                  .select("thumbnail_url, video_url, file_url")
                  .eq("id", firstContentId)
                  .maybeSingle();
                
                console.log('Content media fetched:', content, 'Error:', contentError);
                
                if (!contentError && content) {
                  thumbnailUrl = content.thumbnail_url;
                  // Try video_url first, then file_url as fallback
                  videoUrl = content.video_url || content.file_url;
                  console.log('Media URLs - Thumbnail:', thumbnailUrl, 'Video:', videoUrl);
                }
              } catch (error) {
                console.error("Error fetching content media:", error);
              }
            }
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
            thumbnailUrl,
            videoUrl,
            lastPlaylistMessageId: null,
          };
        })
      );

      // Add playlist message ID to first study
      if (studiesWithMetrics.length > 0) {
        studiesWithMetrics[0].lastPlaylistMessageId = lastPlaylistMessageId;
      }

      setStudies(studiesWithMetrics);
    } catch (error) {
      console.error("Error fetching studies:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleContinueStudy = (studyId: string, playlistMessageId?: string) => {
    navigate(`/c/${studyId}`, { 
      state: { autoOpenPlaylist: playlistMessageId } 
    });
  };

  if (loading) {
    return (
      <div className="w-full h-[420px] rounded-2xl overflow-hidden relative">
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  if (studies.length === 0) return null;

  return (
    <div className="w-full space-y-6">
      {studies.map((study, index) => (
        <Card 
          key={study.id}
          className="w-full h-[420px] rounded-2xl overflow-hidden relative group border-border/50 hover:border-primary/30 transition-all duration-300 cursor-pointer"
          onClick={() => handleContinueStudy(study.id, study.lastPlaylistMessageId)}
        >
          {/* Background Video/Image with Overlay */}
          <div className="absolute inset-0 bg-black">
            {study.videoUrl ? (
              <>
                <video
                  key={study.videoUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-cover opacity-70"
                  onError={(e) => {
                    console.error('Video failed to load:', study.videoUrl);
                    e.currentTarget.style.display = 'none';
                  }}
                  onLoadedData={() => console.log('Video loaded successfully')}
                >
                  <source src={study.videoUrl} type="video/mp4" />
                </video>
                {/* Dark overlay gradient - stronger at bottom */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/30" />
              </>
            ) : study.thumbnailUrl ? (
              <>
                <img
                  src={study.thumbnailUrl}
                  alt={study.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    console.error('Thumbnail failed to load:', study.thumbnailUrl);
                    e.currentTarget.style.display = 'none';
                  }}
                  onLoad={() => console.log('Thumbnail loaded successfully')}
                />
                {/* Dark overlay gradient - stronger at bottom */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20" />
              </>
            ) : (
              <>
                <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5" />
                {/* Dark overlay gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/10" />
              </>
            )}
          </div>

          {/* Content Container - Positioned at bottom */}
          <div className="absolute inset-0 flex flex-col justify-end p-8 md:p-10">
            {/* Badge */}
            <div className="mb-4">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-xs font-medium">
                <Trophy className="w-3 h-3" />
                {study.progressPercent}% Concluído
              </span>
            </div>

            {/* Title and Description */}
            <div className="space-y-3 mb-6">
              <h2 className="text-4xl md:text-5xl font-bold text-white leading-tight">
                {study.title}
              </h2>
              <p className="text-white/80 text-lg max-w-2xl">
                {index === 0 ? "Você já começou essa jornada. Vamos continuar?" : "Continue de onde parou"}
              </p>
            </div>

            {/* Progress Bar */}
            <div className="mb-6 max-w-xl">
              <Progress value={study.progressPercent} className="h-1.5 bg-white/20" indicatorClassName="bg-red-600" />
            </div>

            {/* Metrics Row */}
            <div className="flex flex-wrap gap-6 mb-6 text-white/90">
              <div className="flex items-center gap-2">
                <PlayCircle className="w-4 h-4" />
                <span className="text-sm font-medium">{study.playlistsCount} Playlists</span>
              </div>
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                <span className="text-sm font-medium">{study.videosWatchedCount} Vídeos</span>
              </div>
              <div className="flex items-center gap-2">
                <StickyNote className="w-4 h-4" />
                <span className="text-sm font-medium">{study.notesCount} Anotações</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span className="text-sm font-medium">{study.totalStudyTime}min</span>
              </div>
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4" />
                <span className="text-sm font-medium">R$ {study.totalRewards.toFixed(2)}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-4">
              <Button
                size="lg"
                className="bg-white hover:bg-white/90 text-black font-semibold"
                onClick={(e) => {
                  e.stopPropagation();
                  handleContinueStudy(study.id, study.lastPlaylistMessageId);
                }}
              >
                Continuar estudo
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="text-white border border-white/30 hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation();
                  handleContinueStudy(study.id, study.lastPlaylistMessageId);
                }}
              >
                Ver detalhes
              </Button>
            </div>

            {/* AI Message */}
            <div className="mt-6 pt-4 border-t border-white/10">
              <p className="text-sm text-white/70 italic">
                <span className="font-semibold text-cinematic-accent">Classy:</span> Você está a{" "}
                {study.progressPercent}% de concluir este estudo. Continue assim!
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
