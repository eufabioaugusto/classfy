-- A exclusao de comentarios remunerados precisa passar pela RPC atomica que
-- remove a evidencia e recompõe o ciclo economico na mesma transacao.
-- Sem uma policy DELETE para authenticated, o cliente nao consegue contornar
-- a reversao chamando a tabela comments diretamente.

DROP POLICY IF EXISTS "Users can delete own comments" ON public.comments;

COMMENT ON FUNCTION public.delete_comment_with_reward_reversal(uuid, uuid) IS
  'Unico caminho de exclusao de comentario: remove a evidencia e reverte COMMENT no ciclo aberto quando necessario.';
