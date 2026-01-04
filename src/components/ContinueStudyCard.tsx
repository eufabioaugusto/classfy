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

      // No need to fetch playlists here anymore - will be done per study

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

          // Fetch playlists for this specific study
          const { data: studyPlaylists } = await supabase
            .from("study_playlists")
            .select("message_id")
            .eq("study_id", study.id)
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

          // Get messages with their related contents for THIS study
          const { data: messages } = await supabase
            .from("study_messages")
            .select("id, related_contents")
            .eq("study_id", study.id)
            .eq("role", "assistant")
            .order("created_at", { ascending: true });

          let videosWatchedCount = 0;
          let firstContentId: string | null = null;
          let thumbnailUrl = null;
          let videoUrl = null;
          const allContentIds: string[] = [];

          if (messages && messages.length > 0) {
            for (const msg of messages) {
              if (msg.related_contents && Array.isArray(msg.related_contents) && msg.related_contents.length > 0) {
                for (const content of msg.related_contents) {
                  let contentId: string | null = null;
                  if (typeof content === 'object' && content !== null && 'id' in content) {
                    contentId = content.id as string;
                  } else if (typeof content === 'string') {
                    contentId = content;
                  }
                  if (contentId) {
                    allContentIds.push(contentId);
                    if (!firstContentId) firstContentId = contentId;
                  }
                }
                videosWatchedCount += msg.related_contents.length;
              }
            }

            // Fetch thumbnail and video from first content
            if (firstContentId) {
              const { data: content } = await supabase
                .from("contents")
                .select("thumbnail_url, video_url, file_url")
                .eq("id", firstContentId)
                .maybeSingle();
              
              if (content) {
                thumbnailUrl = content.thumbnail_url;
                videoUrl = content.video_url || content.file_url;
              }
            }
          }

          // Calculate total rewards from reward_events for contents in this study
          let totalRewards = 0;
          if (allContentIds.length > 0) {
            const { data: rewards } = await supabase
              .from("reward_events")
              .select("value")
              .eq("user_id", userId)
              .in("content_id", allContentIds);
            
            if (rewards) {
              totalRewards = rewards.reduce((sum, r) => sum + (r.value || 0), 0);
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

          // Get last playlist message ID for this study
          const lastPlaylistMessageId = studyPlaylists?.[0]?.message_id || null;

          return {
            id: study.id,
            title: study.title,
            description: study.description,
            lastActivityAt: study.last_activity_at,
            playlistsCount: playlistsCount || 0,
            videosWatchedCount,
            notesCount: notesCount || 0,
            totalStudyTime,
            totalRewards,
            progressPercent,
            thumbnailUrl,
            videoUrl,
            lastPlaylistMessageId,
          };
        })
      );

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
          className="w-full min-h-[380px] md:h-[420px] rounded-2xl overflow-hidden relative group border-border/50 hover:border-primary/30 transition-all duration-300 cursor-pointer"
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
          <div className="absolute inset-0 flex flex-col justify-end p-5 md:p-10">
            {/* Title and Description */}
            <div className="space-y-2 mb-4">
              <p className="text-white/80 text-sm md:text-lg">
                {index === 0 ? "Você já começou essa jornada. Vamos continuar?" : "Continue de onde parou"}
              </p>
              <h2 className="text-xl md:text-5xl font-bold text-white leading-tight line-clamp-2">
                {study.title}
              </h2>
            </div>

            {/* Progress Bar */}
            <div className="mb-4 md:mb-6">
              <Progress value={study.progressPercent} className="h-1 md:h-1.5 bg-white/20" indicatorClassName="bg-red-600" />
              <span className="text-xs text-white/60 mt-1 block">{study.progressPercent}% concluído</span>
            </div>

            {/* Metrics Row - Compact grid on mobile */}
            <div className="grid grid-cols-2 md:flex md:flex-wrap gap-x-4 gap-y-2 md:gap-6 mb-4 md:mb-6 text-white/90">
              <div className="flex items-center gap-1.5 md:gap-2">
                <PlayCircle className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="text-xs md:text-sm font-medium">{study.playlistsCount} Playlists</span>
              </div>
              <div className="flex items-center gap-1.5 md:gap-2">
                <BookOpen className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="text-xs md:text-sm font-medium">{study.videosWatchedCount} Vídeos</span>
              </div>
              <div className="flex items-center gap-1.5 md:gap-2">
                <StickyNote className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="text-xs md:text-sm font-medium">{study.notesCount} Anotações</span>
              </div>
              <div className="flex items-center gap-1.5 md:gap-2">
                <Clock className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="text-xs md:text-sm font-medium">{study.totalStudyTime}min</span>
              </div>
            </div>

            {/* Rewards - separated on mobile */}
            <div className="flex items-center gap-1.5 mb-4 text-white/90">
              <Coins className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="text-xs md:text-sm font-medium">R$ {study.totalRewards.toFixed(2)}</span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 md:gap-4">
              <Button
                size="default"
                className="bg-white hover:bg-white/90 text-black font-semibold text-sm md:text-base px-4 md:px-6"
                onClick={(e) => {
                  e.stopPropagation();
                  handleContinueStudy(study.id, study.lastPlaylistMessageId);
                }}
              >
                Continuar estudo
              </Button>
              <Button
                size="default"
                variant="ghost"
                className="text-white border border-white/30 hover:bg-white/10 text-sm md:text-base px-4 md:px-6"
                onClick={(e) => {
                  e.stopPropagation();
                  handleContinueStudy(study.id, study.lastPlaylistMessageId);
                }}
              >
                Ver detalhes
              </Button>
            </div>

            {/* AI Message */}
            <div className="mt-4 md:mt-6 pt-3 md:pt-4 border-t border-white/10">
              <p className="text-xs md:text-sm text-white/70 italic">
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
