-- ============================================================
-- Migration 030: Data Integrity Constraints (Phase 2)
--
-- 1. ledger_entries: debit XOR credit CHECK
-- 2. transactions: require at least one source FK
-- 3. leases: unique active lease per unit
-- 4. applications: drop redundant property_id column
-- 5. leases: date range CHECK (end_date >= start_date)
-- ============================================================

-- ─── 1. LEDGER ENTRIES: Enforce double-entry accounting rules ───
-- A ledger entry must have EITHER debit > 0 (credit = 0) OR credit > 0 (debit = 0),
-- or both = 0 for reversals. Never both > 0.
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_debit_credit_xor
  CHECK (
    (debit > 0::numeric AND credit = 0::numeric) OR
    (debit = 0::numeric AND credit > 0::numeric) OR
    (debit = 0::numeric AND credit = 0::numeric)
  );

-- Also ensure debit/credit are never negative
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_debit_non_negative CHECK (debit >= 0);

ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_credit_non_negative CHECK (credit >= 0);

-- ─── 2. TRANSACTIONS: Require at least one source FK ───
-- Every transaction must link to a lease, vendor, or work order
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_source_required
  CHECK (
    lease_id IS NOT NULL OR vendor_id IS NOT NULL OR work_order_id IS NOT NULL
  );

-- ─── 3. LEASES: Unique active lease per unit ───
-- Prevents multiple tenants from having active leases on the same unit
CREATE UNIQUE INDEX idx_leases_one_active_per_unit
  ON public.leases (unit_id)
  WHERE status = 'Active';

-- ─── 4. APPLICATIONS: Drop redundant property_id column ───
-- property_id is derivable from unit_id → units.property_id (3NF violation)
-- First drop the FK constraint, index, then the column
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_property_id_fkey;
DROP INDEX IF EXISTS idx_applications_property_id;
ALTER TABLE public.applications DROP COLUMN IF EXISTS property_id;

-- ─── 5. LEASES: Date range validation ───
-- end_date must be >= start_date when both are set
ALTER TABLE public.leases
  ADD CONSTRAINT leases_date_range_valid
  CHECK (end_date IS NULL OR start_date <= end_date);
