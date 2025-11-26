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
}

interface WatchNotesProps {
  contentId: string | null;
  onSeekTo?: (seconds: number) => void;
  refreshTrigger?: number;
}

export const WatchNotes = ({ contentId, onSeekTo, refreshTrigger }: WatchNotesProps) => {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetchNotes();
  }, [contentId, user, refreshTrigger]);

  const fetchNotes = async () => {
    if (!user) return;

    if (!contentId) {
      // Sem conteúdo associado: limpa lista e encerra carregamento
      setNotes([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log("🔍 Buscando notas para content_id:", contentId);
      
      // Busca notas tanto por content_id quanto por lesson_id
      const { data, error } = await supabase
        .from("study_notes")
        .select("id, note_text, timestamp_seconds, created_at")
        .eq("user_id", user.id)
        .eq("content_id", contentId)
        .order("timestamp_seconds", { ascending: true });

      if (error) throw error;
      console.log("📝 Notas encontradas:", data?.length);
      setNotes(data || []);
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

  const handleNoteClick = (timestamp: number | null) => {
    if (timestamp !== null && onSeekTo) {
      console.log(`🎬 Clicando na nota: ${timestamp}s`);
      onSeekTo(timestamp);
      // Reset após um pequeno delay para permitir múltiplos cliques
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
                <div className="space-y-3 pr-4">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      onClick={() => handleNoteClick(note.timestamp_seconds)}
                      className="p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-all duration-200 border border-border/50 hover:border-primary/50 hover-scale"
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
              </ScrollArea>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};
