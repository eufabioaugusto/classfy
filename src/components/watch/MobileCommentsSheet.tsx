import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Comment {
  id: string;
  text: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  profiles?: {
    display_name: string;
    avatar_url: string | null;
  } | null;
}

interface MobileCommentsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
}

export function MobileCommentsSheet({ open, onOpenChange, contentId }: MobileCommentsSheetProps) {
  const { user, profile } = useAuth();
  const { deleteComment, handleComment } = useRewardSystem();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    comment: Comment;
    rewardValue: number;
    keepsReward: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open && contentId) {
      fetchComments();
    }
  }, [open, contentId]);

  const fetchComments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("comments")
        .select(`
          id,
          text,
          created_at,
          updated_at,
          user_id,
          profiles:user_id(display_name, avatar_url)
        `)
        .eq("content_id", contentId)
        .is("parent_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setComments(data || []);
    } catch (error) {
      console.error("Error fetching comments:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!user || !newComment.trim()) return;

    try {
      setSubmitting(true);
      const { error } = await supabase.from("comments").insert({
        content_id: contentId,
        user_id: user.id,
        text: newComment.trim(),
      });

      if (error) throw error;

      await handleComment(user.id, contentId, newComment.trim());
      setNewComment("");
      await fetchComments();
      toast.success("Comentário adicionado!");
    } catch (error) {
      console.error("Error adding comment:", error);
      toast.error("Erro ao adicionar comentário");
    } finally {
      setSubmitting(false);
    }
  };

  const saveEdit = async (commentId: string) => {
    if (!user || !editingText.trim()) return;

    try {
      setSavingEdit(true);
      const { data, error } = await supabase
        .from("comments")
        .update({ text: editingText.trim() })
        .eq("id", commentId)
        .eq("user_id", user.id)
        .select("id, text, updated_at")
        .single();
      if (error) throw error;

      setComments((current) => current.map((comment) => (
        comment.id === commentId
          ? { ...comment, text: data.text, updated_at: data.updated_at }
          : comment
      )));
      setEditingCommentId(null);
      setEditingText("");
      toast.success("Comentário atualizado sem alterar seus Points.");
    } catch (error) {
      console.error("Error updating comment:", error);
      toast.error("Não foi possível editar o comentário");
    } finally {
      setSavingEdit(false);
    }
  };

  const requestDelete = async (comment: Comment) => {
    if (!user) return;

    let ownCommentCount = 1;
    let rewardValue = 0;
    try {
      const [commentsResult, rewardResult] = await Promise.all([
        supabase
          .from("comments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("content_id", contentId),
        supabase
          .from("reward_events")
          .select("points")
          .eq("user_id", user.id)
          .eq("content_id", contentId)
          .eq("action_key", "COMMENT")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (commentsResult.error) throw commentsResult.error;
      ownCommentCount = commentsResult.count || 1;
      if (!rewardResult.error && ownCommentCount <= 1) {
        rewardValue = Number(rewardResult.data?.points || 0);
      }
    } catch (error) {
      console.warn("Could not calculate comment deletion impact:", error);
    }

    setDeleteTarget({
      comment,
      rewardValue,
      keepsReward: ownCommentCount > 1,
    });
  };

  const confirmDelete = async () => {
    if (!user || !deleteTarget) return;

    try {
      setDeleting(true);
      const result = await deleteComment(user.id, deleteTarget.comment.id, contentId);
      setComments((current) => current.filter((comment) => comment.id !== deleteTarget.comment.id));
      if (editingCommentId === deleteTarget.comment.id) {
        setEditingCommentId(null);
        setEditingText("");
      }
      const revertedPoints = Number(result?.points || 0);
      toast.success(
        revertedPoints > 0
          ? `${revertedPoints} Points foram deduzidos do seu saldo.`
          : result?.other_comments_remaining
            ? "Comentário excluído. Seus Points permanecem porque existe outro comentário."
            : "Comentário excluído.",
      );
      setDeleteTarget(null);
    } catch (error) {
      console.error("Error deleting comment:", error);
      toast.error("Não foi possível excluir. O comentário e seus Points foram preservados.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="bottom" 
        className="h-[80vh] rounded-t-3xl p-0 flex flex-col"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b">
          <SheetTitle className="text-base font-semibold">
            Comentários ({comments.length})
          </SheetTitle>
        </div>

        {/* Comments List */}
        <ScrollArea className="flex-1 px-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground text-sm">
                Nenhum comentário ainda
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                Seja o primeiro a comentar!
              </p>
            </div>
          ) : (
            <div className="py-4 space-y-4">
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarImage src={comment.profiles?.avatar_url || ""} />
                    <AvatarFallback className="text-xs">
                      {comment.profiles?.display_name?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium truncate">
                        {comment.profiles?.display_name || "Usuário"}
                      </span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatDistanceToNow(new Date(comment.created_at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                      {comment.updated_at !== comment.created_at && (
                        <span className="text-[10px] text-muted-foreground/70">editado</span>
                      )}
                      {user?.id === comment.user_id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Opções do comentário"
                              className="ml-auto h-7 w-7 rounded-full"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="gap-2"
                              onSelect={() => {
                                setEditingCommentId(comment.id);
                                setEditingText(comment.text);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2 text-destructive focus:text-destructive"
                              onSelect={() => void requestDelete(comment)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    {editingCommentId === comment.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editingText}
                          onChange={(event) => setEditingText(event.target.value)}
                          maxLength={1000}
                          className="min-h-[88px] resize-y text-sm"
                          autoFocus
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {editingText.length}/1000
                          </span>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={savingEdit}
                              onClick={() => {
                                setEditingCommentId(null);
                                setEditingText("");
                              }}
                            >
                              Cancelar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={savingEdit || !editingText.trim()}
                              onClick={() => void saveEdit(comment.id)}
                            >
                              {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                              Salvar
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm text-foreground/90 break-words">
                        {comment.text}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Input Area */}
        {user ? (
          <div className="border-t p-3 flex gap-2 items-end bg-background">
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarImage src={profile?.avatar_url || ""} />
              <AvatarFallback className="text-xs">
                {profile?.display_name?.[0] || "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 relative">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Adicione um comentário..."
                className="min-h-[40px] max-h-[100px] resize-none pr-10 text-sm"
                rows={1}
              />
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 bottom-1 h-8 w-8 text-primary"
                onClick={handleSubmit}
                disabled={!newComment.trim() || submitting}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="border-t p-4 text-center text-sm text-muted-foreground">
            Faça login para comentar
          </div>
        )}
      </SheetContent>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este comentário?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.rewardValue ? (
                <>
                  O comentário será removido e você perderá{" "}
                  <span className="font-bold text-destructive">
                    {deleteTarget.rewardValue} Points
                  </span>
                  .
                </>
              ) : deleteTarget?.keepsReward ? (
                "O comentário será removido. Seus Points permanecem porque você ainda possui outro comentário neste conteúdo."
              ) : (
                "O comentário será removido permanentemente."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir comentário
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
