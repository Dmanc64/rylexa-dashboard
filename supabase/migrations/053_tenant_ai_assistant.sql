-- ============================================================
-- 053_tenant_ai_assistant.sql
-- Tenant AI Assistant: pgvector, lease document RAG,
-- property policies, and conversation history.
-- ============================================================

-- ── 1. Enable pgvector extension ─────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ── 2. lease_document_chunks ─────────────────────────────────
-- Stores chunked lease text with vector embeddings for RAG retrieval.
-- Each chunk is linked to a lease and optionally a document record.
CREATE TABLE public.lease_document_chunks (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lease_id      uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  document_id   uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  chunk_index   integer NOT NULL,
  content       text NOT NULL,
  section_title text,           -- e.g. "Pet Policy", "Late Fees", "Lease Termination"
  embedding     extensions.vector(1536),  -- OpenAI text-embedding-3-small dimension
  token_count   integer,
  metadata      jsonb DEFAULT '{}',
  created_at    timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.lease_document_chunks IS 'Chunked lease document text with vector embeddings for RAG-based tenant AI assistant.';
COMMENT ON COLUMN public.lease_document_chunks.embedding IS 'OpenAI text-embedding-3-small 1536-dim vector for similarity search.';
COMMENT ON COLUMN public.lease_document_chunks.section_title IS 'Extracted section heading for the chunk, used for context display.';

-- Indexes for lease_document_chunks
CREATE INDEX idx_lease_chunks_lease ON public.lease_document_chunks(lease_id);
CREATE INDEX idx_lease_chunks_document ON public.lease_document_chunks(document_id);

-- HNSW index for fast vector similarity search
CREATE INDEX idx_lease_chunks_embedding ON public.lease_document_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── 3. property_policies ─────────────────────────────────────
-- Stores property-level rules and policies (pet, parking, noise, etc.)
CREATE TABLE public.property_policies (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id   uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (category IN (
    'pet_policy', 'parking', 'guest_policy', 'noise_quiet_hours',
    'trash_recycling', 'maintenance_procedures', 'move_in_out',
    'amenities', 'insurance', 'general_rules', 'smoking', 'other'
  )),
  title         text NOT NULL,
  content       text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer DEFAULT 0,
  updated_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz DEFAULT now() NOT NULL,
  updated_at    timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.property_policies IS 'Property-level rules and policies surfaced by the tenant AI assistant.';

-- Indexes for property_policies
CREATE INDEX idx_policies_property ON public.property_policies(property_id);
CREATE INDEX idx_policies_category ON public.property_policies(category);
CREATE INDEX idx_policies_active ON public.property_policies(property_id, is_active) WHERE is_active = true;

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION public.set_property_policies_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_property_policies_updated_at
  BEFORE UPDATE ON public.property_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_property_policies_updated_at();

-- ── 4. RLS Policies ──────────────────────────────────────────

-- lease_document_chunks
ALTER TABLE public.lease_document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full access to lease chunks"
  ON public.lease_document_chunks FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Tenants read own lease chunks"
  ON public.lease_document_chunks FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'Tenant'
    AND lease_id IN (
      SELECT l.id FROM public.leases l
      WHERE l.user_id = (SELECT auth.uid()) AND l.status = 'Active'
    )
  );

-- property_policies
ALTER TABLE public.property_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full access to policies"
  ON public.property_policies FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Tenants read active policies for their property"
  ON public.property_policies FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'Tenant'
    AND is_active = true
    AND property_id IN (
      SELECT u.property_id FROM public.units u
      JOIN public.leases l ON l.unit_id = u.id
      WHERE l.user_id = (SELECT auth.uid()) AND l.status = 'Active'
    )
  );

CREATE POLICY "Owners read policies for their properties"
  ON public.property_policies FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'Owner'
    AND is_active = true
    AND property_id IN (
      SELECT p.id FROM public.properties p
      WHERE p.owner_id = (SELECT public.get_my_owner_id())
    )
  );

-- ── 5. Vector similarity search function ─────────────────────
-- Used by the tenant-assistant edge function for RAG retrieval.
CREATE OR REPLACE FUNCTION public.match_lease_chunks(
  query_embedding extensions.vector(1536),
  match_lease_id uuid,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  content text,
  section_title text,
  similarity float
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    ldc.id,
    ldc.content,
    ldc.section_title,
    1 - (ldc.embedding <=> query_embedding) AS similarity
  FROM public.lease_document_chunks ldc
  WHERE ldc.lease_id = match_lease_id
    AND 1 - (ldc.embedding <=> query_embedding) > match_threshold
  ORDER BY ldc.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_lease_chunks IS 'Vector similarity search for lease document chunks. Returns top N chunks above threshold.';

-- Grant execute to authenticated users (RLS on the table still applies)
GRANT EXECUTE ON FUNCTION public.match_lease_chunks TO authenticated;

-- ── 6. Feature flags ─────────────────────────────────────────
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('tenant_ai_rag', true, 'Enable RAG-based lease document search in tenant AI assistant'),
  ('tenant_ai_policies', true, 'Enable property policy retrieval in tenant AI assistant')
ON CONFLICT (key) DO NOTHING;
