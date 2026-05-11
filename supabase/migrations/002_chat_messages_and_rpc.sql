-- ============================================================
-- RYLEXA PM - MIGRATION 002
-- Creates: chat_messages table, get_tenant_portal_data RPC
--
-- RUN THIS IN: Supabase Dashboard > SQL Editor
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. CHAT_MESSAGES TABLE
-- Used by: src/app/admin/chat/page.tsx
-- Real-time team messaging between staff
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name   text,
  message_text  text NOT NULL,
  channel_name  text DEFAULT 'general',
  created_at    timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read messages
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read chat_messages"
    ON public.chat_messages FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow authenticated users to send messages
DO $$ BEGIN
  CREATE POLICY "Authenticated users can insert chat_messages"
    ON public.chat_messages FOR INSERT
    TO authenticated
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enable realtime for live chat (skip if already added)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for channel-based queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel
  ON public.chat_messages (channel_name, created_at);


-- ────────────────────────────────────────────────────────────
-- 2. RPC: get_tenant_portal_data
-- Used by: src/app/portal/page.tsx (fallback path)
-- Returns tenant portal data by email for tenants
-- who don't have a user_id linked to their lease.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_tenant_portal_data(target_email text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'tenant', json_build_object(
      'id', t.id,
      'first_name', t.first_name,
      'last_name', t.last_name
    ),
    'unit', json_build_object(
      'id', u.id,
      'name', u.name,
      'property_name', p.name
    ),
    'lease', json_build_object(
      'rent_amount', l.rent_amount,
      'end_date', l.end_date
    ),
    'recent_payments', COALESCE((
      SELECT json_agg(row_to_json(pay))
      FROM (
        SELECT a.amount, a.created_at AS date, a.description, a.status
        FROM public.accounting a
        WHERE a.lease_id = l.id
        ORDER BY a.created_at DESC
        LIMIT 10
      ) pay
    ), '[]'::json),
    'open_tickets_count', (
      SELECT COUNT(*)
      FROM public.work_orders wo
      WHERE wo.tenant_id = t.id
        AND wo.status IN ('Open', 'In Progress')
    )
  ) INTO v_result
  FROM public.tenants t
  JOIN public.leases l ON l.tenant_id = t.id AND l.status = 'Active'
  JOIN public.units u ON l.unit_id = u.id
  JOIN public.properties p ON u.property_id = p.id
  WHERE t.email = target_email
  LIMIT 1;

  RETURN v_result;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- DONE
-- ────────────────────────────────────────────────────────────
