-- BSD CRM — הוספת document_type 'anonymous_summary' למודול התקצירים
-- (מקביל ל-'short_summary'/'internal_full_summary' שכבר קיימים; אותה
-- קטגוריה קיימת exec_summary, אין קטגוריה/טבלה חדשה).

alter table business_sale_files drop constraint if exists business_sale_files_document_type_check;
alter table business_sale_files add constraint business_sale_files_document_type_check
  check (document_type is null or document_type in ('short_summary','internal_full_summary','anonymous_summary'));
