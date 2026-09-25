-- Each business can link its own private source folder and indicate the year
-- of structured financial figures. Private folder identifiers and financial
-- values are entered only in the protected database, never in this repository.
alter table public.businesses add column if not exists drive_folder_url text;
alter table public.businesses add column if not exists financial_year integer;
