-- ============================================================
-- 037_communications.sql
-- Communication Center: conversations, participants, messages
-- Also creates missing notification_queue table
-- ============================================================

-- ── 1A. conversations ──
CREATE TABLE public.conversations (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_type   text NOT NULL DEFAULT 'direct' CHECK (conversation_type IN ('direct','announcement')),
  subject             text,
  property_id         uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_by          uuid NOT NULL REFERENCES auth.users(id),
  last_message_at     timestamptz DEFAULT now(),
  last_message_preview text,
  is_archived         boolean NOT NULL DEFAULT false,
  created_at          timestamptz DEFAULT now() NOT NULL,
  updated_at          timestamptz DEFAULT now() NOT NULL
);

-- ── 1B. conversation_participants ──
CREATE TABLE public.conversation_participants (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  last_read_at      timestamptz DEFAULT now(),
  is_muted          boolean NOT NULL DEFAULT false,
  joined_at         timestamptz DEFAULT now() NOT NULL,
  UNIQUE(conversation_id, user_id)
);

-- ── 1C. messages ──
CREATE TABLE public.messages (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id         uuid NOT NULL REFERENCES auth.users(id),
  sender_name       text NOT NULL,
  body              text NOT NULL,
  created_at        timestamptz DEFAULT now() NOT NULL
);

-- ── 1D. notification_queue (fix missing table) ──
CREATE TABLE IF NOT EXISTS public.notification_queue (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_email   text NOT NULL,
  recipient_name    text,
  subject           text NOT NULL,
  body              text NOT NULL,
  channel           text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','push')),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  related_entity_id uuid,
  created_at        timestamptz DEFAULT now() NOT NULL,
  processed_at      timestamptz
);

-- ── 1E. Indexes ──
CREATE INDEX idx_conversations_created_by ON public.conversations(created_by);
CREATE INDEX idx_conversations_property ON public.conversations(property_id);
CREATE INDEX idx_conversations_type ON public.conversations(conversation_type);
CREATE INDEX idx_conversations_last_message ON public.conversations(last_message_at DESC);
CREATE INDEX idx_conversations_not_archived ON public.conversations(last_message_at DESC) WHERE NOT is_archived;
CREATE INDEX idx_participants_user ON public.conversation_participants(user_id);
CREATE INDEX idx_participants_conversation ON public.conversation_participants(conversation_id);
CREATE INDEX idx_messages_conversation_created ON public.messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON public.messages(sender_id);
CREATE INDEX idx_notification_queue_pending ON public.notification_queue(created_at) WHERE status = 'pending';

-- ── 1F. Enable RLS ──
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

-- ── conversations RLS ──
CREATE POLICY "management_full_conversations"
  ON public.conversations FOR ALL
  USING (is_management())
  WITH CHECK (is_management());

CREATE POLICY "participants_select_conversations"
  ON public.conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id
        AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "participants_update_conversations"
  ON public.conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id
        AND cp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id
        AND cp.user_id = auth.uid()
    )
  );

-- ── conversation_participants RLS ──
CREATE POLICY "management_full_participants"
  ON public.conversation_participants FOR ALL
  USING (is_management())
  WITH CHECK (is_management());

CREATE POLICY "users_select_own_participants"
  ON public.conversation_participants FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users_update_own_participants"
  ON public.conversation_participants FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── messages RLS ──
CREATE POLICY "management_full_messages"
  ON public.messages FOR ALL
  USING (is_management())
  WITH CHECK (is_management());

CREATE POLICY "participants_select_messages"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "participants_insert_messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

-- ── notification_queue RLS ──
CREATE POLICY "management_full_notification_queue"
  ON public.notification_queue FOR ALL
  USING (is_management())
  WITH CHECK (is_management());

-- ── 1G. Triggers ──
CREATE OR REPLACE FUNCTION public.update_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_conversations_updated_at();

CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(NEW.body, 100)
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_conversation_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_conversation_on_message();

-- ── 1H. Realtime publication ──
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_participants;

-- ── 1I. Feature flag ──
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('communications', true, 'Enable Communication Center feature')
ON CONFLICT (key) DO NOTHING;
