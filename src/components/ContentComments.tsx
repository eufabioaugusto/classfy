import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Send,
  Smile,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { toast } from "@/hooks/use-toast";
import { z } from "zod";
import EmojiPicker, {
  EmojiClickData,
  EmojiStyle,
  Theme,
} from "emoji-picker-react";

const commentSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Comentário não pode estar vazio")
    .max(1000, "Comentário deve ter menos de 1000 caracteres")
    .regex(/^[^<>]*$/, "Caracteres inválidos detectados"),
});

interface Comment {
  id: string;
  text: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  profiles: {
    display_name: string;
    avatar_url: string | null;
  };
}

interface ContentCommentsProps {
  contentId: string;
}

export function ContentComments({ contentId }: ContentCommentsProps) {
  const { user } = useAuth();
  const { deleteComment, handleComment } = useRewardSystem();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showComments, setShowComments] = useState(true);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    comment: Comment;
    rewardValue: number;
    keepsReward: boolean;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchComments = useCallback(async () => {
    const { data, error } = await supabase
      .from("comments")
      .select(
        `
        *,
        profiles:user_id (
          display_name,
          avatar_url
        )
      `,
      )
      .eq("content_id", contentId)
      .is("parent_id", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching comments:", error);
      return;
    }

    setComments(data || []);
  }, [contentId]);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    const emoji = emojiData.emoji;
    const textarea = textareaRef.current;

    if (!textarea) {
      setNewComment((current) => current + emoji);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setNewComment(
      (current) => current.substring(0, start) + emoji + current.substring(end),
    );

    window.setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
      textarea.focus();
    }, 0);
  };

  const handleSubmit = async () => {
    if (!user) {
      toast({
        title: "Login necessário",
        description: "Faça login para comentar",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Validate comment input
      const validated = commentSchema.parse({ text: newComment });

      const { error } = await supabase.from("comments").insert({
        user_id: user.id,
        content_id: contentId,
        text: validated.text,
      });

      if (error) throw error;

      setNewComment("");
      await fetchComments();

      // Process reward
      await handleComment(user.id, contentId, validated.text);

      toast({
        title: "Comentário publicado!",
        description: "Seu comentário foi adicionado com sucesso",
      });
    } catch (error) {
      console.error("Error posting comment:", error);

      if (error instanceof z.ZodError) {
        toast({
          title: "Erro de validação",
          description: error.errors[0]?.message || "Comentário inválido",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Erro",
          description: "Não foi possível publicar seu comentário",
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEditing = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditingText(comment.text);
  };

  const cancelEditing = () => {
    setEditingCommentId(null);
    setEditingText("");
  };

  const saveEdit = async (commentId: string) => {
    if (!user) return;
    setIsSavingEdit(true);

    try {
      const validated = commentSchema.parse({ text: editingText });
      const { data, error } = await supabase
        .from("comments")
        .update({ text: validated.text })
        .eq("id", commentId)
        .eq("user_id", user.id)
        .select("id, text, updated_at")
        .single();

      if (error) throw error;
      setComments((current) =>
        current.map((comment) =>
          comment.id === commentId
            ? { ...comment, text: data.text, updated_at: data.updated_at }
            : comment,
        ),
      );
      cancelEditing();
      toast({
        title: "Comentário atualizado",
        description: "A edição foi salva sem alterar seus Points.",
      });
    } catch (error) {
      console.error("Error updating comment:", error);
      toast({
        title: "Não foi possível editar",
        description: error instanceof z.ZodError
          ? error.errors[0]?.message
          : "Tente novamente em instantes.",
        variant: "destructive",
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const requestDelete = async (comment: Comment) => {
    if (!user) return;

    let rewardValue = 0;
    let ownCommentCount = 1;
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
    setIsDeleting(true);

    try {
      const result = await deleteComment(
        user.id,
        deleteTarget.comment.id,
        contentId,
      );
      setComments((current) =>
        current.filter((comment) => comment.id !== deleteTarget.comment.id),
      );
      if (editingCommentId === deleteTarget.comment.id) cancelEditing();

      const revertedPoints = Number(result?.points || 0);
      toast({
        title: "Comentário excluído",
        description: revertedPoints > 0
          ? `${revertedPoints} Points foram deduzidos do seu saldo.`
          : result?.other_comments_remaining
            ? "Seus Points permanecem porque você ainda comentou neste conteúdo."
            : "O comentário foi removido.",
      });
      setDeleteTarget(null);
    } catch (error) {
      console.error("Error deleting comment:", error);
      toast({
        title: "Não foi possível excluir",
        description: "O comentário e seus Points foram preservados.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="mb-12 mt-5 overflow-visible rounded-2xl border border-border/60 bg-card/60 shadow-[0_18px_50px_rgba(0,0,0,0.10)] backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setShowComments((current) => !current)}
        className="flex w-full items-center justify-between gap-4 rounded-2xl px-4 py-4 text-left transition-colors hover:bg-muted/30 sm:px-5"
        aria-expanded={showComments}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-500/12 text-red-500 ring-1 ring-inset ring-red-500/20">
            <MessageCircle className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold sm:text-base">
              Comentários
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                {comments.length}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              Compartilhe uma ideia e faça parte da conversa.
            </span>
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
            showComments ? "rotate-180" : ""
          }`}
        />
      </button>

      {showComments && (
        <div className="space-y-6 border-t border-border/50 px-4 py-5 sm:px-5 sm:py-6">
          {/* Comment input */}
          {user && (
            <div className="rounded-2xl border border-border/60 bg-background/65 p-3 shadow-sm sm:p-4">
              <div className="mb-3 flex items-center gap-3">
                <Avatar className="h-9 w-9 ring-2 ring-background">
                  <AvatarImage src={user.user_metadata?.avatar_url} />
                  <AvatarFallback>
                    {user.user_metadata?.display_name?.[0]?.toUpperCase() ||
                      "U"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    Entre na conversa
                    <Sparkles className="h-3.5 w-3.5 text-red-500" />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    O que este conteúdo despertou em você?
                  </p>
                </div>
              </div>

              <div className="relative">
                <Textarea
                  ref={textareaRef}
                  placeholder="Adicione um comentário..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="min-h-[104px] resize-y border-border/60 bg-muted/15 pb-11 pr-12 text-sm focus-visible:ring-red-500/35"
                />
                <Popover
                  open={showEmojiPicker}
                  onOpenChange={setShowEmojiPicker}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Adicionar emoji"
                      className="absolute bottom-2 right-2 h-8 w-8 rounded-full text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Smile className="h-[18px] w-[18px]" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="end"
                    sideOffset={8}
                    className="z-[150] w-[min(350px,calc(100vw-2rem))] border-none bg-background p-0 shadow-2xl"
                  >
                    <EmojiPicker
                      onEmojiClick={handleEmojiClick}
                      width="100%"
                      height={400}
                      theme={Theme.AUTO}
                      emojiStyle={EmojiStyle.APPLE}
                      searchPlaceHolder="Buscar emoji..."
                      previewConfig={{ showPreview: false }}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {newComment.length}/1000
                </span>
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !newComment.trim()}
                  size="sm"
                  className="gap-2 rounded-full bg-red-500 px-4 text-white shadow-[0_8px_24px_rgba(239,68,68,0.20)] hover:bg-red-500/90"
                >
                  <Send className="h-4 w-4" />
                  {isSubmitting ? "Publicando..." : "Comentar"}
                </Button>
              </div>
            </div>
          )}

          {/* Comments list */}
          <div className="space-y-3">
            {comments.map((comment) => (
              <article
                key={comment.id}
                className="flex gap-3 rounded-xl border border-border/40 bg-muted/15 p-3.5"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={comment.profiles?.avatar_url || ""} />
                  <AvatarFallback>
                    {comment.profiles?.display_name?.[0]?.toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">
                      {comment.profiles?.display_name || "Usuário"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(comment.created_at).toLocaleDateString("pt-BR")}
                    </span>
                    {comment.updated_at !== comment.created_at && (
                      <span className="text-[10px] text-muted-foreground/70">
                        editado
                      </span>
                    )}
                    {user?.id === comment.user_id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Opções do comentário"
                            className="ml-auto h-7 w-7 rounded-full text-muted-foreground"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            className="gap-2"
                            onSelect={() => startEditing(comment)}
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
                    <div className="space-y-2 pt-1">
                      <Textarea
                        value={editingText}
                        onChange={(event) => setEditingText(event.target.value)}
                        className="min-h-[88px] resize-y bg-background/70 text-sm focus-visible:ring-red-500/35"
                        maxLength={1000}
                        autoFocus
                      />
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {editingText.length}/1000
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={cancelEditing}
                            disabled={isSavingEdit}
                            className="rounded-full"
                          >
                            Cancelar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void saveEdit(comment.id)}
                            disabled={isSavingEdit || !editingText.trim()}
                            className="rounded-full bg-red-500 text-white hover:bg-red-500/90"
                          >
                            {isSavingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                            Salvar edição
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                      {comment.text}
                    </p>
                  )}
                </div>
              </article>
            ))}

            {comments.length === 0 && (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-7 text-center">
                <MessageCircle className="mx-auto mb-2 h-5 w-5 text-muted-foreground/60" />
                <p className="text-sm font-medium">Comece a conversa</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Seu comentário pode abrir uma nova perspectiva para alguém.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null);
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
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir comentário
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
