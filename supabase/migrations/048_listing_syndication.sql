-- ============================================================
-- 048_listing_syndication.sql
-- Vacancy Listing Syndication: tables, trigger, RLS, storage, seed, feature flag
-- ============================================================

-- 1. ALTER properties: add state, zip for ILS feed addresses
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS zip text;

-- 2. ALTER units: add listing-related columns
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS bathrooms integer,
  ADD COLUMN IF NOT EXISTS sqft integer,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS amenities text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pet_policy text,
  ADD COLUMN IF NOT EXISTS availability_date date;

-- 3. CREATE unit_listings
CREATE TABLE IF NOT EXISTS public.unit_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  rent_amount numeric(10,2) NOT NULL,
  deposit_amount numeric(10,2),
  lease_terms text[] DEFAULT '{12 months}',
  amenities text[] DEFAULT '{}',
  pet_policy text CHECK (pet_policy IN ('allowed','not_allowed','case_by_case')) DEFAULT 'case_by_case',
  photos text[] DEFAULT '{}',
  virtual_tour_url text,
  contact_email text,
  contact_phone text,
  status text CHECK (status IN ('draft','published','archived')) DEFAULT 'draft',
  published_at timestamptz,
  archived_at timestamptz,
  is_featured boolean DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_unit_listing UNIQUE (unit_id)
);

-- 4. CREATE syndication_channels
CREATE TABLE IF NOT EXISTS public.syndication_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel_type text CHECK (channel_type IN ('ils_feed','manual')) DEFAULT 'manual',
  feed_url text,
  is_active boolean DEFAULT true,
  logo_url text,
  created_at timestamptz DEFAULT now()
);

-- 5. CREATE listing_syndications
CREATE TABLE IF NOT EXISTS public.listing_syndications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.unit_listings(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.syndication_channels(id) ON DELETE CASCADE,
  status text CHECK (status IN ('active','paused','removed')) DEFAULT 'active',
  external_url text,
  syndicated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_listing_channel UNIQUE (listing_id, channel_id)
);

-- 6. Updated_at trigger for unit_listings
CREATE OR REPLACE FUNCTION public.set_unit_listings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_unit_listings_updated_at
  BEFORE UPDATE ON public.unit_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_unit_listings_updated_at();

-- 7. Auto-archive listing when unit becomes occupied
CREATE OR REPLACE FUNCTION public.auto_archive_listing_on_occupy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'Occupied' AND (OLD.status IS DISTINCT FROM 'Occupied') THEN
    UPDATE public.unit_listings
    SET status = 'archived', archived_at = now()
    WHERE unit_id = NEW.id AND status IN ('draft', 'published');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_archive_listing_on_occupy
  AFTER UPDATE OF status ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.auto_archive_listing_on_occupy();

-- 8. Indexes
CREATE INDEX IF NOT EXISTS idx_unit_listings_unit_id ON public.unit_listings(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_listings_status ON public.unit_listings(status);
CREATE INDEX IF NOT EXISTS idx_listing_syndications_listing_id ON public.listing_syndications(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_syndications_channel_id ON public.listing_syndications(channel_id);

-- 9. RLS — unit_listings
ALTER TABLE public.unit_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full access to unit_listings"
  ON public.unit_listings FOR ALL
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Staff read unit_listings"
  ON public.unit_listings FOR SELECT
  USING (public.is_staff());

CREATE POLICY "Public read published unit_listings"
  ON public.unit_listings FOR SELECT
  USING (status = 'published');

-- 10. RLS — syndication_channels
ALTER TABLE public.syndication_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full access to syndication_channels"
  ON public.syndication_channels FOR ALL
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Staff read syndication_channels"
  ON public.syndication_channels FOR SELECT
  USING (public.is_staff());

CREATE POLICY "Public read active syndication_channels"
  ON public.syndication_channels FOR SELECT
  USING (is_active = true);

-- 11. RLS — listing_syndications
ALTER TABLE public.listing_syndications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full access to listing_syndications"
  ON public.listing_syndications FOR ALL
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Staff read listing_syndications"
  ON public.listing_syndications FOR SELECT
  USING (public.is_staff());

-- 12. Seed default syndication channels
INSERT INTO public.syndication_channels (name, channel_type, is_active) VALUES
  ('Zillow', 'ils_feed', true),
  ('Apartments.com', 'ils_feed', true),
  ('Realtor.com', 'ils_feed', true),
  ('Craigslist', 'manual', true),
  ('Facebook Marketplace', 'manual', true)
ON CONFLICT DO NOTHING;

-- 13. Storage bucket for listing photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listings',
  'listings',
  true,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: management can upload/delete, public can read
CREATE POLICY "Management upload listing photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'listings' AND public.is_management());

CREATE POLICY "Management delete listing photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'listings' AND public.is_management());

CREATE POLICY "Public read listing photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'listings');

-- 14. Feature flag
INSERT INTO public.feature_flags (key, value, description)
VALUES ('listing_syndication', true, 'Enable vacancy listing syndication and ILS feed')
ON CONFLICT (key) DO NOTHING;
