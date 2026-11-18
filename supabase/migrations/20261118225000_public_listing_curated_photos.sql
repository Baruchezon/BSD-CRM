-- Site-only listing photo. Apply before merging the website and CRM feature branches.
BEGIN;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS public_listing_image_path text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS public_listing_marketing_title text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS public_listing_marketing_text text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.businesses'::regclass
      AND conname = 'bsd_public_listing_image_path_format'
  ) THEN
    ALTER TABLE public.businesses ADD CONSTRAINT bsd_public_listing_image_path_format
      CHECK (
        public_listing_image_path IS NULL
        OR public_listing_image_path ~ '^public-listings/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$'
      );
  END IF;
END $$;

-- Preserve existing column order and append a public-safe image reference.
CREATE OR REPLACE VIEW public.public_business_listings AS
 SELECT id,
    field,
    category,
    subcategory,
    region,
    years_active,
    annual_revenue,
    employees_count,
    anon_display_name,
    anon_summary AS short_description,
        CASE
            WHEN anon_card_show_price THEN asking_price
            ELSE NULL::numeric
        END AS asking_price,
    created_at,
    business_number,
    public_listing_published_at AS published_at,
    (EXISTS ( SELECT 1
           FROM business_sale_files sf
          WHERE sf.business_id = b.id AND sf.status = 'active'::text AND sf.category <> 'business_photo'::text)) AS has_sale_file,
    NULLIF(TRIM(BOTH FROM COALESCE(internal_business_summary, ''::text)), ''::text) IS NOT NULL OR (EXISTS ( SELECT 1
           FROM business_sale_files sf
          WHERE sf.business_id = b.id AND sf.status = 'active'::text AND sf.category = 'exec_summary'::text AND COALESCE(sf.document_type, ''::text) <> 'anonymous_summary'::text)) AS has_full_summary,
    NULLIF(TRIM(BOTH FROM COALESCE(anon_summary, ''::text)), ''::text) IS NOT NULL OR (EXISTS ( SELECT 1
           FROM business_sale_files sf
          WHERE sf.business_id = b.id AND sf.status = 'active'::text AND (sf.category = 'anon_presentation'::text OR sf.category = 'exec_summary'::text AND sf.document_type = 'anonymous_summary'::text))) AS has_anonymous_summary,
    (EXISTS ( SELECT 1
           FROM business_sale_files sf
          WHERE sf.business_id = b.id AND sf.status = 'active'::text AND (sf.category = 'economic_analysis'::text OR sf.document_type = 'economic_analysis'::text OR sf.file_name ~~* '%ניתוח כלכלי%'::text OR sf.file_name ~~* '%economic analysis%'::text))) AS has_economic_analysis,
    (EXISTS ( SELECT 1
           FROM business_sale_files sf
          WHERE sf.business_id = b.id AND sf.status = 'active'::text AND (sf.category = 'valuation'::text OR sf.document_type = 'valuation'::text OR sf.file_name ~~* '%הערכת שווי%'::text OR sf.file_name ~~* '%valuation%'::text))) AS has_valuation,
    b.public_listing_image_path AS public_image_path,
    b.public_listing_marketing_title AS public_marketing_title,
    b.public_listing_marketing_text AS public_marketing_text
   FROM businesses b
  WHERE public_listing_active = true AND anon_card_active = true AND listing_status = 'active'::text AND NOT is_archived AND crm_stage IS NULL;

-- Public bucket exists already. Allow only approved managers to upload new images.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'bsd_public_listing_photo_upload'
  ) THEN
    CREATE POLICY bsd_public_listing_photo_upload ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'site-content-images'
      AND name ~ '^public-listings/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$'
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
          AND p.status = 'active'
          AND p.role IN ('admin', 'manager')
      )
    );
  END IF;
END $$;
COMMIT;
