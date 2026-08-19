-- ============================================================================
-- BSD-CRM — מעקב הפצת חומר אנונימי לקונים (סוכן מורשה)
-- תאריך: 19/08/2026
-- ----------------------------------------------------------------------------
-- מטרה: סוכן מורשה שרואה עסק במסך האנונימי יראה סימון "הסכם חתום" (סטטוס
-- בלבד, לא הקובץ עצמו - ראו business_files_agreements_restrict_select
-- שכבר קיים ומונע ממנו לצפות בהסכם), יראה קבצים המסומנים confidentiality_level=1
-- (כבר קיימים ב-business_sale_files), ויוכל לשלוח אותם לקונים שלו בלבד תוך
-- תיעוד מלא. לא נוצר מנגנון סטטוס-הסכם כפול - נעשה שימוש ב-agreement_status
-- הקיים. לא נוצר מנגנון התאמות מקביל - כל הפצה מקושרת לרשומת matches קיימת
-- (נוצרת אוטומטית אם אין), כך שההיסטוריה מתגלגלת גם בכרטיסי עסק/קונה
-- הקיימים וגם בדוח החדש.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הרחבת businesses_anonymous_card: הוספת סטטוס הסכם (לא הקובץ, רק הסטטוס)
-- ---------------------------------------------------------------------------
drop view if exists businesses_anonymous_card;
create view businesses_anonymous_card
with (security_invoker = false) as
select
  id,
  coalesce(anon_display_name, field) as anon_display_name,
  field, category, subcategory, city, years_active,
  annual_revenue, operating_profit, net_profit, employees_count,
  anon_summary,
  case when anon_card_show_price then asking_price else null end as asking_price,
  handled_by,
  anon_card_active,
  anon_summary_generated_at,
  agreement_status,                      -- חדש: סטטוס בלבד, לא agreement_pdf_path
  created_at, updated_at
from businesses b
where anon_card_active = true
  and (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
    or exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
    or has_full_business_access(id, auth.uid())
  );

grant select on businesses_anonymous_card to authenticated;

-- ---------------------------------------------------------------------------
-- 2. הרשאת קריאה לקבצים אנונימיים (confidentiality_level=1) למי שרואה את
--    המסך האנונימי - היום sale_files_full_access_only דורש has_full_business_access
--    בלבד, כך שסוכן מורשה בתפקיד "אנונימי" לא ראה את הקובץ בכלל.
-- ---------------------------------------------------------------------------
drop policy if exists "sale_files_anon_view_select" on business_sale_files;
create policy "sale_files_anon_view_select" on business_sale_files
  for select using (
    confidentiality_level = 1
    and status = 'active'
    and exists (select 1 from businesses b where b.id = business_sale_files.business_id and b.anon_card_active = true)
    and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
    )
  );

-- אותו עיקרון בדיוק על ה-Storage עצמו (לא רק שורת המטא-דאטה)
drop policy if exists "business_files_anon_view_select" on storage.objects;
create policy "business_files_anon_view_select" on storage.objects
  for select using (
    bucket_id = 'business-files'
    and exists (
      select 1 from business_sale_files f
      join businesses b on b.id = f.business_id
      where f.storage_path = storage.objects.name
        and f.confidentiality_level = 1
        and f.status = 'active'
        and b.anon_card_active = true
    )
    and exists (select 1 from profiles p where p.id = auth.uid() and p.can_view_anonymous_businesses)
  );

-- ---------------------------------------------------------------------------
-- 3. טבלת מעקב הפצות
-- ---------------------------------------------------------------------------
create table if not exists anon_distributions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  anon_file_id uuid not null references business_sale_files(id),
  buyer_id uuid not null references leads(id),
  match_id uuid references matches(id),
  sender_user_id uuid not null references profiles(id),
  business_owner_user_id uuid references profiles(id),   -- תמונת מצב של handled_by/created_by בזמן השליחה, לדוח
  subject text,
  message text,
  channel text not null default 'email' check (channel in ('email','whatsapp')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
  delivery_error text,
  followup_status text not null default 'נשלח',   -- טקסט חופשי בכוונה - ניתן להרחבה/עריכה בעתיד בלי migration
  access_request_id uuid references business_access_requests(id),
  opened_at timestamptz,     -- רק אם/כאשר ספק המייל (Resend) יספק את זה בפועל - לא מומצא
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_anon_dist_business on anon_distributions(business_id);
create index if not exists idx_anon_dist_buyer on anon_distributions(buyer_id);
create index if not exists idx_anon_dist_sender on anon_distributions(sender_user_id);
create index if not exists idx_anon_dist_match on anon_distributions(match_id);

comment on column anon_distributions.followup_status is 'סטטוס תהליך מול הקונה - טקסט חופשי בכוונה כדי לאפשר הוספה/שינוי ערכים בעתיד בלי migration';
comment on table anon_distributions is 'תיעוד כל הפצה של קובץ אנונימי מסוכן לקונה - audit trail מלא, ראו trg_anon_distributions_audit לתיעוד שינויים';

-- ---------------------------------------------------------------------------
-- 4. Audit trail על שינוי/מחיקה - נעשה שימוש בטבלת audit_log הכללית הקיימת,
--    לא נבנה מנגנון תיעוד מקביל
-- ---------------------------------------------------------------------------
create or replace function trg_anon_distributions_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    insert into audit_log (table_name, record_id, action, actor_id, details)
    values ('anon_distributions', old.id, 'update', auth.uid(),
      jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)));
  elsif tg_op = 'DELETE' then
    insert into audit_log (table_name, record_id, action, actor_id, details)
    values ('anon_distributions', old.id, 'delete', auth.uid(), jsonb_build_object('old', to_jsonb(old)));
  end if;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists anon_distributions_audit on anon_distributions;
create trigger anon_distributions_audit
  after update or delete on anon_distributions
  for each row execute function trg_anon_distributions_audit();

-- updated_at אוטומטי
create or replace function trg_set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
drop trigger if exists anon_distributions_set_updated_at on anon_distributions;
create trigger anon_distributions_set_updated_at
  before update on anon_distributions
  for each row execute function trg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. RLS על anon_distributions - בדיוק לפי המפרט: admin/manager הכל, שולח
--    רואה את שלו, בעל העסק רואה הפצות של העסק שלו, בעל הקונה רואה הפצות
--    שהתקבלו אצל הקונה שלו. אין דליפה בין סוכנים שלא קשורים.
-- ---------------------------------------------------------------------------
alter table anon_distributions enable row level security;

drop policy if exists "anon_dist_admin_manager_full" on anon_distributions;
create policy "anon_dist_admin_manager_full" on anon_distributions
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager'))
  );

drop policy if exists "anon_dist_select" on anon_distributions;
create policy "anon_dist_select" on anon_distributions
  for select using (
    sender_user_id = auth.uid()
    or has_full_business_access(business_id, auth.uid())
    or exists (select 1 from leads l where l.id = anon_distributions.buyer_id and (l.created_by = auth.uid() or l.handled_by = auth.uid()))
  );

-- הוספה: רק אם השולח הוא המשתמש עצמו, הקונה שייך לו (created_by/handled_by),
-- הקובץ באמת מסומן אנונימי ופעיל, והעסק באמת בכרטיס האנונימי הפעיל -
-- בדיקת הגנה כפולה, לא רק הסתמכות על מה שהלקוח שולח
drop policy if exists "anon_dist_insert" on anon_distributions;
create policy "anon_dist_insert" on anon_distributions
  for insert with check (
    sender_user_id = auth.uid()
    and exists (
      select 1 from leads l where l.id = buyer_id
      and (l.created_by = auth.uid() or l.handled_by = auth.uid()
           or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','manager')))
    )
    and exists (
      select 1 from business_sale_files f
      join businesses b on b.id = f.business_id
      where f.id = anon_file_id and f.business_id = anon_distributions.business_id
        and f.confidentiality_level = 1 and f.status = 'active'
        and b.anon_card_active = true
    )
  );

-- עדכון סטטוס תהליך (followup_status): אדמין/מנהל, השולח עצמו, או בעל העסק
drop policy if exists "anon_dist_update" on anon_distributions;
create policy "anon_dist_update" on anon_distributions
  for update using (
    sender_user_id = auth.uid()
    or has_full_business_access(business_id, auth.uid())
  );

grant select, insert, update on anon_distributions to authenticated;
