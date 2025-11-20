import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Note {
  id: string;
  note_text: string;
  timestamp_seconds: number | null;
  created_at: string;
}

interface WatchNotesProps {
  contentId: string;
  onSeekTo?: (seconds: number) => void;
  refreshTrigger?: number;
}

export const WatchNotes = ({ contentId, onSeekTo, refreshTrigger }: WatchNotesProps) => {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotes();
  }, [contentId, user, refreshTrigger]);

  const fetchNotes = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("study_notes")
        .select("id, note_text, timestamp_seconds, created_at")
        .eq("user_id", user.id)
        .eq("content_id", contentId)
        .order("timestamp_seconds", { ascending: true });

      if (error) throw error;
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
      onSeekTo(timestamp);
    }
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Notas</h3>
        </div>
        <p className="text-sm text-muted-foreground">Carregando notas...</p>
      </Card>
    );
  }

  if (notes.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Notas</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Nenhuma nota salva ainda. Use o botão "Adicionar Nota" no player para criar suas anotações.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Notas ({notes.length})</h3>
      </div>
      
      <ScrollArea className="h-[600px]">
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => handleNoteClick(note.timestamp_seconds)}
              className="p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors border border-border/50 hover:border-primary/50"
            >
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-primary">
                  {formatTime(note.timestamp_seconds)}
                </span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {note.note_text}
              </p>
              <span className="text-xs text-muted-foreground mt-2 block">
                {new Date(note.created_at).toLocaleDateString('pt-BR', { 
                  day: '2-digit', 
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
};
