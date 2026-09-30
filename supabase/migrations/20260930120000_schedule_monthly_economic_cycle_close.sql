-- A virada dos Points acontece no inicio do mes em America/Sao_Paulo.
-- O fechamento financeiro do mes anterior ocorre a partir de 00:01.
-- O job tenta novamente durante a primeira hora; a RPC de fechamento e idempotente.

CREATE SCHEMA IF NOT EXISTS classfy_internal;
REVOKE ALL ON SCHEMA classfy_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION classfy_internal.cycle_month_due_for_close(p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN EXTRACT(DAY FROM p_at AT TIME ZONE 'America/Sao_Paulo') = 1
      AND EXTRACT(HOUR FROM p_at AT TIME ZONE 'America/Sao_Paulo') = 0
      AND EXTRACT(MINUTE FROM p_at AT TIME ZONE 'America/Sao_Paulo') >= 1
    THEN to_char((p_at AT TIME ZONE 'America/Sao_Paulo') - interval '1 month', 'YYYY-MM')
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION classfy_internal.close_previous_economic_cycle_scheduled()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_year_month text;
BEGIN
  -- O job pg_cron e criado e executado pelo papel postgres. A funcao nao
  -- pode ser acionada por um cliente da API, mesmo dentro do banco.
  IF session_user <> 'postgres' THEN
    RAISE EXCEPTION 'cron_only';
  END IF;

  v_year_month := classfy_internal.cycle_month_due_for_close(now());
  IF v_year_month IS NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  -- A RPC existente exige o claim service_role; ele fica restrito a esta
  -- transacao de banco, sem armazenar ou transmitir uma chave de servico.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN public.close_economic_cycle_v1(v_year_month);
END;
$$;

REVOKE ALL ON FUNCTION classfy_internal.cycle_month_due_for_close(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION classfy_internal.close_previous_economic_cycle_scheduled()
  FROM PUBLIC, anon, authenticated, service_role;

-- O banco da Supabase usa UTC. As horas 02, 03 e 04 UTC cobrem uma possivel
-- mudanca futura do deslocamento de Brasilia; a funcao so age as 00h locais.
SELECT cron.schedule(
  'classfy-close-economic-cycle-monthly',
  '1,6,16,31,46 2,3,4 1 * *',
  $$ SELECT classfy_internal.close_previous_economic_cycle_scheduled() $$
);
