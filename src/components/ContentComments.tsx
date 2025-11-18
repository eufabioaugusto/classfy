import { useState, useEffect } from "react";
import { MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { toast } from "@/hooks/use-toast";
import { z } from "zod";

const commentSchema = z.object({
  text: z.string()
    .trim()
    .min(1, 'Comentário não pode estar vazio')
    .max(1000, 'Comentário deve ter menos de 1000 caracteres')
    .regex(/^[^<>]*$/, 'Caracteres inválidos detectados')
});

interface Comment {
  id: string;
  text: string;
  created_at: string;
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
  const { handleComment } = useRewardSystem();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showComments, setShowComments] = useState(false);

  useEffect(() => {
    if (showComments) {
      fetchComments();
    }
  }, [showComments, contentId]);

  const fetchComments = async () => {
    const { data, error } = await supabase
      .from('comments')
      .select(`
        *,
        profiles:user_id (
          display_name,
          avatar_url
        )
      `)
      .eq('content_id', contentId)
      .is('parent_id', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching comments:', error);
      return;
    }

    setComments(data || []);
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

      const { error } = await supabase
        .from('comments')
        .insert({
          user_id: user.id,
          content_id: contentId,
          text: validated.text,
        });

      if (error) throw error;

      setNewComment("");
      await fetchComments();

      // Process reward
      await handleComment(user.id, contentId, newComment);

      toast({
        title: "Comentário publicado!",
        description: "Seu comentário foi adicionado com sucesso",
      });
    } catch (error) {
      console.error('Error posting comment:', error);
      
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

  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        onClick={() => setShowComments(!showComments)}
        className="gap-2"
      >
        <MessageCircle className="h-5 w-5" />
        <span>{showComments ? 'Ocultar' : 'Ver'} Comentários ({comments.length})</span>
      </Button>

      {showComments && (
        <div className="space-y-4">
          {/* Comment input */}
          {user && (
            <div className="flex gap-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.user_metadata?.avatar_url} />
                <AvatarFallback>
                  {user.user_metadata?.display_name?.[0]?.toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-2">
                <Textarea
                  placeholder="Adicione um comentário..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="min-h-[80px]"
                />
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !newComment.trim()}
                  size="sm"
                  className="gap-2"
                >
                  <Send className="h-4 w-4" />
                  Comentar
                </Button>
              </div>
            </div>
          )}

          {/* Comments list */}
          <div className="space-y-4">
            {comments.map((comment) => (
              <div key={comment.id} className="flex gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={comment.profiles?.avatar_url || ''} />
                  <AvatarFallback>
                    {comment.profiles?.display_name?.[0]?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">
                      {comment.profiles?.display_name || 'Usuário'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(comment.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{comment.text}</p>
                </div>
              </div>
            ))}

            {comments.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                Nenhum comentário ainda. Seja o primeiro!
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
