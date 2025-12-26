import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, FileText, Play, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Note {
  id: string;
  note_text: string;
  timestamp_seconds: number | null;
  created_at: string;
}

interface MobileNotesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
  onSeekTo: (seconds: number) => void;
  refreshTrigger?: number;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export function MobileNotesSheet({ 
  open, 
  onOpenChange, 
  contentId, 
  onSeekTo,
  refreshTrigger 
}: MobileNotesSheetProps) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && contentId && user) {
      fetchNotes();
    }
  }, [open, contentId, user, refreshTrigger]);

  const fetchNotes = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("study_notes")
        .select("id, note_text, timestamp_seconds, created_at")
        .eq("content_id", contentId)
        .eq("user_id", user.id)
        .order("timestamp_seconds", { ascending: true, nullsFirst: false });

      if (error) throw error;
      setNotes(data || []);
    } catch (error) {
      console.error("Error fetching notes:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    try {
      const { error } = await supabase
        .from("study_notes")
        .delete()
        .eq("id", noteId);

      if (error) throw error;
      
      setNotes(prev => prev.filter(n => n.id !== noteId));
      toast.success("Nota excluída");
    } catch (error) {
      console.error("Error deleting note:", error);
      toast.error("Erro ao excluir nota");
    }
  };

  const handleSeekAndClose = (seconds: number) => {
    onSeekTo(seconds);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="bottom" 
        className="h-[70vh] rounded-t-3xl p-0 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <SheetTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Minhas Notas ({notes.length})
          </SheetTitle>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Notes List */}
        <ScrollArea className="flex-1 px-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground text-sm">
                Nenhuma nota ainda
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                Use o botão de nota no player para adicionar
              </p>
            </div>
          ) : (
            <div className="py-4 space-y-3">
              {notes.map((note) => (
                <div 
                  key={note.id} 
                  className="bg-secondary/50 rounded-xl p-3 group"
                >
                  <div className="flex items-start gap-3">
                    {note.timestamp_seconds !== null && (
                      <button
                        onClick={() => handleSeekAndClose(note.timestamp_seconds!)}
                        className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded-md text-xs font-medium flex-shrink-0 hover:bg-primary/20 transition-colors"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        {formatTime(note.timestamp_seconds)}
                      </button>
                    )}
                    <p className="text-sm flex-1 min-w-0 break-words">
                      {note.note_text}
                    </p>
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
