-- Create the get_tenant_ledger and get_tenant_balance RPC functions
-- These were referenced by useTenantLedger hook but never created

CREATE OR REPLACE FUNCTION public.get_tenant_ledger(p_lease_id uuid)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  type text,
  category text,
  description text,
  amount numeric,
  status text,
  payment_method text,
  running_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_caller_role text;
  v_user_email text;
BEGIN
  v_user_id := auth.uid();

  SELECT p.role INTO v_caller_role
  FROM public.profiles p WHERE p.id = v_user_id;

  IF v_caller_role IN ('Admin', 'Property Manager', 'Accounting') THEN
    NULL;
  ELSIF EXISTS (
    SELECT 1 FROM public.leases l
    WHERE l.id = p_lease_id AND l.user_id = v_user_id
  ) THEN
    NULL;
  ELSE
    SELECT u.email INTO v_user_email
    FROM auth.users u WHERE u.id = v_user_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.tenants t ON t.id = l.tenant_id
      WHERE l.id = p_lease_id AND lower(t.email) = lower(v_user_email)
    ) THEN
      RAISE EXCEPTION 'Access denied: lease does not belong to the authenticated user';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.created_at,
    a.type,
    a.category,
    a.description,
    a.amount,
    a.status,
    a.payment_method,
    SUM(
      CASE
        WHEN a.type IN ('Payment', 'Credit') THEN -a.amount
        ELSE a.amount
      END
    ) OVER (ORDER BY a.transaction_date, a.created_at) AS running_balance
  FROM public.accounting a
  WHERE a.lease_id = p_lease_id
  ORDER BY a.transaction_date DESC, a.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_balance(p_lease_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_caller_role text;
  v_user_email text;
  v_balance numeric;
BEGIN
  v_user_id := auth.uid();

  SELECT p.role INTO v_caller_role
  FROM public.profiles p WHERE p.id = v_user_id;

  IF v_caller_role IN ('Admin', 'Property Manager', 'Accounting') THEN
    NULL;
  ELSIF EXISTS (
    SELECT 1 FROM public.leases l
    WHERE l.id = p_lease_id AND l.user_id = v_user_id
  ) THEN
    NULL;
  ELSE
    SELECT u.email INTO v_user_email
    FROM auth.users u WHERE u.id = v_user_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.tenants t ON t.id = l.tenant_id
      WHERE l.id = p_lease_id AND lower(t.email) = lower(v_user_email)
    ) THEN
      RAISE EXCEPTION 'Access denied: lease does not belong to the authenticated user';
    END IF;
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN a.type IN ('Payment', 'Credit') THEN -a.amount
      ELSE a.amount
    END
  ), 0) INTO v_balance
  FROM public.accounting a
  WHERE a.lease_id = p_lease_id;

  RETURN v_balance;
END;
$$;
