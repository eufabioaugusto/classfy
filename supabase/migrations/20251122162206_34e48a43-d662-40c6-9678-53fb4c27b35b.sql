-- Políticas RLS para tabela boosts

-- Permitir que usuários vejam seus próprios boosts
CREATE POLICY "Users can view own boosts"
ON public.boosts
FOR SELECT
USING (auth.uid() = user_id);

-- Permitir que usuários insiram seus próprios boosts
CREATE POLICY "Users can create own boosts"
ON public.boosts
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Permitir que usuários atualizem seus próprios boosts (exceto status ativo)
CREATE POLICY "Users can update own boosts"
ON public.boosts
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Permitir que usuários deletem seus próprios boosts pendentes
CREATE POLICY "Users can delete own pending boosts"
ON public.boosts
FOR DELETE
USING (
  auth.uid() = user_id 
  AND status = 'pending_payment'
);