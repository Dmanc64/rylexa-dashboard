-- 057: Add standard utility fee to properties
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS standard_utility_fee numeric DEFAULT 0;
