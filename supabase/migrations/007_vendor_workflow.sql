-- Migration 007: Vendor workflow support
-- Adds related_entity_id to system_activity for linking notifications
-- to specific work orders (used for tenant-facing repair updates)

ALTER TABLE public.system_activity
  ADD COLUMN IF NOT EXISTS related_entity_id uuid;
