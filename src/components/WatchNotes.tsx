import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Clock, FileText, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

interface Note {
  id: string;
  note_text: string;
  timestamp_seconds: number | null;
  created_at: string;
  lesson_id?: string | null;
  lesson_title?: string | null;
}

interface WatchNotesProps {
  contentId: string | null;
  courseId?: string | null;
  currentLessonId?: string | null;
  onSeekTo?: (seconds: number) => void;
  onLessonChange?: (lessonId: string) => void;
  refreshTrigger?: number;
}

export const WatchNotes = ({ 
  contentId, 
  courseId, 
  currentLessonId,
  onSeekTo, 
  onLessonChange,
  refreshTrigger 
}: WatchNotesProps) => {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [groupedNotes, setGroupedNotes] = useState<Record<string, Note[]>>({});

  useEffect(() => {
    fetchNotes();
  }, [contentId, user, refreshTrigger]);

  const fetchNotes = async () => {
    if (!user) return;

    try {
      setLoading(true);
      console.log("🔍 Buscando notas - courseId:", courseId, "contentId:", contentId);

      let notesData: Note[] = [];

      if (courseId) {
        // Para cursos: buscar TODAS as notas de TODAS as lessons
        const { data: lessonsData, error: lessonsError } = await supabase
          .from("course_lessons")
          .select("id, title")
          .eq("course_id", courseId);

        if (lessonsError) throw lessonsError;

        if (lessonsData && lessonsData.length > 0) {
          const lessonIds = lessonsData.map(l => l.id);
          
          const { data: notesFromDb, error: notesError } = await supabase
            .from("study_notes")
            .select("id, note_text, timestamp_seconds, created_at, lesson_id")
            .eq("user_id", user.id)
            .in("lesson_id", lessonIds)
            .order("timestamp_seconds", { ascending: true });

          if (notesError) throw notesError;

          // Enriquecer com título da lesson
          notesData = (notesFromDb || []).map(note => ({
            ...note,
            lesson_title: lessonsData.find(l => l.id === note.lesson_id)?.title || "Aula"
          }));
        }
      } else if (contentId) {
        // Para conteúdo normal: buscar por content_id
        const { data, error } = await supabase
          .from("study_notes")
          .select("id, note_text, timestamp_seconds, created_at")
          .eq("user_id", user.id)
          .eq("content_id", contentId)
          .order("timestamp_seconds", { ascending: true });

        if (error) throw error;
        notesData = data || [];
      }

      console.log("📝 Notas encontradas:", notesData.length);
      setNotes(notesData);

      // Agrupar por lesson para cursos
      if (courseId) {
        const grouped = notesData.reduce((acc, note) => {
          const key = note.lesson_id || "sem_aula";
          if (!acc[key]) acc[key] = [];
          acc[key].push(note);
          return acc;
        }, {} as Record<string, Note[]>);
        setGroupedNotes(grouped);
      }
    } catch (error) {
      console.error("Error fetching notes:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number | null) => {
    if (seconds === null) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleNoteClick = (note: Note) => {
    // Se for de outra lesson, mudar de aula primeiro
    if (courseId && note.lesson_id && note.lesson_id !== currentLessonId && onLessonChange) {
      console.log(`🎬 Mudando para aula: ${note.lesson_id}`);
      onLessonChange(note.lesson_id);
      
      // Aguardar troca de aula antes de fazer seek
      setTimeout(() => {
        if (note.timestamp_seconds !== null && onSeekTo) {
          onSeekTo(note.timestamp_seconds);
          setTimeout(() => onSeekTo(null), 100);
        }
      }, 500);
    } else if (note.timestamp_seconds !== null && onSeekTo) {
      // Mesma aula ou conteúdo normal: só fazer seek
      console.log(`🎬 Seek para: ${note.timestamp_seconds}s`);
      onSeekTo(note.timestamp_seconds);
      setTimeout(() => onSeekTo(null), 100);
    }
  };

  return (
    <Card className="overflow-hidden bg-muted/30">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full flex items-center justify-between p-4 hover:bg-accent/50">
            <div className="flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              <h5 className="font-semibold">Minhas Notas</h5>
              {!loading && <span className="text-sm text-muted-foreground">({notes.length})</span>}
            </div>
            <ChevronDown
              className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="animate-accordion-down">
          <div className="px-4 pb-4">
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando notas...</p>
            ) : notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma nota salva ainda. Use o botão "Adicionar Nota" no player.
              </p>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-4 pr-4">
                  {courseId ? (
                    // Exibir agrupado por aula
                    Object.entries(groupedNotes).map(([lessonId, lessonNotes]) => {
                      const firstNote = lessonNotes[0];
                      const isCurrentLesson = lessonId === currentLessonId;
                      
                      return (
                        <div key={lessonId} className="space-y-2">
                          <div className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-2 ${
                            isCurrentLesson ? 'text-primary' : 'text-muted-foreground'
                          }`}>
                            {isCurrentLesson && <span>▶</span>}
                            {firstNote?.lesson_title || "Aula"}
                          </div>
                          
                          {lessonNotes.map((note) => (
                            <div
                              key={note.id}
                              onClick={() => handleNoteClick(note)}
                              className={`p-3 rounded-lg cursor-pointer transition-all duration-200 border ${
                                isCurrentLesson
                                  ? 'bg-primary/5 hover:bg-primary/10 border-primary/30 hover:border-primary/50'
                                  : 'bg-muted/50 hover:bg-muted border-border/50 hover:border-primary/30'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Clock className="h-4 w-4 text-primary" />
                                <span className="text-sm font-medium text-primary">{formatTime(note.timestamp_seconds)}</span>
                              </div>
                              <p className="text-sm text-foreground whitespace-pre-wrap break-words">{note.note_text}</p>
                              <span className="text-xs text-muted-foreground mt-2 block">
                                {new Date(note.created_at).toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })
                  ) : (
                    // Exibir lista simples para conteúdo normal
                    notes.map((note) => (
                      <div
                        key={note.id}
                        onClick={() => handleNoteClick(note)}
                        className="p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-all duration-200 border border-border/50 hover:border-primary/50"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium text-primary">{formatTime(note.timestamp_seconds)}</span>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap break-words">{note.note_text}</p>
                        <span className="text-xs text-muted-foreground mt-2 block">
                          {new Date(note.created_at).toLocaleDateString("pt-BR", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};
