-- Checkout web: service_role owns the ledger; no browser may read or write it.
CREATE TABLE public.web_subscription_checkout_locks (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE public.web_subscription_checkout_operations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('checkout', 'upgrade')),
  plan text NOT NULL CHECK (plan IN ('pro', 'premium')),
  state text NOT NULL CHECK (state IN ('quoted','creating','prepared','confirming','pending','completed','canceled','failed')),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, request_id)
);
CREATE INDEX web_subscription_checkout_owner_recent ON public.web_subscription_checkout_operations(user_id, updated_at DESC);
ALTER TABLE public.web_subscription_checkout_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_subscription_checkout_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_subscription_checkout_locks, public.web_subscription_checkout_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.web_subscription_checkout_locks, public.web_subscription_checkout_operations TO service_role;

CREATE FUNCTION public.claim_web_subscription_checkout_v1(p_user_id uuid, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_token uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  INSERT INTO public.web_subscription_checkout_locks(user_id,token,expires_at)
    VALUES(p_user_id,p_token,clock_timestamp()+interval '90 seconds')
  ON CONFLICT(user_id) DO UPDATE SET token=EXCLUDED.token, expires_at=EXCLUDED.expires_at
    WHERE web_subscription_checkout_locks.expires_at <= clock_timestamp()
       OR web_subscription_checkout_locks.token=p_token
  RETURNING token INTO v_token;
  RETURN COALESCE(v_token=p_token, false);
END;
$$;
CREATE FUNCTION public.release_web_subscription_checkout_v1(p_user_id uuid, p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  DELETE FROM public.web_subscription_checkout_locks WHERE user_id=p_user_id AND token=p_token;
END;
$$;
CREATE FUNCTION public.complete_web_subscription_checkout_v1(p_user_id uuid, p_token uuid, p_record jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  -- Fence late HTTP replies from an expired/replaced owner lease.
  PERFORM 1 FROM public.web_subscription_checkout_locks
    WHERE user_id=p_user_id AND token=p_token AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_lease_expired'; END IF;
  IF p_record->>'ownerId' IS DISTINCT FROM p_user_id::text THEN RAISE EXCEPTION 'checkout_owner_mismatch'; END IF;
  INSERT INTO public.web_subscription_checkout_operations(id,user_id,request_id,kind,plan,state,record)
    VALUES((p_record->>'id')::uuid,p_user_id,(p_record->>'requestId')::uuid,p_record->>'kind',p_record->>'plan',p_record->>'state',p_record)
  ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,record=EXCLUDED.record,updated_at=now()
    WHERE web_subscription_checkout_operations.user_id=p_user_id
      AND web_subscription_checkout_operations.request_id=EXCLUDED.request_id
      AND web_subscription_checkout_operations.kind=EXCLUDED.kind
      AND web_subscription_checkout_operations.plan=EXCLUDED.plan;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_operation_mismatch'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_web_subscription_checkout_v1(uuid,uuid), public.release_web_subscription_checkout_v1(uuid,uuid), public.complete_web_subscription_checkout_v1(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_web_subscription_checkout_v1(uuid,uuid), public.release_web_subscription_checkout_v1(uuid,uuid), public.complete_web_subscription_checkout_v1(uuid,uuid,jsonb) TO service_role;
