import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Clock, Trash2, Edit2, Check, X, StickyNote } from "lucide-react";
import { format } from "date-fns";

interface StudyNotesProps {
  embedded?: boolean;
  studyId: string;
  activeContentId: string | null;
  currentTime?: number;
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

export function StudyNotes({ embedded = false, studyId, activeContentId, currentTime = 0, onSeekToTimestamp }: StudyNotesProps) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [newText, setNewText] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadNotes();
  }, [studyId, activeContentId, user?.id]);

  const loadNotes = async () => {
    if (!user) {
      setNotes([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      let query = supabase
        .from("study_notes")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (activeContentId) {
        query = query.eq("content_id", activeContentId);
      } else {
        query = query.eq("study_id", studyId);
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

  const handleCreate = async () => {
    if (!user || !activeContentId || !newText.trim() || saving) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from("study_notes").insert({
        user_id: user.id, content_id: activeContentId, study_id: null,
        note_text: newText.trim(), timestamp_seconds: Math.max(0, Math.floor(currentTime)),
      }).select("*").single();
      if (error) throw error;
      setNotes((previous) => [data, ...previous]);
      setNewText("");
      toast({ title: "Anotação salva" });
    } catch {
      toast({ title: "Não foi possível salvar a anotação", description: "Seu texto foi mantido. Tente novamente.", variant: "destructive" });
    } finally { setSaving(false); }
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
    if (!editText.trim() || saving) return;
    setSaving(true);
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
    } finally { setSaving(false); }
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
      <Card className={embedded ? "cf-study-notes border-0 shadow-none p-0" : "p-4 sm:p-6"}>
        <p className="text-sm text-muted-foreground">Carregando anotações...</p>
      </Card>
    );
  }

  return (
    <Card className={embedded ? "cf-study-notes border-0 shadow-none p-0" : "p-4 sm:p-6"}>
      {!embedded && <div className="flex items-center gap-2 mb-4">
        <StickyNote className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">Minhas Anotações</h3>
        <span className="text-sm text-muted-foreground">({notes.length})</span>
      </div>}

      {user && activeContentId && <div className="mb-5 space-y-2">
        <label htmlFor="watch-note-text" className="text-xs text-muted-foreground">Anotar em {formatTime(Math.floor(currentTime))}</label>
        <Textarea id="watch-note-text" placeholder="O que você quer guardar desta aula?" value={newText} onChange={(event) => setNewText(event.target.value)} className="min-h-[132px] rounded-2xl bg-muted/25 p-4 text-sm leading-relaxed focus-visible:ring-red-500/30" />
        <Button onClick={handleCreate} disabled={saving || !newText.trim()} className="h-12 w-full rounded-xl bg-red-500 text-white hover:bg-red-600">{saving ? "Salvando..." : "Salvar anotação"}</Button>
      </div>}
      {notes.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <StickyNote className="w-6 h-6 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhuma anotação ainda.</p>
          <p className="text-xs mt-1">
            {activeContentId
              ? "Escreva sua primeira anotação acima."
              : "Selecione um conteúdo para fazer anotações."}
          </p>
        </div>
      ) : (
        <ScrollArea className={embedded ? "pr-0" : "h-[500px] pr-4"}>
          <div className="space-y-3">
            {notes.map((note) => (
              <div
                key={note.id}
                className="border border-border rounded-2xl p-4 hover:bg-accent/50 transition-colors"
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
                          aria-label="Salvar edição"
                          disabled={saving || !editText.trim()}
                          onClick={() => handleSaveEdit(note.id)}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Cancelar edição"
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
                          aria-label="Editar anotação"
                          onClick={() => handleStartEdit(note)}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Excluir anotação"
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
