-- Add the simulated direct interaction while preserving existing journeys and the single welcome award.
CREATE OR REPLACE FUNCTION public.save_onboarding_v1(p_step integer,p_answers jsonb DEFAULT '{}',p_action text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=auth.uid(); v_state public.user_onboarding%ROWTYPE; v_cycle uuid; v_award jsonb; v_name text; v_interests jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 IF p_step IS NULL OR p_answers IS NULL OR p_step NOT BETWEEN 0 AND 5 OR jsonb_typeof(p_answers)<>'object' OR octet_length(p_answers::text)>4096 THEN RAISE EXCEPTION 'invalid_input'; END IF;
 INSERT INTO public.user_onboarding(user_id) VALUES(v_uid) ON CONFLICT DO NOTHING;
 SELECT * INTO v_state FROM public.user_onboarding WHERE user_id=v_uid FOR UPDATE;
 IF v_state.completed_at IS NOT NULL THEN RETURN to_jsonb(v_state); END IF;
 IF p_step>v_state.step+1 THEN RAISE EXCEPTION 'step_out_of_order'; END IF;
 IF p_answers ? 'journey' AND p_answers->>'journey' NOT IN ('user','creator') THEN RAISE EXCEPTION 'invalid_journey'; END IF;
 v_name:=btrim(p_answers->>'name');
 IF p_answers ? 'name' AND (length(v_name)<2 OR length(v_name)>80) THEN RAISE EXCEPTION 'invalid_name'; END IF;
 v_interests:=p_answers->'interests';
 IF v_interests IS NOT NULL AND (jsonb_typeof(v_interests)<>'array' OR jsonb_array_length(v_interests)>5) THEN RAISE EXCEPTION 'invalid_interests'; END IF;
 IF v_interests IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_interests) e WHERE jsonb_typeof(e)<>'string' OR length(e#>>'{}')>80) THEN RAISE EXCEPTION 'invalid_interests'; END IF;
 IF p_action IS NOT NULL THEN
  IF v_state.step<2 OR p_action NOT IN ('view','like','save','share','study') THEN RAISE EXCEPTION 'invalid_demo_action'; END IF;
  IF NOT p_action=ANY(v_state.demo_actions) THEN
   IF p_action='share' THEN
    IF NOT 'save'=ANY(v_state.demo_actions) THEN RAISE EXCEPTION 'action_out_of_order'; END IF;
   ELSIF p_action IS DISTINCT FROM (ARRAY['view','like','save','study'])[cardinality(array_remove(v_state.demo_actions,'share'))+1] THEN RAISE EXCEPTION 'action_out_of_order'; END IF;
   v_state.demo_actions:=array_append(v_state.demo_actions,p_action);
  END IF;
 END IF;
 IF p_step>=3 AND NOT v_state.demo_actions @> ARRAY['view','like','save','study'] THEN RAISE EXCEPTION 'demo_incomplete'; END IF;
 IF p_step=5 THEN
  IF length(COALESCE((v_state.answers||p_answers)->>'name',''))<2 OR jsonb_array_length(COALESCE((v_state.answers||p_answers)->'interests','[]'))=0 THEN RAISE EXCEPTION 'profile_incomplete'; END IF;
  PERFORM set_config('classfy.authorized_reward_operation','on',true);
  v_cycle:=public.get_or_create_current_cycle();
  v_award:=public.commit_reward_award(v_uid,'ONBOARDING_BONUS_V1',NULL,jsonb_build_object('source','onboarding'),v_cycle,
    jsonb_build_object('user_id',v_uid,'action_key','ONBOARDING_BONUS','points',20,'cycle_points',20,'point_type','user','metadata',jsonb_build_object('source','onboarding','one_time',true)),NULL);
  SELECT id INTO v_state.bonus_event_id FROM public.reward_events WHERE user_id=v_uid AND action_key='ONBOARDING_BONUS' ORDER BY created_at LIMIT 1;
  v_state.completed_at:=now();
 END IF;
 UPDATE public.user_onboarding SET journey=COALESCE(p_answers->>'journey',journey),step=greatest(step,p_step),answers=answers||p_answers,
 demo_actions=v_state.demo_actions,completed_at=v_state.completed_at,bonus_event_id=v_state.bonus_event_id,updated_at=now() WHERE user_id=v_uid RETURNING * INTO v_state;
 IF v_name IS NOT NULL THEN UPDATE public.profiles SET display_name=v_name WHERE id=v_uid; END IF;
 IF v_interests IS NOT NULL THEN UPDATE public.profiles SET interests=v_interests WHERE id=v_uid; END IF;
 IF p_answers ? 'bio' THEN UPDATE public.profiles SET bio=left(p_answers->>'bio',280) WHERE id=v_uid; END IF;
 RETURN to_jsonb(v_state);
END; $$;
