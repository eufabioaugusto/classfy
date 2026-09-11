-- Teste transacional da Economia Classfy V1. Executar no banco local com:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/economy_v1_integration.sql
BEGIN;

DO $$
DECLARE
  v_admin constant uuid := '10000000-0000-0000-0000-000000000001';
  v_user constant uuid := '10000000-0000-0000-0000-000000000002';
  v_creator constant uuid := '10000000-0000-0000-0000-000000000003';
  v_buyer constant uuid := '10000000-0000-0000-0000-000000000004';
  v_applicant constant uuid := '10000000-0000-0000-0000-000000000005';
  v_content constant uuid := '20000000-0000-0000-0000-000000000001';
  v_pending_content constant uuid := '20000000-0000-0000-0000-000000000002';
  v_request uuid; v_cycle uuid; v_plan_cycle uuid; v_current_cycle uuid; v_withdraw uuid; v_result jsonb;
  v_count integer; v_amount numeric; v_balance numeric; v_pending numeric;
BEGIN
  INSERT INTO auth.users(id, email, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_admin, 'economy-admin@test.local', '{"display_name":"Admin Teste"}', now(), now()),
    (v_user, 'economy-user@test.local', '{"display_name":"Usuario Teste"}', now(), now()),
    (v_creator, 'economy-creator@test.local', '{"display_name":"Creator Teste"}', now(), now()),
    (v_buyer, 'economy-buyer@test.local', '{"display_name":"Comprador Teste"}', now(), now()),
    (v_applicant, 'economy-applicant@test.local', '{"display_name":"Candidato Teste"}', now(), now());
  INSERT INTO public.user_roles(user_id, role) VALUES (v_admin, 'admin')
  ON CONFLICT DO NOTHING;

  -- Campos financeiros do perfil nao podem ser manipulados pelo cliente.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    UPDATE public.profiles SET plan = 'premium' WHERE id = v_user;
    RAISE EXCEPTION 'profile_financial_tamper_was_not_blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'profile_financial_tamper_was_not_blocked' THEN RAISE; END IF;
  END;

  -- Alteracao administrativa e revisao de Creator sao atomicas e auditadas.
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_update_user_access_v1(v_user, 'user', 'premium', now() + interval '1 year', 'teste integrado');
  IF (SELECT plan FROM public.profiles WHERE id = v_user) <> 'premium'
     OR (SELECT entitlement_source FROM public.profiles WHERE id = v_user) <> 'admin' THEN
    RAISE EXCEPTION 'admin_entitlement_failed';
  END IF;
  INSERT INTO public.creator_requests(user_id, channel_name, bio)
  VALUES (v_applicant, 'Canal Teste', 'Bio') RETURNING id INTO v_request;
  PERFORM public.review_creator_request_v1(v_request, true, 'creator validado no teste');
  IF NOT public.has_role(v_applicant, 'creator')
     OR (SELECT creator_status FROM public.profiles WHERE id = v_applicant) <> 'approved' THEN
    RAISE EXCEPTION 'creator_approval_failed';
  END IF;
  IF (SELECT count(*) FROM public.reward_events WHERE user_id = v_applicant
      AND action_key = 'CREATOR_APPROVED' AND point_type = 'creator' AND points = 20) <> 1 THEN
    RAISE EXCEPTION 'creator_approval_points_failed';
  END IF;

  -- Webhook fora de ordem nao regride uma assinatura mais nova.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.sync_subscription_state_v1(v_buyer, 'active', 'pro', now() + interval '1 month',
    'sub_test', 'cus_test', NULL, NULL, now());
  v_result := public.sync_subscription_state_v1(v_buyer, 'free', NULL, NULL,
    NULL, 'cus_test', NULL, NULL, now() - interval '1 day');
  IF NOT COALESCE((v_result->>'ignored_stale_event')::boolean, false)
     OR (SELECT plan FROM public.profiles WHERE id = v_buyer) <> 'pro' THEN
    RAISE EXCEPTION 'stale_subscription_event_was_not_ignored';
  END IF;

  -- Alterar somente o papel nao substitui nem rebaixa o direito vindo da Stripe.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_update_user_access_v1(v_buyer, 'creator', NULL, NULL, 'teste de papel independente do plano');
  IF (SELECT plan FROM public.profiles WHERE id = v_buyer) <> 'pro'
     OR (SELECT entitlement_source FROM public.profiles WHERE id = v_buyer) <> 'stripe' THEN
    RAISE EXCEPTION 'role_change_overwrote_stripe_entitlement';
  END IF;

  -- Upgrade, downgrade agendado, cancelamento e reativacao preservam a ordem.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.sync_subscription_state_v1(v_buyer, 'trialing', 'premium', now() + interval '1 month',
    'sub_test', 'cus_test', NULL, NULL, now() + interval '1 second');
  IF (SELECT plan FROM public.profiles WHERE id = v_buyer) <> 'premium' THEN
    RAISE EXCEPTION 'subscription_upgrade_failed';
  END IF;
  PERFORM public.sync_subscription_state_v1(v_buyer, 'active', 'premium', now() + interval '1 month',
    'sub_test', 'cus_test', 'pro', now() + interval '1 month', now() + interval '2 seconds');
  IF (SELECT plan FROM public.profiles WHERE id = v_buyer) <> 'premium'
     OR (SELECT pending_plan FROM public.profiles WHERE id = v_buyer) <> 'pro' THEN
    RAISE EXCEPTION 'scheduled_downgrade_failed';
  END IF;
  PERFORM public.sync_subscription_state_v1(v_buyer, 'canceled', 'premium', now() + interval '1 month',
    'sub_test', 'cus_test', NULL, NULL, now() + interval '3 seconds');
  IF (SELECT plan FROM public.profiles WHERE id = v_buyer) <> 'premium' THEN
    RAISE EXCEPTION 'canceled_subscription_lost_paid_period';
  END IF;
  PERFORM public.sync_subscription_state_v1(v_buyer, 'unpaid', NULL, NULL,
    'sub_test', 'cus_test', NULL, NULL, now() + interval '4 seconds');
  IF (SELECT plan FROM public.profiles WHERE id = v_buyer) <> 'free' THEN
    RAISE EXCEPTION 'unpaid_subscription_kept_entitlement';
  END IF;
  PERFORM public.sync_subscription_state_v1(v_buyer, 'active', 'pro', now() + interval '1 month',
    'sub_test', 'cus_test', NULL, NULL, now() + interval '5 seconds');
  IF (SELECT plan FROM public.profiles WHERE id = v_buyer) <> 'pro' THEN
    RAISE EXCEPTION 'subscription_reactivation_failed';
  END IF;

  -- Streak e idempotencia do login sao calculadas no servidor.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.record_login_streak_v1(v_user);
  PERFORM public.record_login_streak_v1(v_user);
  IF (v_result->>'current_streak')::int <> 1
     OR (SELECT current_streak FROM public.user_login_streaks WHERE user_id = v_user) <> 1
     OR has_table_privilege('authenticated', 'public.user_login_streaks', 'UPDATE') THEN
    RAISE EXCEPTION 'server_login_streak_failed';
  END IF;

  -- Fechamento: R$100 liquidos -> pool de R$40, rateado sem perder centavos.
  INSERT INTO public.economic_cycles(year_month, pool_percentage, economy_version)
  VALUES ('2026-08', 40, 1) RETURNING id INTO v_cycle;
  INSERT INTO public.economic_cycle_users(cycle_id, user_id, performance_points, user_points,
    creator_points, cycle_points, qualified_for_pool)
  VALUES (v_cycle, v_user, 1, 1, 0, 1, true),
    (v_cycle, v_creator, 2, 0, 2, 2, true);
  INSERT INTO public.revenue_entries(year_month, revenue_type, amount, source_id, status,
    is_pool_eligible, gross_amount, classfy_amount, net_eligible_amount, confirmed_at)
  VALUES ('2026-08', 'subscription_pro', 100, 'invoice_cycle_test', 'confirmed', true,
    100, 100, 100, now());
  v_result := public.close_economic_cycle_v1('2026-08');
  SELECT sum(amount) INTO v_amount FROM public.wallet_pending WHERE cycle_id = v_cycle;
  IF v_amount <> 40 OR (v_result->>'distributed_amount')::numeric <> 40 THEN
    RAISE EXCEPTION 'cycle_distribution_failed: %', v_result;
  END IF;
  v_result := public.close_economic_cycle_v1('2026-08');
  IF NOT COALESCE((v_result->>'idempotent')::boolean, false) THEN
    RAISE EXCEPTION 'cycle_close_not_idempotent';
  END IF;

  -- Plano no fechamento congela maturacao em 30/7/2 dias. Receita inelegivel fica fora.
  INSERT INTO public.economic_cycles(year_month, pool_percentage, economy_version)
  VALUES ('2026-07', 40, 1) RETURNING id INTO v_plan_cycle;
  INSERT INTO public.economic_cycle_users(cycle_id, user_id, performance_points, user_points,
    creator_points, cycle_points, qualified_for_pool)
  VALUES (v_plan_cycle, v_creator, 1, 0, 1, 1, true),
    (v_plan_cycle, v_buyer, 1, 1, 0, 1, true),
    (v_plan_cycle, v_user, 1, 1, 0, 1, true);
  INSERT INTO public.revenue_entries(year_month, revenue_type, amount, source_id, status,
    is_pool_eligible, gross_amount, classfy_amount, net_eligible_amount, confirmed_at)
  VALUES ('2026-07', 'subscription_pro', 100, 'invoice_plan_cycle', 'confirmed', true,
      100, 100, 100, now()),
    ('2026-07', 'other', 0, 'ineligible_plan_cycle', 'confirmed', false,
      1000, 1000, 0, now());
  v_result := public.close_economic_cycle_v1('2026-07');
  IF (v_result->>'eligible_net_revenue')::numeric <> 100
     OR (v_result->>'distributed_amount')::numeric <> 40
     OR (SELECT sum(calculated_share) FROM public.economic_cycle_users
         WHERE cycle_id = v_plan_cycle) <> 40
     OR (SELECT maturation_days FROM public.economic_cycle_users
         WHERE cycle_id = v_plan_cycle AND user_id = v_creator) <> 30
     OR (SELECT maturation_days FROM public.economic_cycle_users
         WHERE cycle_id = v_plan_cycle AND user_id = v_buyer) <> 7
     OR (SELECT maturation_days FROM public.economic_cycle_users
         WHERE cycle_id = v_plan_cycle AND user_id = v_user) <> 2 THEN
    RAISE EXCEPTION 'plan_maturation_or_eligible_revenue_failed: %', v_result;
  END IF;

  -- Maturacao gera lancamento posted e saldo explicavel pelo ledger.
  UPDATE public.wallet_pending SET mature_at = now() - interval '1 second' WHERE cycle_id = v_cycle;
  v_result := public.batch_mature_pending();
  IF (v_result->>'matured_count')::int <> 2 THEN
    RAISE EXCEPTION 'unexpected_maturation_count: %', v_result;
  END IF;
  v_count := (SELECT count(*) FROM public.wallet_transactions WHERE cycle_id = v_cycle AND status = 'posted');
  v_result := public.batch_mature_pending();
  IF (v_result->>'matured_count')::int <> 0
     OR (SELECT count(*) FROM public.wallet_transactions WHERE cycle_id = v_cycle AND status = 'posted') <> v_count THEN
    RAISE EXCEPTION 'maturation_not_idempotent: %', v_result;
  END IF;
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_user;
  IF v_balance <> 13.33 THEN RAISE EXCEPTION 'unexpected_matured_balance: %', v_balance; END IF;

  -- Reserva e pagamento de saque respeitam o minimo e deixam trilha contabil.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    PERFORM public.request_withdrawal(9, 'pix-teste');
    RAISE EXCEPTION 'minimum_withdrawal_was_not_enforced';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'minimum_withdrawal_was_not_enforced' THEN RAISE; END IF;
  END;
  v_result := public.request_withdrawal(10, 'pix-teste');
  v_withdraw := (v_result->>'request_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.mark_withdrawal_paid(v_withdraw, 'pago em teste', 'comprovante validado');
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_user;
  IF v_balance <> 3.33 THEN RAISE EXCEPTION 'withdrawal_balance_failed: %', v_balance; END IF;
  BEGIN
    PERFORM public.mark_withdrawal_paid(v_withdraw, 'repetido', 'nao pode pagar duas vezes');
    RAISE EXCEPTION 'withdrawal_paid_twice';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'withdrawal_paid_twice' THEN RAISE; END IF;
  END;

  -- Venda 20/80, hold e dois reembolsos cumulativos de 25% e 50%.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.profiles SET creator_status = 'approved' WHERE id = v_creator;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_creator, 'creator') ON CONFLICT DO NOTHING;
  INSERT INTO public.contents(id, creator_id, title, content_type, status, visibility, price)
  VALUES (v_content, v_creator, 'Conteudo Pago', 'aula', 'approved', 'paid', 100);

  -- Uma interacao de terceiro grava User Points e Creator Points no mesmo commit.
  SELECT public.get_or_create_current_cycle() INTO v_current_cycle;
  v_result := public.commit_reward_award(v_user, 'LIKE_' || v_content::text, v_content,
    '{"evidence":"integration-test"}'::jsonb, v_current_cycle,
    jsonb_build_object('user_id',v_user,'related_user_id',v_creator,'content_id',v_content,
      'action_key','LIKE','points',4,'cycle_points',4,'point_type','user'),
    jsonb_build_object('user_id',v_creator,'related_user_id',v_user,'content_id',v_content,
      'action_key','LIKE','points',1,'cycle_points',1,'point_type','creator'));
  PERFORM public.commit_reward_award(v_user, 'LIKE_' || v_content::text, v_content,
    '{"evidence":"integration-test"}'::jsonb, v_current_cycle,
    jsonb_build_object('user_id',v_user,'related_user_id',v_creator,'content_id',v_content,
      'action_key','LIKE','points',4,'cycle_points',4,'point_type','user'),
    jsonb_build_object('user_id',v_creator,'related_user_id',v_user,'content_id',v_content,
      'action_key','LIKE','points',1,'cycle_points',1,'point_type','creator'));
  IF (SELECT count(*) FROM public.reward_events WHERE content_id=v_content AND action_key='LIKE') <> 2
     OR (SELECT count(*) FROM public.reward_events WHERE content_id=v_content AND action_key='LIKE'
         AND user_id=v_user AND point_type='user' AND points=4) <> 1
     OR (SELECT count(*) FROM public.reward_events WHERE content_id=v_content AND action_key='LIKE'
         AND user_id=v_creator AND point_type='creator' AND points=1) <> 1
     OR (SELECT user_points FROM public.economic_cycle_users
         WHERE cycle_id=v_current_cycle AND user_id=v_user) <> 4
     OR (SELECT creator_points FROM public.economic_cycle_users
         WHERE cycle_id=v_current_cycle AND user_id=v_creator) < 1
     OR NOT COALESCE((public.commit_reward_award(v_user, 'LIKE_' || v_content::text, v_content,
       '{}'::jsonb, v_current_cycle,
       jsonb_build_object('user_id',v_user,'action_key','LIKE','points',4,'point_type','user'),
       NULL)->>'already_tracked')::boolean,false) THEN
    RAISE EXCEPTION 'point_origin_or_reward_idempotency_failed';
  END IF;

  PERFORM public.record_content_sale_v1(v_buyer, v_content, 100, 0, 'pi_sale_test',
    'cs_sale_test', 0, 0);
  SELECT amount-reversed_amount INTO v_pending FROM public.wallet_pending
  WHERE idempotency_key = 'creator_sale_pi_sale_test';
  IF v_pending <> 80 THEN RAISE EXCEPTION 'sale_split_or_hold_failed: %', v_pending; END IF;
  PERFORM public.reverse_content_sale_v1('pi_sale_test', 'refund', 25, 'evt_refund_25');
  PERFORM public.reverse_content_sale_v1('pi_sale_test', 'refund', 50, 'evt_refund_50');
  SELECT amount-reversed_amount INTO v_pending FROM public.wallet_pending
  WHERE idempotency_key = 'creator_sale_pi_sale_test';
  IF v_pending <> 40 THEN RAISE EXCEPTION 'cumulative_sale_refund_failed: %', v_pending; END IF;

  -- Reembolso total encerra a posse; nova compra cria novo historico e novo hold.
  PERFORM public.reverse_content_sale_v1('pi_sale_test', 'refund', 100, 'evt_refund_100');
  PERFORM public.record_content_sale_v1(v_buyer, v_content, 100, 0, 'pi_sale_test_2',
    'cs_sale_test_2', 0, 0);
  SELECT COALESCE(sum(amount-reversed_amount),0) INTO v_pending FROM public.wallet_pending
  WHERE user_id = v_creator AND source_type = 'creator_sale' AND status = 'pending';
  IF v_pending <> 80
     OR (SELECT count(*) FROM public.purchased_contents
         WHERE user_id = v_buyer AND content_id = v_content) <> 2 THEN
    RAISE EXCEPTION 'repurchase_history_failed: %', v_pending;
  END IF;

  -- Nova configuracao vale apenas para nova venda; a transacao anterior fica congelada.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.update_economic_v1_settings(
    '{"sales_commission_percent":15,"minimum_withdrawal_amount":12}'::jsonb,
    'teste de configuracao dinamica');
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.record_content_sale_v1(v_user, v_content, 100, 0, 'pi_sale_test_3',
    'cs_sale_test_3', 0, 0);
  IF (SELECT classfy_percent FROM public.purchased_contents
      WHERE stripe_payment_intent_id = 'pi_sale_test_2') <> 20
     OR (SELECT classfy_percent FROM public.purchased_contents
         WHERE stripe_payment_intent_id = 'pi_sale_test_3') <> 15
     OR (SELECT creator_amount FROM public.purchased_contents
         WHERE stripe_payment_intent_id = 'pi_sale_test_3') <> 85
     OR (SELECT round(extract(epoch FROM (mature_at-created_at))/86400)
         FROM public.wallet_pending WHERE idempotency_key = 'creator_sale_pi_sale_test_3') <> 7 THEN
    RAISE EXCEPTION 'configurable_frozen_sale_split_failed';
  END IF;

  -- Chargeback depois da liberacao debita o saldo e bloqueia novos saques negativos.
  UPDATE public.wallet_pending SET mature_at = now() - interval '1 second'
  WHERE idempotency_key = 'creator_sale_pi_sale_test_3';
  PERFORM public.batch_mature_pending();
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_creator::text, true);
  v_result := public.request_withdrawal(100, 'pix-creator');
  v_withdraw := (v_result->>'request_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.mark_withdrawal_paid(v_withdraw, 'pago antes do chargeback', 'teste de saldo negativo');
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.reverse_content_sale_v1('pi_sale_test_3', 'chargeback', 100, 'evt_chargeback_100');
  PERFORM public.reverse_content_sale_v1('pi_sale_test_3', 'chargeback', 100, 'evt_chargeback_100');
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_creator;
  IF v_balance >= 0
     OR (SELECT count(*) FROM public.wallet_transactions
         WHERE stripe_event_id = 'evt_chargeback_100') <> 1 THEN
    RAISE EXCEPTION 'post_maturity_chargeback_or_idempotency_failed: %', v_balance;
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_creator::text, true);
  BEGIN
    PERFORM public.request_withdrawal(12, 'pix-creator');
    RAISE EXCEPTION 'negative_wallet_withdrawal_was_not_blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'negative_wallet_withdrawal_was_not_blocked' THEN RAISE; END IF;
  END;

  -- Reembolso generico tambem trata charge.refunded como valor acumulado.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.record_revenue_entry_v1('subscription_pro', 100, 'invoice_refund_test', v_buyer,
    '{}'::jsonb, true, 0, 0, 0);
  PERFORM public.reverse_revenue_entry_v1('invoice_refund_test', 'refund', 10, 'evt_generic_10');
  PERFORM public.reverse_revenue_entry_v1('invoice_refund_test', 'refund', 25, 'evt_generic_25');
  SELECT sum(rr.gross_amount) INTO v_amount FROM public.revenue_reversals rr
  JOIN public.revenue_entries re ON re.id = rr.revenue_entry_id
  WHERE re.source_id = 'invoice_refund_test';
  IF v_amount <> 25 THEN RAISE EXCEPTION 'generic_cumulative_refund_failed: %', v_amount; END IF;

  -- Aprovacao repetida nao repete Points.
  INSERT INTO public.contents(id, creator_id, title, content_type, status, visibility)
  VALUES (v_pending_content, v_applicant, 'Conteudo Pendente', 'aula', 'pending', 'free');
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.approve_content_v1(v_pending_content, 'content', 'curadoria teste');
  SELECT count(*) INTO v_count FROM public.reward_events
  WHERE user_id = v_applicant AND content_id = v_pending_content AND action_key = 'CONTENT_APPROVED';
  PERFORM public.approve_content_v1(v_pending_content, 'content', 'repeticao teste');
  IF v_count <> 1 OR (SELECT count(*) FROM public.reward_events
      WHERE user_id = v_applicant AND content_id = v_pending_content AND action_key = 'CONTENT_APPROVED') <> 1 THEN
    RAISE EXCEPTION 'content_approval_reward_duplicated';
  END IF;
  IF (SELECT count(*) FROM public.reward_events WHERE user_id=v_applicant
      AND action_key='FIRST_UPLOAD' AND point_type='creator' AND points=10) <> 1 THEN
    RAISE EXCEPTION 'first_upload_points_failed';
  END IF;
  PERFORM public.reject_content_v1(v_pending_content, 'content', 'reprovado depois do teste de aprovacao');
  IF (SELECT status FROM public.contents WHERE id = v_pending_content) <> 'rejected'
     OR (SELECT count(*) FROM public.reward_events
         WHERE user_id = v_applicant AND content_id = v_pending_content
           AND action_key = 'CONTENT_APPROVED') <> 1 THEN
    RAISE EXCEPTION 'content_rejection_changed_reward_history';
  END IF;

  -- QP, carry-over, milestones economicos e crons legados estao inativos.
  IF EXISTS (SELECT 1 FROM public.creator_milestones
      WHERE points_reward <> 0 OR value_reward <> 0)
     OR has_function_privilege('service_role',
       'public.carryover_cycle_points(uuid,uuid,numeric)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM cron.job
       WHERE jobname = 'classfy-evaluate-qualifications-daily')
     OR NOT EXISTS (SELECT 1 FROM cron.job
       WHERE jobname = 'classfy-reconciliation-daily'
         AND command LIKE '%run_reconciliation_v1%') THEN
    RAISE EXCEPTION 'legacy_economic_engine_still_active';
  END IF;

  IF (SELECT value ? 'approved_content_monthly_limit'
      FROM public.platform_settings WHERE key = 'economic_v1')
     OR NOT EXISTS (SELECT 1 FROM public.reward_actions_config
         WHERE action_key = 'CONTENT_APPROVED') THEN
    RAISE EXCEPTION 'economic_settings_source_is_duplicated';
  END IF;

  IF (SELECT count(*) FROM public.reward_actions_config WHERE active) <> 17
     OR EXISTS (SELECT 1 FROM public.reward_actions_config WHERE active
       AND (value_user <> 0 OR value_creator <> 0)) THEN
    RAISE EXCEPTION 'official_points_table_is_inconsistent';
  END IF;

  IF (SELECT count(*) FROM public.reward_actions_config c
      JOIN (VALUES
        ('DAILY_LOGIN',2::numeric,0::numeric), ('WEEKLY_STREAK',10,0),
        ('FIRST_CONTENT_WEEK',4,0), ('VIEW_15S',2,1), ('WATCH_50',6,3),
        ('WATCH_100',10,5), ('LIKE',2,1), ('SAVE',4,2), ('FAVORITE',4,2),
        ('COMMENT',6,3), ('SHARE',4,2), ('SUBSCRIBE_CREATOR',6,3),
        ('COMPLETE_COURSE',20,10), ('PROFILE_COMPLETE',10,0),
        ('CREATOR_APPROVED',0,20), ('FIRST_UPLOAD',0,10), ('CONTENT_APPROVED',0,4)
      ) AS expected(action_key, points_user, points_creator)
        ON expected.action_key = c.action_key
      WHERE c.active AND c.points_user = expected.points_user
        AND c.points_creator = expected.points_creator) <> 17 THEN
    RAISE EXCEPTION 'official_points_values_do_not_match_v1';
  END IF;

  -- Checkpoints sao somente marcos ascendentes; Classy preserva 5/50/ilimitado.
  v_result := public.get_growth_checkpoint_status_v1();
  IF COALESCE((v_result->>'economic_effect')::boolean, true)
     OR (SELECT array_agg(threshold ORDER BY threshold)
         FROM public.economic_growth_checkpoints) <> ARRAY[100,500,1000,5000,10000] THEN
    RAISE EXCEPTION 'growth_checkpoints_changed_economy: %', v_result;
  END IF;
  IF (public.get_study_limits('free'::public.plan_type)->>'max_studies')::int <> 5
     OR (public.get_study_limits('pro'::public.plan_type)->>'max_studies')::int <> 50
     OR (public.get_study_limits('premium'::public.plan_type)->>'max_studies')::int <> 999999 THEN
    RAISE EXCEPTION 'classy_study_limits_changed';
  END IF;

  -- O estado final precisa ser integralmente reconstruivel por ledger e pendencias.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.run_reconciliation_v1(NULL);
  IF v_result->>'status' <> 'ok'
     OR (v_result->>'wallets_drift')::int <> 0
     OR (v_result->>'cycles_drift')::int <> 0 THEN
    RAISE EXCEPTION 'economic_reconciliation_failed: %', v_result;
  END IF;

  -- Toda operacao administrativa central deixou justificativa.
  IF (SELECT count(*) FROM public.economic_admin_audit WHERE reason IS NOT NULL) < 4 THEN
    RAISE EXCEPTION 'admin_audit_missing';
  END IF;
END;
$$;

ROLLBACK;
