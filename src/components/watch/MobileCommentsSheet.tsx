import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Send, Heart, MoreHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Comment {
  id: string;
  text: string;
  created_at: string;
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
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

      setNewComment("");
      fetchComments();
      toast.success("Comentário adicionado!");
    } catch (error) {
      console.error("Error adding comment:", error);
      toast.error("Erro ao adicionar comentário");
    } finally {
      setSubmitting(false);
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
                    </div>
                    <p className="text-sm text-foreground/90 break-words">
                      {comment.text}
                    </p>
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
    </Sheet>
  );
}
