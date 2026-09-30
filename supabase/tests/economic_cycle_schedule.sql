-- Executar depois da migration de agendamento em um banco de teste.
BEGIN;

DO $$
BEGIN
  IF classfy_internal.cycle_month_due_for_close('2026-10-01 02:59:00+00') IS NOT NULL THEN
    RAISE EXCEPTION 'closed_before_midnight_in_brasilia';
  END IF;
  IF classfy_internal.cycle_month_due_for_close('2026-10-01 03:00:00+00') IS NOT NULL THEN
    RAISE EXCEPTION 'closed_before_00_01';
  END IF;
  IF classfy_internal.cycle_month_due_for_close('2026-10-01 03:01:00+00') <> '2026-09' THEN
    RAISE EXCEPTION 'wrong_month_at_00_01';
  END IF;
  IF classfy_internal.cycle_month_due_for_close('2027-01-01 03:01:00+00') <> '2026-12' THEN
    RAISE EXCEPTION 'wrong_month_at_year_boundary';
  END IF;
  IF classfy_internal.cycle_month_due_for_close('2026-10-01 04:01:00+00') IS NOT NULL THEN
    RAISE EXCEPTION 'closed_outside_first_hour';
  END IF;
  IF has_function_privilege('authenticated', 'classfy_internal.close_previous_economic_cycle_scheduled()', 'EXECUTE')
    OR has_schema_privilege('authenticated', 'classfy_internal', 'USAGE') THEN
    RAISE EXCEPTION 'scheduled_close_exposed_to_authenticated';
  END IF;
END;
$$;

ROLLBACK;
