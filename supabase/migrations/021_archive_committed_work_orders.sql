-- Add archived flag to work_orders
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- Index for fast filtering of non-archived work orders
CREATE INDEX IF NOT EXISTS idx_work_orders_archived
  ON public.work_orders (archived)
  WHERE archived = false;

-- Update the commit_work_order_expense RPC to also archive the work order
CREATE OR REPLACE FUNCTION public.commit_work_order_expense(p_work_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wo          record;
  v_vendor_name text;
  v_prop_name   text;
  v_tx_id       uuid;
  v_je_id       uuid;
  v_description text;
BEGIN
  -- 1. Validate the work order
  SELECT wo.id, wo.cost, wo.status, wo.ledger_committed, wo.unit_id, wo.vendor_id
    INTO v_wo
    FROM public.work_orders wo
   WHERE wo.id = p_work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found';
  END IF;
  IF v_wo.ledger_committed THEN
    RAISE EXCEPTION 'Already committed to ledger';
  END IF;
  IF v_wo.cost IS NULL OR v_wo.cost <= 0 THEN
    RAISE EXCEPTION 'Work order has no cost to commit';
  END IF;
  IF v_wo.status NOT IN ('Completed', 'Closed', 'Done') THEN
    RAISE EXCEPTION 'Work order must be completed before committing';
  END IF;

  -- 2. Look up vendor name and property name for the description
  SELECT COALESCE(v.company_name, v.contact_name, 'Unknown Vendor')
    INTO v_vendor_name
    FROM public.vendors v
   WHERE v.id = v_wo.vendor_id;

  IF v_vendor_name IS NULL THEN
    v_vendor_name := 'No Vendor';
  END IF;

  SELECT COALESCE(p.name, 'Unknown Property')
    INTO v_prop_name
    FROM public.units u
    JOIN public.properties p ON p.id = u.property_id
   WHERE u.id = v_wo.unit_id;

  v_description := 'Maintenance: ' || v_vendor_name || ' @ ' || COALESCE(v_prop_name, 'Unknown');

  -- 3. Insert transaction
  INSERT INTO public.transactions (type, amount, description, status, work_order_id, date)
  VALUES ('Debit', v_wo.cost, v_description, 'Cleared', p_work_order_id, now())
  RETURNING id INTO v_tx_id;

  -- 4. Insert journal entry
  INSERT INTO public.journal_entries (entry_type, reference_id, amount, description, created_by)
  VALUES ('MAINTENANCE_EXPENSE', v_tx_id::text, v_wo.cost, v_description, ( SELECT auth.uid() ))
  RETURNING id INTO v_je_id;

  -- 5. Insert ledger entries (double-entry)
  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_je_id, (SELECT id FROM public.gl_accounts WHERE account_number = '5000'), v_wo.cost, 0, v_description),
    (v_je_id, (SELECT id FROM public.gl_accounts WHERE account_number = '1000'), 0, v_wo.cost, v_description);

  -- 6. Mark committed AND archived
  UPDATE public.work_orders
     SET ledger_committed = true,
         archived = true
   WHERE id = p_work_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'journal_entry_id', v_je_id,
    'amount', v_wo.cost,
    'description', v_description
  );
END;
$$;

-- Backfill: archive any already-committed work orders
UPDATE public.work_orders SET archived = true WHERE ledger_committed = true AND archived = false;
