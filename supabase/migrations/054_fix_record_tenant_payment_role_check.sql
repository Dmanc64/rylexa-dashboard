-- Fix record_tenant_payment to allow Admin/PM/Accounting roles
-- Previously only checked leases.user_id = auth.uid(), blocking admin users
-- Now matches the same role-based pattern used in get_tenant_balance and get_tenant_ledger

CREATE OR REPLACE FUNCTION public.record_tenant_payment(
  p_lease_id       uuid,
  p_amount         numeric,
  p_date           date,
  p_category       text DEFAULT 'Rent Payment',
  p_description    text DEFAULT NULL,
  p_payment_method text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_accounting_id uuid;
  v_user_id uuid;
  v_user_email text;
  v_caller_role text;
BEGIN
  v_user_id := auth.uid();

  -- Check caller's role — admins and PMs can record payments on any lease
  SELECT role INTO v_caller_role
  FROM public.profiles WHERE id = v_user_id;

  IF v_caller_role IN ('Admin', 'Property Manager', 'Accounting') THEN
    -- Authorized staff, skip ownership check
    NULL;
  ELSIF EXISTS (
    SELECT 1 FROM public.leases
    WHERE leases.id = p_lease_id AND leases.user_id = v_user_id
  ) THEN
    -- Direct tenant match
    NULL;
  ELSE
    -- Email-based fallback for tenants
    SELECT email INTO v_user_email
    FROM auth.users WHERE id = v_user_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.tenants t ON t.id = l.tenant_id
      WHERE l.id = p_lease_id AND lower(t.email) = lower(v_user_email)
    ) THEN
      RAISE EXCEPTION 'Access denied: lease does not belong to the authenticated user';
    END IF;

    -- Auto-link user_id for future direct lookups
    UPDATE public.leases SET user_id = v_user_id WHERE id = p_lease_id AND user_id IS NULL;
  END IF;

  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;

  INSERT INTO public.accounting (
    transaction_date,
    type,
    category,
    description,
    amount,
    status,
    user_id,
    lease_id,
    payment_method
  ) VALUES (
    p_date,
    'Payment',
    COALESCE(p_category, 'Rent Payment'),
    COALESCE(p_description, 'Online rent payment'),
    p_amount,
    'Posted',
    v_user_id,
    p_lease_id,
    p_payment_method
  )
  RETURNING id INTO v_accounting_id;

  RETURN v_accounting_id;
END;
$$;
