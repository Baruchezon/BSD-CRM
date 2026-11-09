-- Meeting-prep web research. Additive only.
--
-- businesses.pre_research stays as the internal note Dana / the office already
-- wrote (it often mixes a CRM status line with real findings). The printable
-- meeting form must not overwrite it.
--
-- market_research_brief — public web findings for the «חקר שוק קצר» row.
-- market_reviews        — public review findings for the «ביקורות וממצאים» row.
-- Both are internal. They are not added to businesses_anonymous_card,
-- public_business_listings, or any client-facing view (those views list columns
-- explicitly). RLS on businesses already covers the new columns the same way
-- it covers notes.
--
-- Rollback: migrations/2026-11-09_meeting_prep_research_rollback.sql

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS market_research_brief text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS market_reviews text;

COMMENT ON COLUMN public.businesses.market_research_brief IS
  'Internal meeting-prep web research (products, presence, reputation). Never sent to a client. Does not replace pre_research.';
COMMENT ON COLUMN public.businesses.market_reviews IS
  'Internal meeting-prep public review findings. Never sent to a client.';
