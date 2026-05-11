-- ============================================================
-- 040_sms_notifications.sql
-- SMS/Text Messaging: Twilio integration schema
-- Alters notification_queue, creates sms_templates & notification_preferences
-- ============================================================

-- ── 1A. Alter notification_queue for SMS support ──
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS recipient_phone text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS sms_sid text;

-- Make recipient_email nullable (was NOT NULL — SMS-only rows won't have email)
ALTER TABLE public.notification_queue
  ALTER COLUMN recipient_email DROP NOT NULL;

-- Ensure at least one contact method exists
ALTER TABLE public.notification_queue
  ADD CONSTRAINT chk_has_recipient
  CHECK (recipient_email IS NOT NULL OR recipient_phone IS NOT NULL);

-- Index for SMS processing
CREATE INDEX IF NOT EXISTS idx_notification_queue_sms_pending
  ON public.notification_queue(created_at)
  WHERE channel = 'sms' AND status = 'pending';

-- ── 1B. SMS Templates ──
CREATE TABLE IF NOT EXISTS public.sms_templates (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug        text UNIQUE NOT NULL,
  body        text NOT NULL,
  description text,
  is_active   boolean DEFAULT true NOT NULL,
  created_at  timestamptz DEFAULT now() NOT NULL,
  updated_at  timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.sms_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "management_full_sms_templates"
  ON public.sms_templates FOR ALL
  USING (is_management())
  WITH CHECK (is_management());

-- Seed default templates
INSERT INTO public.sms_templates (slug, body, description) VALUES
  ('rent_reminder',
   'Hi {{tenant_name}}, your rent of ${{amount}} for {{property}} is due on {{due_date}}. Pay online at rylexa.com or contact your property manager.',
   'Monthly rent reminder sent before due date'),
  ('late_fee_notice',
   'Hi {{tenant_name}}, a late fee of ${{fee_amount}} has been applied to your account for {{property}}. Your total balance is ${{balance}}. Please pay promptly.',
   'Late fee notification after grace period'),
  ('maintenance_update',
   'Hi {{tenant_name}}, update on your maintenance request "{{ticket_title}}": {{status_update}}. Questions? Reply to this message.',
   'Work order status change notification'),
  ('lease_expiry',
   'Hi {{tenant_name}}, your lease at {{property}} {{unit}} expires on {{expiry_date}}. Please contact us to discuss renewal options.',
   'Lease expiry warning 60/30 days before'),
  ('payment_confirmation',
   'Hi {{tenant_name}}, we received your payment of ${{amount}} for {{property}}. Thank you!',
   'Payment received confirmation')
ON CONFLICT (slug) DO NOTHING;

-- ── 1C. Notification Preferences ──
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel  text NOT NULL CHECK (channel IN ('email','sms','push')),
  category text NOT NULL CHECK (category IN ('rent_reminder','maintenance','lease','payment','announcement')),
  enabled  boolean DEFAULT true NOT NULL,
  UNIQUE(user_id, channel, category)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own preferences
CREATE POLICY "users_select_own_preferences"
  ON public.notification_preferences FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users_update_own_preferences"
  ON public.notification_preferences FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_insert_own_preferences"
  ON public.notification_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Management has full access
CREATE POLICY "management_full_notification_preferences"
  ON public.notification_preferences FOR ALL
  USING (is_management())
  WITH CHECK (is_management());

-- Index for quick lookups
CREATE INDEX idx_notification_preferences_user
  ON public.notification_preferences(user_id);

-- ── 1D. Feature flag ──
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('sms_notifications', false, 'Enable Twilio SMS text message notifications')
ON CONFLICT (key) DO NOTHING;
