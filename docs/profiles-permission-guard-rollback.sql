-- Rollback for 20261011094500_profiles_permission_fields_guard.sql: restores the previous body (role/status only).
create or replace function public.protect_profile_privileged_fields()
 returns trigger
 language plpgsql
 security definer
as $function$
begin
  -- מאפשר תמיד ל-service_role (משמש ע"י Edge Functions כמו create-user) לעדכן role/status,
  -- כי הגישה ל-Edge Function עצמה כבר מוגנת בבדיקת Admin בתוך קוד הפונקציה.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    -- מונע ממשתמש רגיל לשנות את ה-role או ה-status של עצמו או של אחרים (הסלמת הרשאות).
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$function$;
