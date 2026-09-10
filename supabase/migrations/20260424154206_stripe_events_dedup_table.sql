
-- Tabela de dedupe para webhooks Stripe
CREATE TABLE IF NOT EXISTS public.stripe_events_processed (
  event_id     text        PRIMARY KEY,
  event_type   text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.stripe_events_processed ENABLE ROW LEVEL SECURITY;

-- Só service_role pode escrever/ler
CREATE POLICY "Service role only" ON public.stripe_events_processed
  FOR ALL USING (false) WITH CHECK (false);
;
