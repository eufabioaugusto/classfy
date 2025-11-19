import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Clock, Trash2, Edit2, Check, X, StickyNote } from "lucide-react";
import { format } from "date-fns";

interface StudyNotesProps {
  studyId: string;
  activeContentId: string | null;
  onSeekToTimestamp?: (seconds: number) => void;
}

interface Note {
  id: string;
  note_text: string;
  timestamp_seconds: number | null;
  created_at: string;
  updated_at: string;
  content_id: string | null;
}

export function StudyNotes({ studyId, activeContentId, onSeekToTimestamp }: StudyNotesProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    loadNotes();
  }, [studyId, activeContentId]);

  const loadNotes = async () => {
    try {
      const query = supabase
        .from("study_notes")
        .select("*")
        .eq("study_id", studyId)
        .order("created_at", { ascending: false });

      if (activeContentId) {
        query.eq("content_id", activeContentId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setNotes(data || []);
    } catch (error) {
      console.error("Erro ao carregar notas:", error);
      toast({
        title: "Erro ao carregar notas",
        description: "Não foi possível carregar suas anotações.",
        variant: "destructive",
      });
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

      setNotes(notes.filter((n) => n.id !== noteId));
      toast({
        title: "Nota excluída",
        description: "A anotação foi removida com sucesso.",
      });
    } catch (error) {
      console.error("Erro ao excluir nota:", error);
      toast({
        title: "Erro ao excluir",
        description: "Não foi possível excluir a anotação.",
        variant: "destructive",
      });
    }
  };

  const handleStartEdit = (note: Note) => {
    setEditingId(note.id);
    setEditText(note.note_text);
  };

  const handleSaveEdit = async (noteId: string) => {
    try {
      const { error } = await supabase
        .from("study_notes")
        .update({ note_text: editText })
        .eq("id", noteId);

      if (error) throw error;

      setNotes(
        notes.map((n) =>
          n.id === noteId ? { ...n, note_text: editText } : n
        )
      );
      setEditingId(null);
      toast({
        title: "Nota atualizada",
        description: "Sua anotação foi salva com sucesso.",
      });
    } catch (error) {
      console.error("Erro ao atualizar nota:", error);
      toast({
        title: "Erro ao atualizar",
        description: "Não foi possível atualizar a anotação.",
        variant: "destructive",
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const formatTime = (seconds: number | null) => {
    if (seconds === null) return "Nota geral";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSeek = (seconds: number | null) => {
    if (seconds !== null && onSeekToTimestamp) {
      onSeekToTimestamp(seconds);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Carregando anotações...</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <StickyNote className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">Minhas Anotações</h3>
        <span className="text-sm text-muted-foreground">({notes.length})</span>
      </div>

      {notes.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <StickyNote className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Nenhuma anotação ainda.</p>
          <p className="text-xs mt-1">
            {activeContentId
              ? "Clique no botão de nota no player para adicionar."
              : "Selecione um conteúdo para fazer anotações."}
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-3">
            {notes.map((note) => (
              <div
                key={note.id}
                className="border border-border rounded-lg p-4 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <button
                    onClick={() => handleSeek(note.timestamp_seconds)}
                    className="flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={note.timestamp_seconds === null}
                  >
                    <Clock className="w-4 h-4" />
                    {formatTime(note.timestamp_seconds)}
                  </button>
                  <div className="flex items-center gap-1">
                    {editingId === note.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSaveEdit(note.id)}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleCancelEdit}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleStartEdit(note)}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(note.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {editingId === note.id ? (
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="min-h-[80px]"
                  />
                ) : (
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {note.note_text}
                  </p>
                )}

                <p className="text-xs text-muted-foreground mt-2">
                  {format(new Date(note.created_at), "dd/MM/yyyy 'às' HH:mm")}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </Card>
  );
}
