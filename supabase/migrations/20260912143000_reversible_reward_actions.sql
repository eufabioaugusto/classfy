-- Recompensas de acoes reversiveis seguem o estado atual da acao.
--
-- Enquanto like, salvo, favorito ou follow estiver ativo, o par de eventos
-- (User Points + Creator Points) permanece no ciclo aberto. Ao remover a
-- acao, ambos sao arquivados em reward_event_reversals, os totais do ciclo
-- sao recompostos e a chave de idempotencia e liberada. Uma nova ativacao
-- pode, portanto, receber novamente a recompensa sem permitir saldo liquido
-- duplicado: existe no maximo uma evidencia e uma chave ativa por alvo.

CREATE OR REPLACE FUNCTION public.reverse_reward_award(
  p_user_id uuid,
  p_content_id uuid,
  p_action_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action_key text := upper(btrim(p_action_key));
  v_reward public.reward_events%ROWTYPE;
  v_creator public.reward_events%ROWTYPE;
  v_tracking_key text;
  v_cycle_status text;
  v_action_removed integer := 0;
  v_tracking_released integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_user_id IS NULL OR p_content_id IS NULL THEN
    RAISE EXCEPTION 'reversal_target_required';
  END IF;
  IF v_action_key NOT IN ('LIKE', 'SAVE', 'FAVORITE', 'SUBSCRIBE_CREATOR') THEN
    RAISE EXCEPTION 'reward_action_not_reversible';
  END IF;

  v_tracking_key := v_action_key || '_' || p_content_id::text;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || v_tracking_key, 0)
  );

  -- A evidencia e o ledger mudam na mesma transacao. Para follow, o alvo e o
  -- creator; para as demais acoes, e um conteudo ou curso.
  IF v_action_key = 'LIKE' THEN
    DELETE FROM public.actions
    WHERE user_id = p_user_id
      AND type = 'LIKE'
      AND (content_id = p_content_id OR course_id = p_content_id);
  ELSIF v_action_key = 'SAVE' THEN
    DELETE FROM public.saved_contents
    WHERE user_id = p_user_id
      AND (content_id = p_content_id OR course_id = p_content_id);
  ELSIF v_action_key = 'FAVORITE' THEN
    DELETE FROM public.favorites
    WHERE user_id = p_user_id
      AND (content_id = p_content_id OR course_id = p_content_id);
  ELSE
    DELETE FROM public.follows
    WHERE follower_id = p_user_id
      AND following_id = p_content_id;
  END IF;
  GET DIAGNOSTICS v_action_removed = ROW_COUNT;

  SELECT * INTO v_reward
  FROM public.reward_events
  WHERE user_id = p_user_id
    AND action_key = v_action_key
    AND COALESCE(metadata->>'as_creator', 'false') <> 'true'
    AND (
      metadata->>'tracking_key' = v_tracking_key
      OR content_id = p_content_id
      OR metadata->>'course_id' = p_content_id::text
      OR (v_action_key = 'SUBSCRIBE_CREATOR' AND related_user_id = p_content_id)
    )
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- Limpa tombstones produzidos pelo contrato anterior. Nao ha evento ativo
  -- para deduzir, mas a chave nao pode continuar bloqueando a proxima acao.
  IF NOT FOUND THEN
    DELETE FROM public.reward_action_tracking
    WHERE user_id = p_user_id AND action_key = v_tracking_key;
    GET DIAGNOSTICS v_tracking_released = ROW_COUNT;

    RETURN jsonb_build_object(
      'reversed', false,
      'action_removed', v_action_removed > 0,
      'tracking_released', v_tracking_released > 0,
      'reaward_allowed', true,
      'points', 0
    );
  END IF;

  SELECT status INTO v_cycle_status
  FROM public.economic_cycles
  WHERE id = v_reward.cycle_id;

  -- Ciclos fechados sao imutaveis. A acao social pode ser removida, mas os
  -- valores ja fechados e a deduplicacao historica permanecem definitivos.
  IF v_cycle_status IS DISTINCT FROM 'open' THEN
    RETURN jsonb_build_object(
      'reversed', false,
      'action_removed', v_action_removed > 0,
      'cycle_closed', true,
      'reaward_allowed', false,
      'points', 0
    );
  END IF;

  SELECT * INTO v_creator
  FROM public.reward_events
  WHERE related_user_id = p_user_id
    AND action_key = v_action_key
    AND metadata->>'as_creator' = 'true'
    AND (
      metadata->>'tracking_key' = v_tracking_key
      OR content_id = p_content_id
      OR metadata->>'course_id' = p_content_id::text
      OR (v_action_key = 'SUBSCRIBE_CREATOR' AND user_id = p_content_id)
    )
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO public.reward_event_reversals(
    original_reward_event_id, affected_user_id, initiated_by,
    action_key, reason, event_snapshot
  ) VALUES (
    v_reward.id, v_reward.user_id, p_user_id,
    v_action_key, 'source_action_reversed', to_jsonb(v_reward)
  ) ON CONFLICT (original_reward_event_id) DO NOTHING;

  DELETE FROM public.reward_events WHERE id = v_reward.id;
  UPDATE public.economic_cycle_users
  SET performance_points = GREATEST(0, performance_points - COALESCE(v_reward.performance_points, 0)),
      user_points = GREATEST(0, user_points - CASE WHEN v_reward.point_type = 'user'
        THEN COALESCE(v_reward.cycle_points, 0) ELSE 0 END),
      creator_points = GREATEST(0, creator_points - CASE WHEN v_reward.point_type = 'creator'
        THEN COALESCE(v_reward.cycle_points, 0) ELSE 0 END),
      cycle_points = GREATEST(0, cycle_points - COALESCE(v_reward.cycle_points, 0)),
      updated_at = now()
  WHERE cycle_id = v_reward.cycle_id AND user_id = v_reward.user_id;

  IF v_creator.id IS NOT NULL THEN
    INSERT INTO public.reward_event_reversals(
      original_reward_event_id, affected_user_id, initiated_by,
      action_key, reason, event_snapshot
    ) VALUES (
      v_creator.id, v_creator.user_id, p_user_id,
      v_action_key, 'source_action_reversed', to_jsonb(v_creator)
    ) ON CONFLICT (original_reward_event_id) DO NOTHING;

    DELETE FROM public.reward_events WHERE id = v_creator.id;
    UPDATE public.economic_cycle_users
    SET performance_points = GREATEST(0, performance_points - COALESCE(v_creator.performance_points, 0)),
        user_points = GREATEST(0, user_points - CASE WHEN v_creator.point_type = 'user'
          THEN COALESCE(v_creator.cycle_points, 0) ELSE 0 END),
        creator_points = GREATEST(0, creator_points - CASE WHEN v_creator.point_type = 'creator'
          THEN COALESCE(v_creator.cycle_points, 0) ELSE 0 END),
        cycle_points = GREATEST(0, cycle_points - COALESCE(v_creator.cycle_points, 0)),
        updated_at = now()
    WHERE cycle_id = v_creator.cycle_id AND user_id = v_creator.user_id;
  END IF;

  DELETE FROM public.reward_action_tracking
  WHERE user_id = p_user_id AND action_key = v_tracking_key;
  GET DIAGNOSTICS v_tracking_released = ROW_COUNT;

  RETURN jsonb_build_object(
    'reversed', true,
    'action_removed', v_action_removed > 0,
    'tracking_released', v_tracking_released > 0,
    'reaward_allowed', true,
    'performance_points_reverted', COALESCE(v_reward.performance_points, 0),
    'creator_pp_reverted', COALESCE(v_creator.performance_points, 0),
    'points', COALESCE(v_reward.points, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_reward_award(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_reward_award(uuid, uuid, text)
  TO service_role;

-- O contrato antigo deixou likes reativados sem evento economico e com um
-- tombstone bloqueando novo pagamento. Reiniciamos somente esses estados
-- inconsistentes; o trigger de actions recompõe likes_count automaticamente.
DELETE FROM public.actions a
USING public.reward_action_tracking t
WHERE t.user_id = a.user_id
  AND t.metadata->>'reversed' = 'true'
  AND t.action_key = 'LIKE_' || COALESCE(a.content_id, a.course_id)::text;

DELETE FROM public.reward_action_tracking
WHERE metadata->>'reversed' = 'true'
  AND action_key LIKE 'LIKE_%';
