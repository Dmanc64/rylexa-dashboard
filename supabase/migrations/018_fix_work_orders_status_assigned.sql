-- Migration 018: Add 'Assigned' to work_orders status CHECK constraint
-- The AssignVendorModal sets status='Assigned' but migration 014 omitted it.

ALTER TABLE work_orders DROP CONSTRAINT work_orders_status_check;

ALTER TABLE work_orders ADD CONSTRAINT work_orders_status_check
  CHECK (status IS NULL OR status IN (
    'Open', 'Assigned', 'In Progress', 'Completed', 'On Hold', 'Done', 'Closed'
  ));
