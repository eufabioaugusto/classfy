-- Exclui um comentario proprio e, quando ele era a ultima evidencia ativa da
-- acao COMMENT no conteudo, reverte os Points do usuario e do creator na mesma
-- transacao. Editar preserva a recompensa porque a acao continua existindo.

CREATE OR REPLACE FUNCTION public.delete_comment_with_reward_reversal(
  p_user_id uuid,
  p_comment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_content_id uuid;
  v_reward public.reward_events%ROWTYPE;
  v_creator public.reward_events%ROWTYPE;
  v_cycle_status text;
  v_tracking_key text;
  v_remaining_comments boolean := false;
  v_tracking_released integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_user_id IS NULL OR p_comment_id IS NULL THEN
    RAISE EXCEPTION 'comment_delete_target_required';
  END IF;

  SELECT content_id INTO v_content_id
  FROM public.comments
  WHERE id = p_comment_id AND user_id = p_user_id
  FOR UPDATE;

  IF v_content_id IS NULL THEN
    RETURN jsonb_build_object(
      'removed', false,
      'comment_not_found', true,
      'reversed', false,
      'points', 0
    );
  END IF;

  v_tracking_key := 'COMMENT_' || v_content_id::text;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || v_tracking_key, 0)
  );

  DELETE FROM public.comments
  WHERE id = p_comment_id AND user_id = p_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.comments
    WHERE user_id = p_user_id AND content_id = v_content_id
  ) INTO v_remaining_comments;

  -- COMMENT remunera a participacao no conteudo uma vez, nao cada mensagem.
  -- Se ainda existe outro comentario, a evidencia economica permanece valida.
  IF v_remaining_comments THEN
    RETURN jsonb_build_object(
      'removed', true,
      'reversed', false,
      'other_comments_remaining', true,
      'reaward_allowed', false,
      'points', 0,
      'content_id', v_content_id
    );
  END IF;

  SELECT * INTO v_reward
  FROM public.reward_events
  WHERE user_id = p_user_id
    AND action_key = 'COMMENT'
    AND content_id = v_content_id
    AND COALESCE(metadata->>'as_creator', 'false') <> 'true'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_reward.id IS NULL THEN
    DELETE FROM public.reward_action_tracking
    WHERE user_id = p_user_id AND action_key = v_tracking_key;
    GET DIAGNOSTICS v_tracking_released = ROW_COUNT;

    RETURN jsonb_build_object(
      'removed', true,
      'reversed', false,
      'tracking_released', v_tracking_released > 0,
      'reaward_allowed', true,
      'points', 0,
      'content_id', v_content_id
    );
  END IF;

  SELECT status INTO v_cycle_status
  FROM public.economic_cycles
  WHERE id = v_reward.cycle_id;

  -- Ciclos liquidados sao imutaveis. O comentario pode ser removido, mas o
  -- historico economico fechado nao e reescrito silenciosamente.
  IF v_cycle_status IS DISTINCT FROM 'open' THEN
    RETURN jsonb_build_object(
      'removed', true,
      'reversed', false,
      'cycle_closed', true,
      'reaward_allowed', false,
      'points', 0,
      'content_id', v_content_id
    );
  END IF;

  SELECT * INTO v_creator
  FROM public.reward_events
  WHERE related_user_id = p_user_id
    AND action_key = 'COMMENT'
    AND content_id = v_content_id
    AND metadata->>'as_creator' = 'true'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO public.reward_event_reversals(
    original_reward_event_id,
    affected_user_id,
    initiated_by,
    action_key,
    reason,
    event_snapshot
  ) VALUES (
    v_reward.id,
    v_reward.user_id,
    p_user_id,
    'COMMENT',
    'source_comment_deleted',
    to_jsonb(v_reward)
  ) ON CONFLICT (original_reward_event_id) DO NOTHING;

  DELETE FROM public.reward_events WHERE id = v_reward.id;
  UPDATE public.economic_cycle_users
  SET performance_points = GREATEST(
        0,
        performance_points - COALESCE(v_reward.performance_points, 0)
      ),
      user_points = GREATEST(
        0,
        user_points - CASE WHEN v_reward.point_type = 'user'
          THEN COALESCE(v_reward.cycle_points, 0) ELSE 0 END
      ),
      creator_points = GREATEST(
        0,
        creator_points - CASE WHEN v_reward.point_type = 'creator'
          THEN COALESCE(v_reward.cycle_points, 0) ELSE 0 END
      ),
      cycle_points = GREATEST(
        0,
        cycle_points - COALESCE(v_reward.cycle_points, 0)
      ),
      updated_at = now()
  WHERE cycle_id = v_reward.cycle_id AND user_id = v_reward.user_id;

  IF v_creator.id IS NOT NULL THEN
    INSERT INTO public.reward_event_reversals(
      original_reward_event_id,
      affected_user_id,
      initiated_by,
      action_key,
      reason,
      event_snapshot
    ) VALUES (
      v_creator.id,
      v_creator.user_id,
      p_user_id,
      'COMMENT',
      'source_comment_deleted',
      to_jsonb(v_creator)
    ) ON CONFLICT (original_reward_event_id) DO NOTHING;

    DELETE FROM public.reward_events WHERE id = v_creator.id;
    UPDATE public.economic_cycle_users
    SET performance_points = GREATEST(
          0,
          performance_points - COALESCE(v_creator.performance_points, 0)
        ),
        user_points = GREATEST(
          0,
          user_points - CASE WHEN v_creator.point_type = 'user'
            THEN COALESCE(v_creator.cycle_points, 0) ELSE 0 END
        ),
        creator_points = GREATEST(
          0,
          creator_points - CASE WHEN v_creator.point_type = 'creator'
            THEN COALESCE(v_creator.cycle_points, 0) ELSE 0 END
        ),
        cycle_points = GREATEST(
          0,
          cycle_points - COALESCE(v_creator.cycle_points, 0)
        ),
        updated_at = now()
    WHERE cycle_id = v_creator.cycle_id AND user_id = v_creator.user_id;
  END IF;

  DELETE FROM public.reward_action_tracking
  WHERE user_id = p_user_id AND action_key = v_tracking_key;
  GET DIAGNOSTICS v_tracking_released = ROW_COUNT;

  RETURN jsonb_build_object(
    'removed', true,
    'reversed', true,
    'tracking_released', v_tracking_released > 0,
    'reaward_allowed', true,
    'performance_points_reverted', COALESCE(v_reward.performance_points, 0),
    'creator_pp_reverted', COALESCE(v_creator.performance_points, 0),
    'points', COALESCE(v_reward.points, 0),
    'content_id', v_content_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_comment_with_reward_reversal(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_comment_with_reward_reversal(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.delete_comment_with_reward_reversal(uuid, uuid) IS
  'Exclui comentario proprio e reverte COMMENT no ciclo aberto quando nao resta outra evidencia.';
