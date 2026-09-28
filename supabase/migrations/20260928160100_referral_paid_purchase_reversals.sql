BEGIN;
ALTER TABLE public.referral_commissions ADD COLUMN reversed_amount numeric(12,2) NOT NULL DEFAULT 0
  CHECK(reversed_amount >= 0 AND reversed_amount <= commission_amount);
ALTER TABLE public.referral_commissions ADD COLUMN refunded_purchase_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.referral_commissions ADD COLUMN disputed_purchase_amount numeric(12,2) NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.process_referral_commission_v1(
  p_conversion_id uuid, p_purchase_amount numeric, p_purchase_type text, p_stripe_charge_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conversion public.referral_conversions%ROWTYPE; v_settings jsonb;
  v_rate numeric; v_amount numeric; v_commission public.referral_commissions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_purchase_amount <= 0 OR p_purchase_amount > 100000
     OR NULLIF(btrim(p_purchase_type), '') IS NULL THEN RAISE EXCEPTION 'invalid_purchase'; END IF;
  SELECT * INTO v_conversion FROM public.referral_conversions WHERE id = p_conversion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversion_not_found'; END IF;
  IF v_conversion.commission_paid OR v_conversion.first_purchase_at IS NOT NULL THEN
    SELECT * INTO v_commission FROM public.referral_commissions WHERE conversion_id = p_conversion_id;
    RETURN jsonb_build_object('success', true, 'idempotent', true,
      'commission_id', v_commission.id, 'commission_amount', v_commission.commission_amount);
  END IF;
  SELECT value INTO v_settings FROM public.platform_settings WHERE key = 'economic_v1';
  v_rate := LEAST(0.5, GREATEST(0, COALESCE((v_settings->>'referral_commission_percent')::numeric, 10) / 100));
  v_amount := round(p_purchase_amount * v_rate, 2);
  IF v_amount <= 0 THEN
    UPDATE public.referral_conversions SET first_purchase_at=now() WHERE id=v_conversion.id;
    RETURN jsonb_build_object('success',true,'commission_amount',0,'disabled',true);
  END IF;
  INSERT INTO public.referral_commissions(referrer_id, referred_user_id, conversion_id,
    purchase_type, purchase_amount, commission_rate, commission_amount, status,
    stripe_charge_id, paid_at)
  VALUES (v_conversion.referrer_id, v_conversion.referred_user_id, v_conversion.id,
    p_purchase_type, p_purchase_amount, v_rate, v_amount, 'paid', p_stripe_charge_id, now())
  RETURNING * INTO v_commission;
  UPDATE public.referral_conversions SET first_purchase_at = now(), commission_paid = true
  WHERE id = v_conversion.id;
  UPDATE public.referral_links SET total_purchases=COALESCE(total_purchases,0)+1 WHERE user_id=v_conversion.referrer_id;
  PERFORM public.increment_wallet(v_conversion.referrer_id, v_amount, 'commission',
    'Comissao de indicacao - conversao ' || left(v_conversion.id::text, 8),
    'commission_' || v_commission.id::text, NULL, v_commission.id, p_stripe_charge_id);
  INSERT INTO public.notifications(user_id, type, title, message)
  VALUES (v_conversion.referrer_id, 'reward', 'Comissao recebida',
    'Voce recebeu R$ ' || v_amount::text || ' por uma indicacao.');
  RETURN jsonb_build_object('success', true, 'commission_id', v_commission.id,
    'commission_amount', v_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.process_referral_commission_v1(uuid, numeric, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_commission_v1(uuid, numeric, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reverse_referral_commission_v1(
 p_payment_intent_id text,p_reversal_type text,p_gross_amount numeric,p_event_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.referral_commissions%ROWTYPE; v_total numeric; v_delta numeric;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF p_reversal_type NOT IN ('refund','chargeback') OR p_gross_amount<=0 OR p_event_id IS NULL THEN RAISE EXCEPTION 'invalid_reversal'; END IF;
 SELECT * INTO v_row FROM public.referral_commissions WHERE stripe_charge_id=p_payment_intent_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'commission_not_found',true); END IF;
 -- Values are cumulative per payment, never added again for another delivery of the same event.
 IF p_reversal_type='refund' THEN
  v_row.refunded_purchase_amount := GREATEST(v_row.refunded_purchase_amount,p_gross_amount);
 ELSE
  v_row.disputed_purchase_amount := GREATEST(v_row.disputed_purchase_amount,p_gross_amount);
 END IF;
 v_total := LEAST(v_row.commission_amount,round(v_row.commission_amount *
   LEAST(v_row.purchase_amount,v_row.refunded_purchase_amount+v_row.disputed_purchase_amount)/v_row.purchase_amount,2));
 v_delta := GREATEST(0,v_total-v_row.reversed_amount);
 UPDATE public.referral_commissions SET reversed_amount=v_total,
   refunded_purchase_amount=v_row.refunded_purchase_amount,disputed_purchase_amount=v_row.disputed_purchase_amount
 WHERE id=v_row.id;
 IF v_delta>0 THEN
   PERFORM public.increment_wallet(v_row.referrer_id,-v_delta,'commission_reversal','Estorno de comissão de indicação',
     'referral_reversal_'||v_row.id::text||'_'||v_total::text,NULL,v_row.id,p_event_id);
 END IF;
 RETURN jsonb_build_object('success',true,'reversed_amount',v_delta,'total_reversed',v_total);
END; $$;
REVOKE ALL ON FUNCTION public.reverse_referral_commission_v1(text,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_referral_commission_v1(text,text,numeric,text) TO service_role;
CREATE OR REPLACE FUNCTION public.calculate_eligible_revenue_v1(p_year_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_gross numeric; v_net numeric; v_affiliate numeric;
BEGIN
  IF p_year_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'invalid_year_month'; END IF;
  SELECT COALESCE(sum(gross_amount), 0), COALESCE(sum(net_eligible_amount), 0)
  INTO v_gross, v_net FROM public.revenue_entries
  WHERE year_month = p_year_month AND status = 'confirmed' AND is_pool_eligible = true;
  SELECT COALESCE(sum(commission_amount - reversed_amount), 0) INTO v_affiliate
  FROM public.referral_commissions
  WHERE status = 'paid'
    AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = p_year_month;
  v_net := GREATEST(0, v_net - v_affiliate);
  RETURN jsonb_build_object('gross_revenue', v_gross, 'affiliate_deductions', v_affiliate,
    'eligible_net_revenue', round(v_net, 2));
END;
$$;
REVOKE ALL ON FUNCTION public.calculate_eligible_revenue_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_eligible_revenue_v1(text) TO service_role;

COMMIT;
