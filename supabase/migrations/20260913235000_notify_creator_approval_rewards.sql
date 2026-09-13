-- A aprovação já creditava os Creator Points, mas a notificação não informava
-- a recompensa. Consolida aprovação e bônus de primeiro conteúdo em um aviso.
CREATE OR REPLACE FUNCTION public.approve_content_v1(
  p_item_id uuid, p_item_type text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_creator uuid; v_title text; v_content_type text; v_old_status text;
  v_creator_status public.creator_status; v_has_role boolean; v_cycle uuid;
  v_cfg public.reward_actions_config%ROWTYPE; v_first_cfg public.reward_actions_config%ROWTYPE;
  v_approved_count integer; v_reward jsonb; v_first_reward jsonb;
  v_tracking_content uuid; v_rewards_enabled boolean := true;
  v_content_points integer := 0; v_first_upload_points integer := 0; v_total_points integer := 0;
  v_notification_message text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_item_type NOT IN ('content','course') THEN RAISE EXCEPTION 'invalid_item_type'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_item_type='content' THEN
    SELECT creator_id,title,content_type,status INTO v_creator,v_title,v_content_type,v_old_status
    FROM public.contents WHERE id=p_item_id FOR UPDATE;
    v_tracking_content:=p_item_id;
  ELSE
    SELECT creator_id,title,NULL::text,status INTO v_creator,v_title,v_content_type,v_old_status
    FROM public.courses WHERE id=p_item_id FOR UPDATE;
    v_tracking_content:=NULL;
  END IF;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;
  SELECT creator_status INTO v_creator_status FROM public.profiles WHERE id=v_creator;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_creator AND role='creator') INTO v_has_role;
  IF v_creator_status<>'approved' OR NOT v_has_role THEN RAISE EXCEPTION 'approved_creator_required'; END IF;

  IF v_old_status='approved' THEN
    RETURN jsonb_build_object('success',true,'idempotent',true,'creator_id',v_creator,
      'title',v_title,'content_type',v_content_type,'points',0,'first_upload_points',0);
  END IF;
  IF p_item_type='content' THEN
    UPDATE public.contents SET status='approved',published_at=now() WHERE id=p_item_id;
  ELSE
    UPDATE public.courses SET status='approved',published_at=now() WHERE id=p_item_id;
  END IF;

  v_rewards_enabled := NOT (p_item_type='content' AND v_content_type='short');
  IF v_rewards_enabled THEN
    PERFORM set_config('classfy.authorized_reward_operation','on',true);
    SELECT public.get_or_create_current_cycle() INTO v_cycle;
    SELECT * INTO v_cfg FROM public.reward_actions_config WHERE action_key='CONTENT_APPROVED' AND active;
    IF FOUND THEN
      SELECT public.commit_reward_award(v_creator,'CONTENT_APPROVED_'||p_item_type||'_'||p_item_id::text,
        v_tracking_content,jsonb_build_object('source','admin_approval','item_type',p_item_type),v_cycle,
        jsonb_build_object('user_id',v_creator,'content_id',v_tracking_content,
          'action_key','CONTENT_APPROVED','points',v_cfg.points_creator,
          'cycle_points',v_cfg.points_creator,'point_type','creator',
          'metadata',jsonb_build_object('activation',true,'item_type',p_item_type,
            'item_id',p_item_id,'title',v_title)),NULL) INTO v_reward;
    END IF;

    SELECT count(*) INTO v_approved_count FROM (
      SELECT id FROM public.contents
      WHERE creator_id=v_creator AND status='approved' AND content_type<>'short'
      UNION ALL SELECT id FROM public.courses
      WHERE creator_id=v_creator AND status='approved'
    ) approved_items;
    IF v_approved_count=1 THEN
      SELECT * INTO v_first_cfg FROM public.reward_actions_config WHERE action_key='FIRST_UPLOAD' AND active;
      IF FOUND THEN
        SELECT public.commit_reward_award(v_creator,'FIRST_UPLOAD',NULL,
          jsonb_build_object('source','first_approved_upload'),v_cycle,
          jsonb_build_object('user_id',v_creator,'action_key','FIRST_UPLOAD',
            'points',v_first_cfg.points_creator,'cycle_points',v_first_cfg.points_creator,
            'point_type','creator','metadata',jsonb_build_object('activation',true,
              'item_type',p_item_type,'item_id',p_item_id,'title',v_title)),NULL) INTO v_first_reward;
      END IF;
    END IF;
  END IF;

  v_content_points := CASE
    WHEN NOT v_rewards_enabled OR COALESCE((v_reward->>'already_tracked')::boolean,false) THEN 0
    ELSE COALESCE(v_cfg.points_creator,0)
  END;
  v_first_upload_points := CASE
    WHEN NOT v_rewards_enabled OR COALESCE((v_first_reward->>'already_tracked')::boolean,false) THEN 0
    ELSE COALESCE(v_first_cfg.points_creator,0)
  END;
  v_total_points := v_content_points + v_first_upload_points;
  v_notification_message := 'Seu '||CASE WHEN p_item_type='course' THEN 'curso' ELSE 'conteúdo' END||
    ' "'||v_title||'" foi aprovado e publicado.';
  IF v_total_points > 0 THEN
    v_notification_message := v_notification_message||' Você recebeu +'||v_total_points||' Creator Points';
    IF v_first_upload_points > 0 THEN
      v_notification_message := v_notification_message||' (+'||v_content_points||
        ' pela aprovação e +'||v_first_upload_points||' pelo primeiro conteúdo)';
    END IF;
    v_notification_message := v_notification_message||'.';
  END IF;

  INSERT INTO public.notifications(user_id,type,title,message,related_content_id)
  VALUES (v_creator,CASE WHEN v_total_points>0 THEN 'reward' ELSE 'admin' END,
    CASE WHEN p_item_type='course' THEN 'Curso aprovado!' ELSE 'Conteúdo aprovado!' END,
    v_notification_message,CASE WHEN p_item_type='content' THEN p_item_id ELSE NULL END);
  INSERT INTO public.economic_admin_audit(admin_id,action,entity_type,entity_id,reason,old_value,new_value)
  VALUES (auth.uid(),'approve',p_item_type,p_item_id::text,btrim(p_reason),
    jsonb_build_object('status',v_old_status),jsonb_build_object('status','approved','creator_id',v_creator,
      'economic_rewards_enabled',v_rewards_enabled,
      'content_reward',v_reward,'first_upload_reward',v_first_reward));
  RETURN jsonb_build_object('success',true,'idempotent',false,'creator_id',v_creator,
    'title',v_title,'content_type',v_content_type,
    'points',v_content_points,'first_upload_points',v_first_upload_points,
    'reward_excluded',NOT v_rewards_enabled,'monthly_limit_reached',false);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_content_v1(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_content_v1(uuid,text,text) TO authenticated;
