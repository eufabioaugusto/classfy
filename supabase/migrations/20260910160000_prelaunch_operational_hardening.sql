-- Hardening operacional pre-lancamento.
-- Mantem a arquitetura atual, mas remove mutacoes financeiras pelo cliente e
-- torna os caminhos criticos idempotentes/transacionais.

-- ---------------------------------------------------------------------------
-- Conteudo: nenhum conteudo da Classfy e anonimo. Discovery exige sessao.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Published content viewable by all" ON public.contents;
DROP POLICY IF EXISTS "Approved content viewable by all" ON public.contents;
DROP POLICY IF EXISTS "All content viewable for discovery" ON public.contents;
CREATE POLICY "Authenticated users view approved content"
ON public.contents FOR SELECT TO authenticated
USING (
  status = 'approved'
  OR creator_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Approved courses viewable by all" ON public.courses;
DROP POLICY IF EXISTS "All courses viewable for discovery" ON public.courses;
CREATE POLICY "Authenticated users view approved courses"
ON public.courses FOR SELECT TO authenticated
USING (
  status = 'approved'
  OR creator_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Creator aprovado pode editar o proprio item, mas nunca aprovar/publicar a si
-- mesmo nem transferir a autoria.
CREATE OR REPLACE FUNCTION public.protect_content_curation_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.creator_id IS DISTINCT FROM OLD.creator_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'curation_fields_are_admin_managed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contents_protect_curation_fields ON public.contents;
CREATE TRIGGER contents_protect_curation_fields
BEFORE UPDATE ON public.contents
FOR EACH ROW EXECUTE FUNCTION public.protect_content_curation_fields();

DROP TRIGGER IF EXISTS courses_protect_curation_fields ON public.courses;
CREATE TRIGGER courses_protect_curation_fields
BEFORE UPDATE ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.protect_content_curation_fields();

DROP POLICY IF EXISTS "Creators can insert own content" ON public.contents;
DROP POLICY IF EXISTS "Approved creators can insert content" ON public.contents;
DROP POLICY IF EXISTS "Creators and admins can upload content" ON public.contents;
DROP POLICY IF EXISTS "Creators can update own content" ON public.contents;
DROP POLICY IF EXISTS "Creators can delete own content" ON public.contents;
CREATE POLICY "Approved creators insert pending content"
ON public.contents FOR INSERT TO authenticated
WITH CHECK (
  creator_id = auth.uid() AND status = 'pending'
  AND public.has_role(auth.uid(), 'creator'::public.app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.creator_status = 'approved'
  )
);
CREATE POLICY "Approved creators update own content"
ON public.contents FOR UPDATE TO authenticated
USING (
  creator_id = auth.uid()
  AND public.has_role(auth.uid(), 'creator'::public.app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.creator_status = 'approved'
  )
)
WITH CHECK (creator_id = auth.uid());
CREATE POLICY "Approved creators delete own content"
ON public.contents FOR DELETE TO authenticated
USING (
  creator_id = auth.uid()
  AND public.has_role(auth.uid(), 'creator'::public.app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.creator_status = 'approved'
  )
);

DROP POLICY IF EXISTS "Creators can create courses" ON public.courses;
DROP POLICY IF EXISTS "Creators can update own courses" ON public.courses;
DROP POLICY IF EXISTS "Creators can delete own courses" ON public.courses;
CREATE POLICY "Approved creators insert pending courses"
ON public.courses FOR INSERT TO authenticated
WITH CHECK (
  creator_id = auth.uid() AND status = 'pending'
  AND public.has_role(auth.uid(), 'creator'::public.app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.creator_status = 'approved'
  )
);
CREATE POLICY "Approved creators update own courses"
ON public.courses FOR UPDATE TO authenticated
USING (
  creator_id = auth.uid()
  AND public.has_role(auth.uid(), 'creator'::public.app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.creator_status = 'approved'
  )
)
WITH CHECK (creator_id = auth.uid());
CREATE POLICY "Approved creators delete own courses"
ON public.courses FOR DELETE TO authenticated
USING (
  creator_id = auth.uid()
  AND public.has_role(auth.uid(), 'creator'::public.app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.creator_status = 'approved'
  )
);

DROP POLICY IF EXISTS "Lives públicas são visíveis para todos" ON public.lives;
CREATE POLICY "Authenticated users view lives"
ON public.lives FOR SELECT TO authenticated
USING (
  status IN ('scheduled', 'live', 'ended')
  OR creator_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Perfis deixavam inclusive billing_id/plan disponiveis anonimamente.
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by all" ON public.profiles;
DROP POLICY IF EXISTS "Public can view basic profile info" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can view public profile info" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view basic profile data" ON public.profiles;
CREATE POLICY "Authenticated users can view profile data"
ON public.profiles FOR SELECT TO authenticated
USING (true);

-- ---------------------------------------------------------------------------
-- Impedir elevacao de plano/creator/billing pelo UPDATE generico do perfil.
-- O proprio usuario ainda pode solicitar creator_status=pending.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_operational_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at
     OR NEW.billing_id IS DISTINCT FROM OLD.billing_id THEN
    RAISE EXCEPTION 'financial_profile_fields_are_server_managed';
  END IF;

  IF NEW.creator_status IS DISTINCT FROM OLD.creator_status
     AND NOT (OLD.creator_status IN ('none', 'rejected') AND NEW.creator_status = 'pending') THEN
    RAISE EXCEPTION 'creator_status_transition_not_allowed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_operational_fields ON public.profiles;
CREATE TRIGGER profiles_protect_operational_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_operational_fields();

-- ---------------------------------------------------------------------------
-- Escritas que so podem vir de funcoes server-side/service_role.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create own purchases" ON public.purchased_contents;
DROP POLICY IF EXISTS "Users can update own wallet" ON public.wallets;
DROP POLICY IF EXISTS "System can insert reward events" ON public.reward_events;
DROP POLICY IF EXISTS "System can insert tracking" ON public.reward_action_tracking;
DROP POLICY IF EXISTS "System can upsert cycle users" ON public.economic_cycle_users;
DROP POLICY IF EXISTS "System can update cycle users" ON public.economic_cycle_users;
DROP POLICY IF EXISTS "System can insert revenue entries" ON public.revenue_entries;
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "System can insert views" ON public.content_views;
DROP POLICY IF EXISTS "System can update views" ON public.content_views;
DROP POLICY IF EXISTS "System can insert progress" ON public.creator_milestone_progress;
DROP POLICY IF EXISTS "System can update progress" ON public.creator_milestone_progress;
DROP POLICY IF EXISTS "System can insert conversions" ON public.referral_conversions;
DROP POLICY IF EXISTS "System can update conversions" ON public.referral_conversions;
DROP POLICY IF EXISTS "System can insert commissions" ON public.referral_commissions;
DROP POLICY IF EXISTS "System can update commissions" ON public.referral_commissions;
DROP POLICY IF EXISTS "Sistema pode inserir transações" ON public.live_gift_transactions;
DROP POLICY IF EXISTS "System can insert video jobs" ON public.video_processing_jobs;
DROP POLICY IF EXISTS "System can update video jobs" ON public.video_processing_jobs;
DROP POLICY IF EXISTS "System can insert transcriptions" ON public.transcriptions;
DROP POLICY IF EXISTS "System can update transcriptions" ON public.transcriptions;

-- Saque passa por RPC com validacao e reserva logica do saldo.
DROP POLICY IF EXISTS "Users can create own withdrawals" ON public.withdraw_requests;

CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_amount numeric,
  p_pix_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_wallet public.wallets%ROWTYPE;
  v_pending numeric := 0;
  v_minimum numeric := 0;
  v_request_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF NULLIF(btrim(p_pix_key), '') IS NULL THEN RAISE EXCEPTION 'pix_key_required'; END IF;

  SELECT COALESCE((config_value #>> '{}')::numeric, 0)
  INTO v_minimum
  FROM public.system_config
  WHERE config_key = 'min_withdrawal_amount';

  IF p_amount < COALESCE(v_minimum, 0) THEN RAISE EXCEPTION 'below_minimum_withdrawal'; END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found'; END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_pending
  FROM public.withdraw_requests
  WHERE user_id = v_user_id AND status = 'pending';

  IF p_amount + v_pending > v_wallet.balance THEN RAISE EXCEPTION 'insufficient_available_balance'; END IF;

  INSERT INTO public.withdraw_requests (user_id, wallet_id, amount, pix_key, status)
  VALUES (v_user_id, v_wallet.id, round(p_amount, 2), btrim(p_pix_key), 'pending')
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, text) TO authenticated;

-- Admin pode aprovar via cliente, mas a funcao valida o papel no servidor e
-- ignora qualquer tentativa de forjar o admin_id.
CREATE OR REPLACE FUNCTION public.approve_withdrawal(
  p_request_id uuid,
  p_admin_id uuid,
  p_admin_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_req public.withdraw_requests%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF auth.role() <> 'service_role' AND p_admin_id IS DISTINCT FROM v_admin_id THEN
    RAISE EXCEPTION 'admin_identity_mismatch';
  END IF;

  UPDATE public.withdraw_requests
  SET status = 'approved', approved_by = COALESCE(v_admin_id, p_admin_id),
      approved_at = now(), admin_notes = p_admin_notes
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO v_req;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdraw_already_processed'; END IF;

  UPDATE public.wallets
  SET balance = balance - v_req.amount,
      total_withdrawn = total_withdrawn + v_req.amount,
      updated_at = now()
  WHERE user_id = v_req.user_id AND balance >= v_req.amount
  RETURNING * INTO v_wallet;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  INSERT INTO public.wallet_transactions (
    wallet_id, type, amount, description, withdraw_request_id,
    idempotency_key
  ) VALUES (
    v_wallet.id, 'withdraw', -v_req.amount,
    'Saque aprovado - R$ ' || v_req.amount::text, v_req.id,
    'withdraw_' || v_req.id::text
  );

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (v_req.user_id, 'withdraw', 'Saque aprovado',
    'Seu saque de R$ ' || v_req.amount::text || ' foi aprovado.');

  RETURN json_build_object('success', true, 'new_balance', v_wallet.balance, 'amount', v_req.amount);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_withdrawal(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal(uuid, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Views: o usuario autenticado so pode registrar a propria identidade.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_content_view(p_user_id uuid, p_content_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := current_date;
  v_creator_id uuid;
  v_status text;
  v_is_new boolean := false;
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'user_identity_mismatch';
  END IF;

  SELECT creator_id, status INTO v_creator_id, v_status
  FROM public.contents WHERE id = p_content_id;
  IF NOT FOUND OR v_status <> 'approved' THEN RAISE EXCEPTION 'content_not_available'; END IF;

  INSERT INTO public.content_views (user_id, content_id, view_date, view_count)
  VALUES (p_user_id, p_content_id, v_today, 1)
  ON CONFLICT (user_id, content_id, view_date)
  DO UPDATE SET view_count = content_views.view_count + 1,
                last_viewed_at = now(), updated_at = now()
  RETURNING (xmax = 0) INTO v_is_new;

  IF v_is_new AND p_user_id <> v_creator_id THEN
    UPDATE public.contents SET views_count = COALESCE(views_count, 0) + 1 WHERE id = p_content_id;
  END IF;

  RETURN jsonb_build_object('is_new_view', v_is_new AND p_user_id <> v_creator_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_course_view(p_user_id uuid, p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := current_date;
  v_creator_id uuid;
  v_status text;
  v_is_new boolean := false;
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'user_identity_mismatch';
  END IF;

  SELECT creator_id, status INTO v_creator_id, v_status
  FROM public.courses WHERE id = p_course_id;
  IF NOT FOUND OR v_status <> 'approved' THEN RAISE EXCEPTION 'course_not_available'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_course_id::text || ':' || v_today::text));
  UPDATE public.content_views
  SET view_count = content_views.view_count + 1,
      last_viewed_at = now(), updated_at = now()
  WHERE user_id = p_user_id AND course_id = p_course_id AND view_date = v_today;

  IF NOT FOUND THEN
    INSERT INTO public.content_views (user_id, course_id, view_date, view_count)
    VALUES (p_user_id, p_course_id, v_today, 1);
    v_is_new := true;
  END IF;

  IF v_is_new AND p_user_id <> v_creator_id THEN
    UPDATE public.courses SET views_count = COALESCE(views_count, 0) + 1 WHERE id = p_course_id;
  END IF;

  RETURN jsonb_build_object('is_new_view', v_is_new AND p_user_id <> v_creator_id);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_content_view(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.increment_course_view(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_content_view(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_course_view(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Limite Classy: 5/50 estudos totais, Premium ilimitado, imposto no banco.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_study_total_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.plan_type;
  v_count integer;
  v_limit integer;
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR auth.uid() <> NEW.user_id) THEN
    RAISE EXCEPTION 'user_identity_mismatch';
  END IF;

  SELECT plan INTO v_plan FROM public.profiles WHERE id = NEW.user_id;
  v_plan := COALESCE(v_plan, 'free'::public.plan_type);
  NEW.plan_at_creation := v_plan;

  IF v_plan = 'premium' THEN RETURN NEW; END IF;
  v_limit := CASE WHEN v_plan = 'pro' THEN 50 ELSE 5 END;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text));
  SELECT count(*) INTO v_count FROM public.studies WHERE user_id = NEW.user_id;
  IF v_count >= v_limit THEN RAISE EXCEPTION 'study_total_limit_reached'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS studies_enforce_total_limit ON public.studies;
CREATE TRIGGER studies_enforce_total_limit
BEFORE INSERT ON public.studies
FOR EACH ROW EXECUTE FUNCTION public.enforce_study_total_limit();

-- ---------------------------------------------------------------------------
-- Commit atomico do reward: tracking + eventos + acumuladores do ciclo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_reward_award(
  p_tracking_user_id uuid,
  p_tracking_action_key text,
  p_tracking_content_id uuid,
  p_tracking_metadata jsonb,
  p_cycle_id uuid,
  p_actor_event jsonb,
  p_creator_event jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tracking_id uuid;
  v_actor public.reward_events%ROWTYPE;
  v_creator public.reward_events%ROWTYPE;
  v_actor_pp numeric;
  v_creator_pp numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_cycle_id IS NULL OR p_actor_event IS NULL THEN RAISE EXCEPTION 'invalid_reward_payload'; END IF;

  INSERT INTO public.reward_action_tracking (user_id, content_id, action_key, metadata)
  VALUES (p_tracking_user_id, p_tracking_content_id, p_tracking_action_key, COALESCE(p_tracking_metadata, '{}'::jsonb))
  ON CONFLICT (user_id, action_key) DO NOTHING
  RETURNING id INTO v_tracking_id;

  IF v_tracking_id IS NULL THEN
    RETURN jsonb_build_object('already_tracked', true, 'rewards', '[]'::jsonb);
  END IF;

  v_actor_pp := COALESCE((p_actor_event->>'performance_points')::numeric, 0);
  IF v_actor_pp < 0 THEN RAISE EXCEPTION 'negative_reward_points'; END IF;

  INSERT INTO public.reward_events (
    user_id, related_user_id, content_id, action_key, points, value,
    performance_points, cycle_id, metadata
  ) VALUES (
    (p_actor_event->>'user_id')::uuid,
    NULLIF(p_actor_event->>'related_user_id', '')::uuid,
    NULLIF(p_actor_event->>'content_id', '')::uuid,
    p_actor_event->>'action_key',
    COALESCE((p_actor_event->>'points')::numeric, 0), 0,
    v_actor_pp, p_cycle_id, COALESCE(p_actor_event->'metadata', '{}'::jsonb)
  ) RETURNING * INTO v_actor;

  INSERT INTO public.economic_cycle_users (cycle_id, user_id, performance_points)
  VALUES (p_cycle_id, v_actor.user_id, v_actor_pp)
  ON CONFLICT (cycle_id, user_id) DO UPDATE
  SET performance_points = economic_cycle_users.performance_points + EXCLUDED.performance_points,
      updated_at = now();

  IF p_creator_event IS NOT NULL THEN
    v_creator_pp := COALESCE((p_creator_event->>'performance_points')::numeric, 0);
    IF v_creator_pp < 0 THEN RAISE EXCEPTION 'negative_reward_points'; END IF;

    INSERT INTO public.reward_events (
      user_id, related_user_id, content_id, action_key, points, value,
      performance_points, cycle_id, metadata
    ) VALUES (
      (p_creator_event->>'user_id')::uuid,
      NULLIF(p_creator_event->>'related_user_id', '')::uuid,
      NULLIF(p_creator_event->>'content_id', '')::uuid,
      p_creator_event->>'action_key',
      COALESCE((p_creator_event->>'points')::numeric, 0), 0,
      v_creator_pp, p_cycle_id, COALESCE(p_creator_event->'metadata', '{}'::jsonb)
    ) RETURNING * INTO v_creator;

    INSERT INTO public.economic_cycle_users (cycle_id, user_id, performance_points)
    VALUES (p_cycle_id, v_creator.user_id, v_creator_pp)
    ON CONFLICT (cycle_id, user_id) DO UPDATE
    SET performance_points = economic_cycle_users.performance_points + EXCLUDED.performance_points,
        updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    'already_tracked', false,
    'rewards', CASE
      WHEN p_creator_event IS NULL THEN jsonb_build_array(to_jsonb(v_actor))
      ELSE jsonb_build_array(to_jsonb(v_actor), to_jsonb(v_creator))
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_reward_award(uuid, text, uuid, jsonb, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_reward_award(uuid, text, uuid, jsonb, uuid, jsonb, jsonb) TO service_role;

-- Revogacao atomica de reward ainda no ciclo aberto.
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
  v_reward public.reward_events%ROWTYPE;
  v_creator public.reward_events%ROWTYPE;
  v_tracking_key text := p_action_key || '_' || p_content_id::text;
  v_cycle_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;

  SELECT * INTO v_reward
  FROM public.reward_events
  WHERE user_id = p_user_id AND content_id = p_content_id AND action_key = p_action_key
    AND COALESCE(metadata->>'as_creator', 'false') <> 'true'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('reversed', false); END IF;
  SELECT status INTO v_cycle_status FROM public.economic_cycles WHERE id = v_reward.cycle_id;
  IF v_cycle_status IS DISTINCT FROM 'open' THEN
    RETURN jsonb_build_object('reversed', false, 'cycle_closed', true);
  END IF;

  SELECT * INTO v_creator
  FROM public.reward_events
  WHERE related_user_id = p_user_id AND content_id = p_content_id AND action_key = p_action_key
    AND metadata->>'as_creator' = 'true'
    AND metadata->>'tracking_key' = v_tracking_key
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  DELETE FROM public.reward_events WHERE id = v_reward.id;
  UPDATE public.economic_cycle_users
  SET performance_points = GREATEST(0, performance_points - COALESCE(v_reward.performance_points, 0)), updated_at = now()
  WHERE cycle_id = v_reward.cycle_id AND user_id = v_reward.user_id;

  IF v_creator.id IS NOT NULL THEN
    DELETE FROM public.reward_events WHERE id = v_creator.id;
    UPDATE public.economic_cycle_users
    SET performance_points = GREATEST(0, performance_points - COALESCE(v_creator.performance_points, 0)), updated_at = now()
    WHERE cycle_id = v_creator.cycle_id AND user_id = v_creator.user_id;
  END IF;

  DELETE FROM public.reward_action_tracking
  WHERE user_id = p_user_id AND action_key = v_tracking_key;

  RETURN jsonb_build_object(
    'reversed', true,
    'performance_points_reverted', COALESCE(v_reward.performance_points, 0),
    'creator_pp_reverted', COALESCE(v_creator.performance_points, 0),
    'points', COALESCE(v_reward.points, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_reward_award(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_reward_award(uuid, uuid, text) TO service_role;

-- Carry-over idempotente: um retry do fechamento nao pode somar os mesmos PP
-- novamente no ciclo seguinte.
CREATE OR REPLACE FUNCTION public.carryover_cycle_points(
  p_from_cycle_id uuid,
  p_to_cycle_id uuid,
  p_min_payout numeric
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_record record;
  v_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;

  FOR v_user_record IN
    SELECT user_id, performance_points
    FROM public.economic_cycle_users
    WHERE cycle_id = p_from_cycle_id
      AND performance_points > 0
      AND payout_status IS DISTINCT FROM 'carried_over'
      AND (calculated_share IS NULL OR calculated_share < p_min_payout)
    FOR UPDATE
  LOOP
    INSERT INTO public.economic_cycle_users (cycle_id, user_id, performance_points)
    VALUES (p_to_cycle_id, v_user_record.user_id, v_user_record.performance_points)
    ON CONFLICT (cycle_id, user_id) DO UPDATE
    SET performance_points = economic_cycle_users.performance_points + EXCLUDED.performance_points,
        updated_at = now();

    UPDATE public.economic_cycle_users
    SET payout_status = 'carried_over', updated_at = now()
    WHERE cycle_id = p_from_cycle_id AND user_id = v_user_record.user_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- RPCs economicas antigas nunca podem ser invocadas pelo cliente.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'get_or_create_current_cycle', 'increment_cycle_user_points',
      'increment_wallet_balance', 'increment_wallet', 'distribute_cycle_payout',
      'carryover_cycle_points', 'batch_evaluate_qualifications',
      'batch_mature_pending', 'run_reconciliation'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
  END LOOP;
END;
$$;
