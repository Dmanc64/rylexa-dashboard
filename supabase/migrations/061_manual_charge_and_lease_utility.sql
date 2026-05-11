-- Manual charge RPC for one-off charges (utility, late fee, credit)
CREATE OR REPLACE FUNCTION public.post_manual_charge(
  p_lease_id    uuid,
  p_type        text,
  p_amount      numeric,
  p_date        date DEFAULT CURRENT_DATE,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_accounting_id uuid;
  v_caller_role text;
BEGIN
  SELECT role INTO v_caller_role
  FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('Admin', 'Property Manager', 'Accounting') THEN
    RAISE EXCEPTION 'Access denied: insufficient role';
  END IF;

  IF p_type NOT IN ('Utility Charge', 'Late Fee', 'Credit') THEN
    RAISE EXCEPTION 'Invalid charge type: %', p_type;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Charge amount must be positive';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.leases WHERE id = p_lease_id) THEN
    RAISE EXCEPTION 'Lease not found';
  END IF;

  INSERT INTO public.accounting (
    transaction_date, type, category, description,
    amount, status, user_id, lease_id
  ) VALUES (
    p_date, p_type, p_type,
    COALESCE(p_description, p_type || ' - Manual charge'),
    p_amount, 'Posted', auth.uid(), p_lease_id
  )
  RETURNING id INTO v_accounting_id;

  RETURN v_accounting_id;
END;
$$;

-- Update update_lease_details to accept utility_fee parameter
DROP FUNCTION IF EXISTS public.update_lease_details(uuid, numeric, numeric, date, text, text);

CREATE OR REPLACE FUNCTION public.update_lease_details(
  p_lease_id    uuid,
  p_rent        numeric DEFAULT NULL,
  p_deposit     numeric DEFAULT NULL,
  p_end_date    date DEFAULT NULL,
  p_phone       text DEFAULT NULL,
  p_email       text DEFAULT NULL,
  p_utility_fee numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  UPDATE public.leases
  SET
    rent_amount      = COALESCE(p_rent, rent_amount),
    security_deposit = COALESCE(p_deposit, security_deposit),
    end_date         = p_end_date,
    utility_fee      = COALESCE(p_utility_fee, utility_fee)
  WHERE id = p_lease_id;

  SELECT tenant_id INTO v_tenant_id FROM public.leases WHERE id = p_lease_id;

  IF v_tenant_id IS NOT NULL THEN
    UPDATE public.tenants
    SET
      phone = COALESCE(NULLIF(p_phone, ''), phone),
      email = COALESCE(NULLIF(p_email, ''), email)
    WHERE id = v_tenant_id;
  END IF;
END;
$$;
