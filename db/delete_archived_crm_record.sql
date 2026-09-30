-- Deploy with the frontend change. This function coordinates an explicit permanent
-- archive deletion and checks the existing record ownership rules before any write.
CREATE SCHEMA IF NOT EXISTS bsd_private;
REVOKE ALL ON SCHEMA bsd_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA bsd_private TO authenticated;

CREATE OR REPLACE FUNCTION bsd_private.delete_archived_crm_record(
  p_table text, p_id uuid, p_confirm boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_role text;
  record_data jsonb;
  links jsonb;
  removed uuid;
  history_snapshot jsonb;
BEGIN
  SELECT role::text INTO actor_role FROM public.profiles
  WHERE id = actor AND coalesce(status::text, '') NOT IN ('blocked','חסום');
  IF actor IS NULL OR actor_role IS NULL OR actor_role IN ('viewer','monitor') THEN
    RAISE EXCEPTION 'אין הרשאה למחוק רשומה' USING ERRCODE='42501';
  END IF;
  IF p_table = 'businesses' THEN
    SELECT to_jsonb(b) INTO record_data FROM public.businesses b WHERE id=p_id FOR UPDATE;
  ELSIF p_table = 'leads' THEN
    SELECT to_jsonb(l) INTO record_data FROM public.leads l WHERE id=p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'סוג רשומה לא תקין' USING ERRCODE='22023';
  END IF;
  IF record_data IS NULL OR NOT coalesce((record_data->>'is_archived')::boolean,false) THEN
    RAISE EXCEPTION 'מחיקה סופית אפשרית רק מתוך הארכיון' USING ERRCODE='42501';
  END IF;
  IF NOT coalesce((
    actor_role = 'admin' OR
    (p_table = 'businesses' AND (actor_role = 'manager' OR record_data->>'created_by'=actor::text OR record_data->>'handled_by'=actor::text)) OR
    (p_table = 'leads' AND record_data->>'type'='seller' AND (actor_role='manager' OR record_data->>'created_by'=actor::text OR record_data->>'handled_by'=actor::text)) OR
    (p_table = 'leads' AND record_data->>'type' IN ('buyer','partner') AND record_data->>'created_by'=actor::text)
  ), false) THEN
    RAISE EXCEPTION 'אין הרשאה למחוק רשומה זו' USING ERRCODE='42501';
  END IF;
  IF p_table='leads' THEN
    SELECT jsonb_build_object(
      'businesses',(SELECT count(*) FROM public.businesses WHERE seller_id=p_id),
      'matches',(SELECT count(*) FROM public.matches WHERE buyer_id=p_id),
      'tasks',(SELECT count(*) FROM public.tasks WHERE buyer_id=p_id),
      'meetings',(SELECT count(*) FROM public.match_meetings WHERE buyer_id=p_id),
      'distributions',(SELECT count(*) FROM public.anon_distributions WHERE buyer_id=p_id),
      'messages',(SELECT count(*) FROM public.whatsapp_messages WHERE lead_id=p_id),
      'vip_accounts',(SELECT count(*) FROM public.vip_accounts WHERE buyer_id=p_id),
      'vip_inquiries',(SELECT count(*) FROM public.vip_inquiries WHERE buyer_id=p_id)
    ) INTO links;
    IF (links->>'vip_accounts')::int > 0 AND actor_role <> 'admin' THEN
      RAISE EXCEPTION 'מחיקת כרטיס עם חשבון VIP דורשת מנהל מערכת' USING ERRCODE='42501';
    END IF;
  ELSE
    SELECT jsonb_build_object(
      'matches',(SELECT count(*) FROM public.matches WHERE business_id=p_id),
      'tasks',(SELECT count(*) FROM public.tasks WHERE business_id=p_id),
      'documents',(SELECT count(*) FROM public.broker_document_log WHERE business_id=p_id)
    ) INTO links;
  END IF;
  IF NOT coalesce(p_confirm,false) THEN
    RETURN jsonb_build_object('deleted',false,'id',p_id,'linked',links);
  END IF;
  IF p_table='leads' THEN
    -- Keep other business cards and work items. Match history is retained in the audit snapshot.
    UPDATE public.businesses SET seller_id=NULL WHERE seller_id=p_id;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'match',to_jsonb(m),
      'status_history',(SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) FROM public.match_status_history h WHERE h.match_id=m.id),
      'activity_history',(SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM public.match_activity_log a WHERE a.match_id=m.id)
    )), '[]'::jsonb) INTO history_snapshot FROM public.matches m WHERE buyer_id=p_id;
    DELETE FROM public.matches WHERE buyer_id=p_id;
    UPDATE public.tasks SET buyer_id=NULL WHERE buyer_id=p_id;
    UPDATE public.match_meetings SET buyer_id=NULL WHERE buyer_id=p_id;
    UPDATE public.whatsapp_messages SET lead_id=NULL WHERE lead_id=p_id;
    UPDATE public.client_number_correction_log SET lead_id=NULL WHERE lead_id=p_id;
    -- These private child rows require a contact. VIP sessions expire by FK cascade.
    DELETE FROM public.anon_distributions WHERE buyer_id=p_id;
    DELETE FROM public.whatsapp_lead_state WHERE lead_id=p_id;
    DELETE FROM public.vip_inquiries WHERE buyer_id=p_id;
    DELETE FROM public.vip_accounts WHERE buyer_id=p_id;
    DELETE FROM public.leads WHERE id=p_id AND is_archived RETURNING id INTO removed;
  ELSE
    UPDATE public.broker_document_log SET business_id=NULL WHERE business_id=p_id;
    DELETE FROM public.businesses WHERE id=p_id AND is_archived RETURNING id INTO removed;
  END IF;
  IF removed IS DISTINCT FROM p_id THEN
    RAISE EXCEPTION 'המחיקה לא בוצעה';
  END IF;
  INSERT INTO public.audit_log(table_name,record_id,action,actor_id,details)
  VALUES(p_table,p_id,'archive_permanent_delete',actor,
    jsonb_build_object('record',record_data,'linked',links,'match_history',history_snapshot));
  RETURN jsonb_build_object('deleted',true,'id',removed,'linked',links);
END;
$$;
REVOKE ALL ON FUNCTION bsd_private.delete_archived_crm_record(text,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bsd_private.delete_archived_crm_record(text,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_archived_crm_record(
  p_table text, p_id uuid, p_confirm boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT bsd_private.delete_archived_crm_record(p_table,p_id,p_confirm); $$;
REVOKE ALL ON FUNCTION public.delete_archived_crm_record(text,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_archived_crm_record(text,uuid,boolean) TO authenticated;
