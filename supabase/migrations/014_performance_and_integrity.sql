-- ============================================================================
-- Migration 014: Database Performance & Integrity
--
-- Phase 5 of the security remediation plan:
-- 1. Fix profiles_role_check to include 'Accounting' role
-- 2. Add missing FK indexes (17 found without indexes)
-- 3. Add query-pattern indexes for common access paths
-- 4. Add CHECK constraints for data integrity
-- 5. Add missing status CHECK constraints
--
-- ROLLBACK: DROP each index; revert CHECK constraints
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Fix profiles role CHECK constraint (CRITICAL)
-- The existing constraint blocks creation of Accounting users
-- ============================================================================

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('Admin', 'Property Manager', 'Accounting', 'Maintenance', 'Vendor', 'Tenant'));

-- ============================================================================
-- STEP 2: Add missing FK indexes
-- Every FK column needs an index for:
-- (a) JOINs from parent→child
-- (b) Cascading DELETE/UPDATE performance
-- (c) RLS sub-query performance (policies often join on FK columns)
-- ============================================================================

-- accounting
CREATE INDEX IF NOT EXISTS idx_accounting_lease_id ON public.accounting (lease_id);
CREATE INDEX IF NOT EXISTS idx_accounting_user_id ON public.accounting (user_id);

-- applications
CREATE INDEX IF NOT EXISTS idx_applications_unit_id ON public.applications (unit_id);
CREATE INDEX IF NOT EXISTS idx_applications_property_id ON public.applications (property_id);

-- chat_messages
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_id ON public.chat_messages (sender_id);

-- journal_entries
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_by ON public.journal_entries (created_by);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reference_id ON public.journal_entries (reference_id);

-- leases (tenant_id and unit_id already indexed via UNIQUE constraint)
CREATE INDEX IF NOT EXISTS idx_leases_user_id ON public.leases (user_id);

-- ledger_entries
CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal_entry_id ON public.ledger_entries (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_id ON public.ledger_entries (account_id);

-- transactions
CREATE INDEX IF NOT EXISTS idx_transactions_lease_id ON public.transactions (lease_id);
CREATE INDEX IF NOT EXISTS idx_transactions_vendor_id ON public.transactions (vendor_id);

-- work_orders
CREATE INDEX IF NOT EXISTS idx_work_orders_unit_id ON public.work_orders (unit_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_vendor_id ON public.work_orders (vendor_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_id ON public.work_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned_to ON public.work_orders (assigned_to);
CREATE INDEX IF NOT EXISTS idx_work_orders_requester_id ON public.work_orders (requester_id);

-- work_order_updates
CREATE INDEX IF NOT EXISTS idx_work_order_updates_work_order_id ON public.work_order_updates (work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_updates_user_id ON public.work_order_updates (user_id);

-- ============================================================================
-- STEP 3: Query-pattern indexes (for common frontend queries and RLS policies)
-- ============================================================================

-- leases: Status filter (Active) is used in nearly every query + RLS policy
CREATE INDEX IF NOT EXISTS idx_leases_status ON public.leases (status);

-- leases: Composite for the most common RLS policy subquery
-- "SELECT ... FROM leases WHERE user_id = auth.uid() AND status = 'Active'"
CREATE INDEX IF NOT EXISTS idx_leases_user_id_status ON public.leases (user_id, status);

-- tenants: Email lookup (used in tenant portal, search, vendor matching)
CREATE INDEX IF NOT EXISTS idx_tenants_email ON public.tenants (email);

-- tenants: Status filter
CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants (status);

-- vendors: Email lookup (case-insensitive matching via RLS)
CREATE INDEX IF NOT EXISTS idx_vendors_email_lower ON public.vendors (lower(email));

-- work_orders: Status filter (dashboard counts, open tickets)
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON public.work_orders (status);

-- work_orders: Created_at for recent orders
CREATE INDEX IF NOT EXISTS idx_work_orders_created_at ON public.work_orders (created_at DESC);

-- transactions: Date-based queries (cashflow, reports)
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions (date DESC);

-- transactions: Type filter (Income/Expense grouping)
CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.transactions (type);

-- accounting: Created_at for date-range queries
CREATE INDEX IF NOT EXISTS idx_accounting_created_at ON public.accounting (created_at);

-- accounting: Type filter
CREATE INDEX IF NOT EXISTS idx_accounting_type ON public.accounting (type);

-- applications: Status filter (Pending count for dashboard)
CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications (status);

-- profiles: Role lookup (used by RLS helper functions on every query)
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);

-- system_activity: Event type filter
CREATE INDEX IF NOT EXISTS idx_system_activity_event_type ON public.system_activity (event_type);

-- system_activity: Related entity for vendor/tenant scoped RLS
CREATE INDEX IF NOT EXISTS idx_system_activity_related_entity ON public.system_activity (related_entity_id);

-- ============================================================================
-- STEP 4: Additional CHECK constraints for data integrity
-- ============================================================================

-- leases: Rent must be non-negative
ALTER TABLE public.leases ADD CONSTRAINT leases_rent_non_negative
  CHECK (rent_amount IS NULL OR rent_amount >= 0);

-- leases: Security deposit must be non-negative
ALTER TABLE public.leases ADD CONSTRAINT leases_deposit_non_negative
  CHECK (security_deposit IS NULL OR security_deposit >= 0);

-- leases: Status must be a known value
ALTER TABLE public.leases ADD CONSTRAINT leases_status_check
  CHECK (status IN ('Active', 'Past', 'Expired', 'Terminated', 'Pending'));

-- work_orders: Priority must be a known value
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_priority_check
  CHECK (priority IS NULL OR priority IN ('Low', 'Normal', 'Medium', 'High', 'Urgent'));

-- work_orders: Status must be a known value
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_status_check
  CHECK (status IS NULL OR status IN ('Open', 'In Progress', 'Completed', 'On Hold', 'Done', 'Closed'));

-- work_orders: Cost must be non-negative
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_cost_non_negative
  CHECK (cost IS NULL OR cost >= 0);

-- tenants: Status must be a known value
ALTER TABLE public.tenants ADD CONSTRAINT tenants_status_check
  CHECK (status IS NULL OR status IN ('Active', 'Past', 'Evicted', 'Pending'));

-- applications: Status must be a known value
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IS NULL OR status IN ('Pending', 'Approved', 'Denied', 'Withdrawn'));

-- transactions: Amount must be non-zero
ALTER TABLE public.transactions ADD CONSTRAINT transactions_amount_non_zero
  CHECK (amount != 0);

-- accounting: Type check (has one but let's verify/add Rent Charge)
ALTER TABLE public.accounting DROP CONSTRAINT IF EXISTS accounting_type_check;
ALTER TABLE public.accounting ADD CONSTRAINT accounting_type_check
  CHECK (type IN ('Income', 'Expense', 'Rent Charge', 'Payment', 'Late Fee', 'Credit'));

COMMIT;
