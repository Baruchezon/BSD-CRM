-- 09.10.2026 (בקשת ברוך): «מצב טיפול» בכרטיס הליד. תוספת בלבד.
-- ערכים: לא טופל / טופל / סטנד ביי / לחזור עם תשובה. ברירת מחדל «לא טופל» לחדשים ולקיימים.
alter table public.leads
  add column if not exists handling_status text not null default 'לא טופל';
alter table public.leads
  add constraint leads_handling_status_check
  check (handling_status in ('לא טופל','טופל','סטנד ביי','לחזור עם תשובה'));
comment on column public.leads.handling_status is 'מצב טיפול בכרטיס הליד: לא טופל / טופל / סטנד ביי / לחזור עם תשובה (ברירת מחדל: לא טופל)';
