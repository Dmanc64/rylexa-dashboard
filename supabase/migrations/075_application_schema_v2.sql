-- ============================================================================
-- Migration 075: Rental Application Schema v2
--
-- Adds the data model for the redesigned rental application form:
--   - New columns on `applications` (identity, IDs, employment, screening Q's,
--     draft handling, encrypted SSN/gov-ID)
--   - 10 child tables for 1:N data (phones, emails, addresses, dependents,
--     pets, bank accounts, credit cards, additional income, emergency
--     contacts, co-applicants)
--   - pgcrypto extension for SSN/gov-ID encryption
--   - RLS: SELECT inherits from parent applications; writes service-role only
--     (server actions handle all mutations)
--
-- Additive only — existing applications keep all their current data.
-- New fields are nullable for backwards compat.
-- ============================================================================

BEGIN;


-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================================
-- 1. APPLICATIONS — additive column extensions
-- ============================================================================

ALTER TABLE public.applications
  -- Identity
  ADD COLUMN IF NOT EXISTS salutation              text,
  ADD COLUMN IF NOT EXISTS middle_name             text,
  ADD COLUMN IF NOT EXISTS no_middle_name_certified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS suffix                  text,

  -- Applicant type + company
  ADD COLUMN IF NOT EXISTS applicant_type          text
    CHECK (applicant_type IS NULL OR applicant_type IN (
      'Financially Responsible',
      'Co-Signer',
      'Other Applicant'
    )),
  ADD COLUMN IF NOT EXISTS company_name            text,
  ADD COLUMN IF NOT EXISTS use_company_as_display_name boolean DEFAULT false,

  -- Move-in
  ADD COLUMN IF NOT EXISTS desired_move_in         date,

  -- Personal IDs (encrypted via pgcrypto, app-level key)
  ADD COLUMN IF NOT EXISTS ssn_encrypted           bytea,        -- pgp_sym_encrypt output
  ADD COLUMN IF NOT EXISTS gov_id_encrypted        bytea,
  ADD COLUMN IF NOT EXISTS gov_id_issuing_state    text,

  -- Employment expansions (extends existing income/employer fields)
  ADD COLUMN IF NOT EXISTS employer_phone          text,
  ADD COLUMN IF NOT EXISTS employer_address        text,
  ADD COLUMN IF NOT EXISTS employer_address_2      text,
  ADD COLUMN IF NOT EXISTS position_held           text,
  ADD COLUMN IF NOT EXISTS years_worked            integer,
  ADD COLUMN IF NOT EXISTS supervisor_name         text,
  ADD COLUMN IF NOT EXISTS supervisor_title        text,
  ADD COLUMN IF NOT EXISTS supervisor_email        text,
  ADD COLUMN IF NOT EXISTS monthly_salary          numeric,

  -- Screening questions
  ADD COLUMN IF NOT EXISTS q_delinquent_payment    boolean,
  ADD COLUMN IF NOT EXISTS q_felony_conviction     boolean,
  ADD COLUMN IF NOT EXISTS q_sued_landlord         boolean,
  ADD COLUMN IF NOT EXISTS q_water_filled_furniture boolean,
  ADD COLUMN IF NOT EXISTS q_smoker                boolean,

  -- Notes
  ADD COLUMN IF NOT EXISTS notes                   text,

  -- Draft handling (multi-session resumption via magic link)
  ADD COLUMN IF NOT EXISTS draft_token             uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS draft_email             text,
  ADD COLUMN IF NOT EXISTS submitted_at            timestamptz;

CREATE INDEX IF NOT EXISTS idx_applications_draft_token ON public.applications(draft_token);
CREATE INDEX IF NOT EXISTS idx_applications_submitted_at ON public.applications(submitted_at);


-- ============================================================================
-- 2. CHILD TABLES
-- ============================================================================

-- ── 2a. application_phones ──
CREATE TABLE IF NOT EXISTS public.application_phones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  label           text,                       -- e.g. 'Cell', 'Work', 'Home'
  phone_number    text NOT NULL,
  is_primary      boolean DEFAULT false,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_phones_app ON public.application_phones(application_id);
ALTER TABLE public.application_phones ENABLE ROW LEVEL SECURITY;


-- ── 2b. application_emails ──
CREATE TABLE IF NOT EXISTS public.application_emails (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  email           text NOT NULL,
  is_primary      boolean DEFAULT false,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_emails_app ON public.application_emails(application_id);
ALTER TABLE public.application_emails ENABLE ROW LEVEL SECURITY;


-- ── 2c. application_addresses ──
CREATE TABLE IF NOT EXISTS public.application_addresses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('current', 'previous')),
  street_1           text,
  street_2           text,
  city               text,
  state              text,
  postal_code        text,
  country            text DEFAULT 'United States',
  occupancy_type     text,                    -- 'Rent', 'Own', 'Other'
  resided_from       date,
  resided_to         date,                    -- null for current address
  monthly_payment    numeric,
  landlord_name      text,
  landlord_phone     text,
  landlord_email     text,
  reason_for_leaving text,
  sort_order         integer DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT addresses_date_order CHECK (resided_to IS NULL OR resided_from IS NULL OR resided_to >= resided_from)
);
CREATE INDEX IF NOT EXISTS idx_application_addresses_app ON public.application_addresses(application_id);
ALTER TABLE public.application_addresses ENABLE ROW LEVEL SECURITY;


-- ── 2d. application_dependents ──
CREATE TABLE IF NOT EXISTS public.application_dependents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  date_of_birth   date,
  relationship    text,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_dependents_app ON public.application_dependents(application_id);
ALTER TABLE public.application_dependents ENABLE ROW LEVEL SECURITY;


-- ── 2e. application_pets ──
CREATE TABLE IF NOT EXISTS public.application_pets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  name            text,
  type_breed      text,
  weight_lbs      numeric,
  age_years       numeric,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_pets_app ON public.application_pets(application_id);
ALTER TABLE public.application_pets ENABLE ROW LEVEL SECURITY;


-- ── 2f. application_bank_accounts ──
-- Only the bank name + last 4 of the account number are stored.
-- The full account number must NEVER touch the database.
CREATE TABLE IF NOT EXISTS public.application_bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  bank_name       text NOT NULL,
  account_type    text,                       -- 'Checking', 'Savings', 'Money Market', 'Other'
  account_last4   text CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{4}$'),
  balance         numeric,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_bank_accounts_app ON public.application_bank_accounts(application_id);
ALTER TABLE public.application_bank_accounts ENABLE ROW LEVEL SECURITY;


-- ── 2g. application_credit_cards ──
CREATE TABLE IF NOT EXISTS public.application_credit_cards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  issuer          text,
  balance         numeric,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_credit_cards_app ON public.application_credit_cards(application_id);
ALTER TABLE public.application_credit_cards ENABLE ROW LEVEL SECURITY;


-- ── 2h. application_additional_income ──
CREATE TABLE IF NOT EXISTS public.application_additional_income (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  source          text,
  monthly_amount  numeric,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_additional_income_app ON public.application_additional_income(application_id);
ALTER TABLE public.application_additional_income ENABLE ROW LEVEL SECURITY;


-- ── 2i. application_emergency_contacts ──
CREATE TABLE IF NOT EXISTS public.application_emergency_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  name            text,
  address         text,
  phone           text,
  email           text,
  relationship    text,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_emergency_contacts_app ON public.application_emergency_contacts(application_id);
ALTER TABLE public.application_emergency_contacts ENABLE ROW LEVEL SECURITY;


-- ── 2j. application_coapplicants ──
-- A co-applicant is invited via email; they fill in their personal section
-- via a portal_token magic link. Status tracks where they are in the flow.
CREATE TABLE IF NOT EXISTS public.application_coapplicants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  email           text NOT NULL,
  applicant_type  text NOT NULL CHECK (applicant_type IN ('Co-Signer', 'Other Applicant')),
  portal_token    uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invite_sent_at  timestamptz,
  status          text NOT NULL DEFAULT 'Invited'
                  CHECK (status IN ('Invited', 'Started', 'Submitted', 'Withdrawn')),
  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_coapplicants_app ON public.application_coapplicants(application_id);
CREATE INDEX IF NOT EXISTS idx_application_coapplicants_token ON public.application_coapplicants(portal_token);
ALTER TABLE public.application_coapplicants ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 3. RLS POLICIES — child tables inherit visibility from parent application
-- ============================================================================

-- Standard pattern: SELECT scoped by parent application's RLS (which is
-- already property-scoped via 071b's applications_scoped_read).
-- All writes are service-role only — server actions handle every mutation,
-- which lets us validate, encrypt, log, and atomically transact.

DO $$
DECLARE
  t text;
  child_tables text[] := ARRAY[
    'application_phones',
    'application_emails',
    'application_addresses',
    'application_dependents',
    'application_pets',
    'application_bank_accounts',
    'application_credit_cards',
    'application_additional_income',
    'application_emergency_contacts',
    'application_coapplicants'
  ];
BEGIN
  FOREACH t IN ARRAY child_tables
  LOOP
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (application_id IN (SELECT id FROM public.applications))
    $f$, t || '_scoped_read', t);
  END LOOP;
END $$;


-- ============================================================================
-- 4. ENCRYPTION HELPERS
--
-- These wrap pgcrypto so server actions can encrypt/decrypt SSN + gov-ID
-- without scattering pgp_sym calls everywhere. The key is passed in by the
-- caller — server actions read it from env (APPLICATION_PII_ENCRYPTION_KEY)
-- and pass it to these functions.
-- ============================================================================

-- pgcrypto lives in the `extensions` schema (Supabase convention), so we
-- fully-qualify the function references and use empty search_path for safety.
-- The third arg to pgp_sym_encrypt needs an explicit ::text cast — otherwise
-- it's typed as 'unknown' and the overload resolution fails.

CREATE OR REPLACE FUNCTION public.encrypt_pii(p_plaintext text, p_key text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT extensions.pgp_sym_encrypt(p_plaintext, p_key, 'cipher-algo=aes256'::text);
$$;

CREATE OR REPLACE FUNCTION public.decrypt_pii(p_ciphertext bytea, p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT extensions.pgp_sym_decrypt(p_ciphertext, p_key);
$$;

COMMENT ON FUNCTION public.encrypt_pii(text, text) IS
  'Wraps pgp_sym_encrypt for SSN/gov-ID storage. Key must come from env (APPLICATION_PII_ENCRYPTION_KEY). Lose the key → lose ability to decrypt.';

COMMENT ON FUNCTION public.decrypt_pii(bytea, text) IS
  'Pair of encrypt_pii. Server-action-only: never call from client.';

-- Restrict to service role; authenticated users shouldn't see plaintext PII.
REVOKE EXECUTE ON FUNCTION public.encrypt_pii(text, text) FROM public, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrypt_pii(bytea, text) FROM public, authenticated;


COMMIT;
