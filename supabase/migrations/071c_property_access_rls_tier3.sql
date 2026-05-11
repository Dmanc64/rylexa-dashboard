-- ============================================================================
-- Migration 071c: Tier 3 RLS Rewrite (via lease_id → unit → property scope)
--
-- Tables (Tier 3 = lease-scoped financial + tenant data):
--   1.  tenants                    (via leases.tenant_id reverse)
--   2.  accounting                 (lease_id, nullable)
--   3.  transactions               (lease_id, nullable)
--   4.  lease_renewals             (lease_id)
--   5.  lease_renewal_scores       (lease_id)
--   6.  lease_signatures           (lease_id)
--   7.  lease_document_chunks      (lease_id)
--   8.  insurance_policies         (lease_id, NOT NULL)
--   9.  autopay_settings           (lease_id, NOT NULL)
--   10. payments                   (lease_id, NOT NULL)
--   11. tenant_payment_methods     (tenant_id → tenant → lease)
--   12. income_certifications      (lease_id, NOT NULL)
--   13. household_members          (certification_id → income_certifications)
--
-- Helpers added:
--   user_lease_ids(uuid)            SETOF uuid — leases in user's property scope
--   user_can_manage_lease(uuid)     boolean    — write authorization
--   user_can_post_to_lease(uuid)    boolean    — financial-write authorization
--
-- Preserved policies (relationship-scoped):
--   Tenant self-read on accounting, lease_*, payments, insurance, etc.
--   Tenant ALL on autopay_settings, tenant_payment_methods (user_id match)
--   Tenant INSERT on payments, insurance_policies
--   Vendor read on transactions (vendor_id match)
--   New: maintenance can read tenants for their assigned work orders' leases
-- ============================================================================

BEGIN;


-- ============================================================================
-- HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_lease_ids(p_user_id uuid DEFAULT auth.uid())
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT l.id FROM public.leases l
  WHERE l.unit_id IN (SELECT public.user_unit_ids(p_user_id));
$$;
GRANT EXECUTE ON FUNCTION public.user_lease_ids(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_can_manage_lease(p_lease_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT public.user_can_manage_property(
    (SELECT u.property_id FROM public.leases l JOIN public.units u ON u.id = l.unit_id WHERE l.id = p_lease_id),
    p_user_id
  );
$$;
GRANT EXECUTE ON FUNCTION public.user_can_manage_lease(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_can_post_to_lease(p_lease_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT public.user_can_post_financials(
    (SELECT u.property_id FROM public.leases l JOIN public.units u ON u.id = l.unit_id WHERE l.id = p_lease_id),
    p_user_id
  );
$$;
GRANT EXECUTE ON FUNCTION public.user_can_post_to_lease(uuid, uuid) TO authenticated;


-- ============================================================================
-- 1. TENANTS  (id IN [tenant_ids referenced by visible leases])
-- ============================================================================

DROP POLICY IF EXISTS "Maintenance read tenants"   ON public.tenants;
DROP POLICY IF EXISTS "Management manage tenants"  ON public.tenants;

CREATE POLICY "tenants_scoped_read" ON public.tenants
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT l.tenant_id FROM public.leases l
      WHERE l.unit_id IN (SELECT public.user_unit_ids())
    )
  );

CREATE POLICY "tenants_scoped_write" ON public.tenants
  FOR ALL TO authenticated
  USING (
    id IN (
      SELECT l.tenant_id FROM public.leases l
      WHERE l.unit_id IN (SELECT public.user_unit_ids())
        AND public.user_can_manage_unit(l.unit_id)
    )
  )
  WITH CHECK (
    id IN (
      SELECT l.tenant_id FROM public.leases l
      WHERE l.unit_id IN (SELECT public.user_unit_ids())
        AND public.user_can_manage_unit(l.unit_id)
    )
  );

-- Maintenance can read tenants for their assigned work orders' units
CREATE POLICY "tenants_maintenance_via_work_orders" ON public.tenants
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'Maintenance'
    AND id IN (
      SELECT l.tenant_id FROM public.leases l
      JOIN public.work_orders wo ON wo.unit_id = l.unit_id
      WHERE wo.assigned_to = (SELECT auth.uid())
    )
  );

-- Preserved: "Tenants read own record"


-- ============================================================================
-- 2. ACCOUNTING  (lease_id, nullable)
-- ============================================================================

DROP POLICY IF EXISTS "Accounting read accounting"     ON public.accounting;
DROP POLICY IF EXISTS "Management manage accounting"   ON public.accounting;

CREATE POLICY "accounting_scoped_read" ON public.accounting
  FOR SELECT TO authenticated
  USING (
    lease_id IN (SELECT public.user_lease_ids())
    OR (lease_id IS NULL AND public.is_admin())
  );

CREATE POLICY "accounting_scoped_write" ON public.accounting
  FOR ALL TO authenticated
  USING (
    (lease_id IS NOT NULL AND lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_post_to_lease(lease_id))
    OR (lease_id IS NULL AND public.is_admin())
  )
  WITH CHECK (
    (lease_id IS NOT NULL AND lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_post_to_lease(lease_id))
    OR (lease_id IS NULL AND public.is_admin())
  );

-- Preserved: "Tenants read own accounting"


-- ============================================================================
-- 3. TRANSACTIONS  (lease_id, nullable)
-- ============================================================================

DROP POLICY IF EXISTS "Accounting read transactions"     ON public.transactions;
DROP POLICY IF EXISTS "Management manage transactions"   ON public.transactions;

CREATE POLICY "transactions_scoped_read" ON public.transactions
  FOR SELECT TO authenticated
  USING (
    lease_id IN (SELECT public.user_lease_ids())
    OR (lease_id IS NULL AND public.is_admin())
  );

CREATE POLICY "transactions_scoped_write" ON public.transactions
  FOR ALL TO authenticated
  USING (
    (lease_id IS NOT NULL AND lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_post_to_lease(lease_id))
    OR (lease_id IS NULL AND public.is_admin())
  )
  WITH CHECK (
    (lease_id IS NOT NULL AND lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_post_to_lease(lease_id))
    OR (lease_id IS NULL AND public.is_admin())
  );

-- Preserved: "Vendors read own transactions" (vendor_id match)


-- ============================================================================
-- 4. LEASE_RENEWALS
-- ============================================================================

DROP POLICY IF EXISTS "lease_renewals_finance_read"     ON public.lease_renewals;
DROP POLICY IF EXISTS "lease_renewals_management_all"   ON public.lease_renewals;

CREATE POLICY "lease_renewals_scoped_read" ON public.lease_renewals
  FOR SELECT TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()));

CREATE POLICY "lease_renewals_scoped_write" ON public.lease_renewals
  FOR ALL TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id))
  WITH CHECK (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id));

-- Preserved: "lease_renewals_tenant_read"


-- ============================================================================
-- 5. LEASE_RENEWAL_SCORES
-- ============================================================================

DROP POLICY IF EXISTS "renewal_scores_read_management" ON public.lease_renewal_scores;

CREATE POLICY "lease_renewal_scores_scoped_read" ON public.lease_renewal_scores
  FOR SELECT TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()));

CREATE POLICY "lease_renewal_scores_scoped_write" ON public.lease_renewal_scores
  FOR ALL TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id))
  WITH CHECK (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id));


-- ============================================================================
-- 6. LEASE_SIGNATURES
-- ============================================================================

DROP POLICY IF EXISTS "lease_signatures_finance_read"     ON public.lease_signatures;
DROP POLICY IF EXISTS "lease_signatures_management_all"   ON public.lease_signatures;

CREATE POLICY "lease_signatures_scoped_read" ON public.lease_signatures
  FOR SELECT TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()));

CREATE POLICY "lease_signatures_scoped_write" ON public.lease_signatures
  FOR ALL TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id))
  WITH CHECK (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id));

-- Preserved: "lease_signatures_tenant_read"


-- ============================================================================
-- 7. LEASE_DOCUMENT_CHUNKS
-- ============================================================================

DROP POLICY IF EXISTS "Management full access to lease chunks" ON public.lease_document_chunks;

CREATE POLICY "lease_chunks_scoped_read" ON public.lease_document_chunks
  FOR SELECT TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()));

CREATE POLICY "lease_chunks_scoped_write" ON public.lease_document_chunks
  FOR ALL TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id))
  WITH CHECK (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id));

-- Preserved: "Tenants read own lease chunks"


-- ============================================================================
-- 8. INSURANCE_POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "insurance_policies_management_all" ON public.insurance_policies;

CREATE POLICY "insurance_policies_scoped_read" ON public.insurance_policies
  FOR SELECT TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()));

CREATE POLICY "insurance_policies_scoped_write" ON public.insurance_policies
  FOR ALL TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id))
  WITH CHECK (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id));

-- Preserved: "insurance_policies_tenant_read", "insurance_policies_tenant_insert"


-- ============================================================================
-- 9. AUTOPAY_SETTINGS
-- ============================================================================

DROP POLICY IF EXISTS "autopay_management_read" ON public.autopay_settings;

CREATE POLICY "autopay_settings_scoped_read" ON public.autopay_settings
  FOR SELECT TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()));

-- Note: tenants own their autopay via "autopay_tenant_all" — preserved.
-- Management does not write autopay (tenants control it).

-- Preserved: "autopay_tenant_all"


-- ============================================================================
-- 10. PAYMENTS
-- ============================================================================

DROP POLICY IF EXISTS "payments_management_all" ON public.payments;

CREATE POLICY "payments_scoped_read" ON public.payments
  FOR SELECT TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()));

CREATE POLICY "payments_scoped_write" ON public.payments
  FOR UPDATE TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_post_to_lease(lease_id))
  WITH CHECK (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_post_to_lease(lease_id));

CREATE POLICY "payments_scoped_delete" ON public.payments
  FOR DELETE TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_post_to_lease(lease_id));

-- Preserved: "payments_tenant_read", "payments_tenant_insert"


-- ============================================================================
-- 11. TENANT_PAYMENT_METHODS  (no lease_id; scope via tenant_id → lease)
-- ============================================================================

DROP POLICY IF EXISTS "tpm_management_read" ON public.tenant_payment_methods;

CREATE POLICY "tenant_payment_methods_scoped_read" ON public.tenant_payment_methods
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT l.tenant_id FROM public.leases l
      WHERE l.unit_id IN (SELECT public.user_unit_ids())
    )
  );

-- No mgmt write — tenants own their payment methods (preserved via "tpm_tenant_all" → user_id match)


-- ============================================================================
-- 12. INCOME_CERTIFICATIONS
-- ============================================================================

DROP POLICY IF EXISTS "income_certs_accounting_read"   ON public.income_certifications;
DROP POLICY IF EXISTS "income_certs_management_all"    ON public.income_certifications;

CREATE POLICY "income_certs_scoped_read" ON public.income_certifications
  FOR SELECT TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()));

CREATE POLICY "income_certs_scoped_write" ON public.income_certifications
  FOR ALL TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id))
  WITH CHECK (lease_id IN (SELECT public.user_lease_ids()) AND public.user_can_manage_lease(lease_id));

-- Preserved: "income_certs_tenant_read"


-- ============================================================================
-- 13. HOUSEHOLD_MEMBERS  (via certification_id → income_certifications.lease_id)
-- ============================================================================

DROP POLICY IF EXISTS "household_members_accounting_read"  ON public.household_members;
DROP POLICY IF EXISTS "household_members_management_all"   ON public.household_members;

CREATE POLICY "household_members_scoped_read" ON public.household_members
  FOR SELECT TO authenticated
  USING (
    certification_id IN (
      SELECT id FROM public.income_certifications
      WHERE lease_id IN (SELECT public.user_lease_ids())
    )
  );

CREATE POLICY "household_members_scoped_write" ON public.household_members
  FOR ALL TO authenticated
  USING (
    certification_id IN (
      SELECT id FROM public.income_certifications
      WHERE lease_id IN (SELECT public.user_lease_ids())
        AND public.user_can_manage_lease(lease_id)
    )
  )
  WITH CHECK (
    certification_id IN (
      SELECT id FROM public.income_certifications
      WHERE lease_id IN (SELECT public.user_lease_ids())
        AND public.user_can_manage_lease(lease_id)
    )
  );

COMMIT;
