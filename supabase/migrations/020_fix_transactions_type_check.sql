-- ============================================================================
-- Migration 020: Fix transactions type CHECK constraint & P&L view
--
-- The original constraint only allowed 'Income'/'Expense' but the codebase
-- uses 'Credit'/'Debit' (reconciliation) and 'Debit' (P&L view, ledger commit).
-- Also updates P&L view to capture expenses linked via work_order_id (no lease_id).
-- ============================================================================

-- Fix constraint to include all used type values
ALTER TABLE public.transactions DROP CONSTRAINT transactions_type_check;

ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('Income', 'Expense', 'Credit', 'Debit'));

-- Update P&L view to:
-- 1. Match on both 'Expense' and 'Debit' types
-- 2. Join through work_order_id for maintenance expenses (which have no lease_id)
DROP VIEW IF EXISTS public.view_profit_and_loss;
CREATE VIEW public.view_profit_and_loss
WITH (security_invoker = true)
AS
SELECT
  p.id AS property_id,
  p.name AS property_name,
  COALESCE(income.total, 0::numeric) AS total_income,
  COALESCE(expenses.total, 0::numeric) AS total_expenses,
  COALESCE(income.total, 0::numeric) - COALESCE(expenses.total, 0::numeric) AS net_operating_income
FROM properties p
LEFT JOIN (
  SELECT pr.id AS property_id, sum(l.rent_amount) AS total
  FROM leases l
  JOIN units u ON l.unit_id = u.id
  JOIN properties pr ON u.property_id = pr.id
  WHERE l.status = 'Active'
  GROUP BY pr.id
) income ON income.property_id = p.id
LEFT JOIN (
  SELECT pr.id AS property_id, sum(abs(tx.amount)) AS total
  FROM transactions tx
  LEFT JOIN leases l ON tx.lease_id = l.id
  LEFT JOIN work_orders wo ON tx.work_order_id = wo.id
  LEFT JOIN units u ON COALESCE(l.unit_id, wo.unit_id) = u.id
  JOIN properties pr ON u.property_id = pr.id
  WHERE tx.type IN ('Debit', 'Expense')
  GROUP BY pr.id
) expenses ON expenses.property_id = p.id;
