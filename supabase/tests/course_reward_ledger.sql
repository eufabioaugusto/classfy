-- Valida deduplicacao por aula, bonus de curso e saldo. Nao persiste dados.
BEGIN;
SET LOCAL ROLE postgres;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_course uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_cycle uuid;
  v_meta jsonb;
  v_event jsonb;
  v_result jsonb;
  v_key text;
  v_id uuid;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data,created_at,updated_at)
  VALUES(v_user, v_user::text || '@course-reward.test.local', '{"display_name":"QA transacional curso"}',now(),now());
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_cycle := public.get_or_create_current_cycle();
  FOREACH v_id IN ARRAY ARRAY[v_a,v_b] LOOP
    v_key := 'WATCH_100_' || v_id::text;
    v_meta := jsonb_build_object('course_id',v_course,'lesson_id',v_id,'tracking_key',v_key);
    v_event := jsonb_build_object('user_id',v_user,'action_key','WATCH_100','points',10,'cycle_points',10,'point_type','user','metadata',v_meta);
    v_result := public.commit_reward_award(v_user,v_key,NULL,v_meta,v_cycle,v_event,NULL);
    IF jsonb_array_length(v_result->'rewards') <> 1 THEN RAISE EXCEPTION 'lesson_reward_missing'; END IF;
    v_result := public.commit_reward_award(v_user,v_key,NULL,v_meta,v_cycle,v_event,NULL);
    IF NOT (v_result->>'already_tracked')::boolean THEN RAISE EXCEPTION 'duplicate_lesson_reward'; END IF;
  END LOOP;
  v_key := 'COMPLETE_COURSE_' || v_course::text;
  v_meta := jsonb_build_object('course_id',v_course,'tracking_key',v_key);
  v_event := jsonb_build_object('user_id',v_user,'action_key','COMPLETE_COURSE','points',20,'cycle_points',20,'point_type','user','metadata',v_meta);
  PERFORM public.commit_reward_award(v_user,v_key,NULL,v_meta,v_cycle,v_event,NULL);
  v_result := public.commit_reward_award(v_user,v_key,NULL,v_meta,v_cycle,v_event,NULL);
  IF NOT (v_result->>'already_tracked')::boolean THEN RAISE EXCEPTION 'duplicate_course_bonus'; END IF;
  IF (SELECT sum(points) FROM public.reward_events WHERE user_id=v_user) <> 40 THEN RAISE EXCEPTION 'course_total_incorrect'; END IF;
  IF (SELECT user_points FROM public.economic_cycle_users WHERE user_id=v_user AND cycle_id=v_cycle) <> 40 THEN RAISE EXCEPTION 'cycle_points_not_updated'; END IF;
END;
$$;
ROLLBACK;
