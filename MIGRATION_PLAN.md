# Rylexa.OS — Staged Cutover Plan

**Status:** Draft / on hold pending training and timeline review
**Owner:** Dan
**Last updated:** 2026-05-11

---

## Context

Rylexa.OS is **deployed** at `https://rylexapm.fly.dev` and connected to Supabase project
`lxblmqwdzeajsfbhnvss`. The database holds **871 active leases, ~$3.2M YTD GL data, 30 properties**
— but this data was imported from the previous property-management system and Rylexa is **not yet
the system of record** for any property's day-to-day operations.

The phased plan below describes how to make Rylexa the system of record, one property at a time,
without breaking the books or double-billing tenants.

---

## Deployment model — single DB, property-scoped activation

We keep **one** Supabase project. The flag `billing_settings.auto_post_rent` (and
`auto_post_utilities`, `auto_late_fees`) acts as the per-property switch for "Rylexa is the
system of record for this property."

- `auto_post_rent = false` → old system runs billing; Rylexa is informational only
- `auto_post_rent = true`  → Rylexa runs billing; old system is read-only for this property

This model was chosen over:

- **Separate dev/staging/prod databases** — too much data-sync overhead for one company.
- **Big-bang cutover** — too much risk for a $700K/month rent roll.

A separate dev sandbox project can be set up later for destructive testing without touching real
customer data, but is not required for the rollout itself.

---

## Phase calendar

| Phase | When | Scope | Risk |
|---|---|---|---|
| **Phase 0 — Pre-flight** | May 11 – May 31 | Pick pilot property, configure billing_settings, lock old-system ledger close-of-business May 31 | Low |
| **Phase 1 — Pilot (1 property)** | June 1 – June 30 | One property, 5–15 units, all-cash tenants, no Section 8 if possible | Low — failures touch one property |
| **Phase 2 — Two properties** | July 1 – July 31 | Add a second property | Low |
| **Phase 3 — All Carson** | August 1 onward | Bulk-enable every Carson property | **Medium** — biggest single jump |
| **Phase 4 — Expand** | September 2026 – January 2027 | Migrate remaining properties; debug as needed | Tapers as confidence grows |
| **Phase 5 — Full cutover** | January 2027 (target) | Old system goes read-only entirely | Final |

---

## Per-property cutover procedure

For each property going live, follow these steps:

### Step 0 — Pre-flight (week before)
- Confirm `billing_settings` row exists for the property with: `rent_due_day`, `grace_period_days`,
  `late_fee_amount`, `late_fee_type`.
- Verify `auto_post_rent = false` (don't accidentally run early).
- Identify each lease on the property; cross-check against old system.

### Step 1 — Cutover-day setup (last business day before cutover)
- Lock old-system ledger close-of-business.
- Snapshot tenant balances per old system.
- For each lease, post an opening-balance entry into Rylexa:

```sql
INSERT INTO public.accounting (lease_id, type, transaction_date, amount, description, status)
VALUES (
  '<lease_id>',
  'Opening Balance',
  '<cutover_date>',
  <amount_owed_from_old_system>,
  'Migrated from <old_system_name> as of <prior_business_day>',
  'Posted'
);
```

A lease that's caught up starts at $0. A lease that owes $X starts at $X.

### Step 2 — Flip the billing switch (cutover day)
```sql
UPDATE public.billing_settings
SET auto_post_rent = true,
    auto_post_utilities = true,
    auto_late_fees = true
WHERE property_id = '<property_id>';
```

The `run-billing` edge function will pick this up on its next scheduled run (typically the
`rent_due_day` of the month).

### Step 3 — Dual-process the first cycle
- All charges and payments for the active property → Rylexa.
- All charges and payments for other properties → old system.
- Mid-month sanity check: compare Rylexa balances against what tenants are paying.

### Step 4 — Month-end reconciliation
- Run Rylexa's P&L for the active property.
- Hand-prepare same property's P&L from old system.
- Compare. Numbers should match. **If they don't, that's the bug to fix before scaling.**

### Step 5 — Mark cutover complete
- Add a note to the property record: "Rylexa live since `<date>`".
- Old system: lock that property's records to read-only.

---

## Accounting impact

| Concern | Impact / mitigation |
|---|---|
| Will Rylexa's GL be wrong during pilots? | **No** — Rylexa is the source of truth *for active properties only*. The pre-import historical data in this DB is informational. |
| Will `view_profit_and_loss` show misleading numbers for non-active properties? | Yes, partially. The view reports whatever's in `journal_entries`. For non-active properties, those entries reflect the old system's history. Possibly add a UI banner: "Financials accurate for activated properties only." |
| Owner statements during pilot? | Active properties → trust Rylexa's `/owner-portal/statements`. Other owners → keep using old system. |
| **Tax / 1099 year-end 2026** | **Critical.** Must reconcile across both systems. Per-property cutover date must be documented. Accountant needs a clear "as-of date" per property. |
| Audit trail | Already in place — `audit_log` (migration 055/072) + `journal_entries.created_at` lets every entry be traced. |

---

## Open items to handle before Phase 1 (June)

These were proposed but **deferred** at the time of this archive. To revisit when training/timeline
review is done:

1. **Safety-state audit** — run a query confirming `billing_settings.auto_post_rent = false`
   across **all** properties before June 1. Don't want surprises.
2. **`run-billing` edge function code review** — read the function source, verify it respects
   `auto_post_rent` correctly and only processes properties that are enabled. Also verify it
   doesn't accidentally backfill prior months.
3. **Property activation badge** — add a UI badge on the property detail page showing
   "Rylexa live since `<date>`" (green) vs "Pre-go-live, see old system" (gray).
4. **Dev sandbox Supabase project** — eventually create a separate project for destructive
   testing. Push schema via migrations. Link local `npm run dev` to the sandbox for breaking
   changes. (Not required for the rollout, but good hygiene once volume grows.)
5. **Migration tracking** — document property → cutover-date → reconciliation-status in a
   format the accounting team can also see.

---

## ⚠️ Decisions captured for future-Dan

- **Do NOT bulk back-post the ~$1.48M in "missing" rent + utility charges (April + May 2026).**
  The gap exists because the old system was still doing the billing during those months.
  Posting those charges in Rylexa now would create double-billing.
- **Late fees during catch-up: skip.** When a property goes live mid-month or late, do NOT
  apply late fees for prior overdue cycles. Late fees resume on the first normal billing
  cycle under Rylexa.
- **Beta-test scope is small on purpose.** One property in June means failures are bounded.
  Resist the urge to scale faster than the reconciliation evidence supports.

---

## Useful queries for the rollout

```sql
-- Safety check: how many properties currently have billing enabled?
SELECT auto_post_rent, auto_post_utilities, count(*)
FROM public.billing_settings
GROUP BY auto_post_rent, auto_post_utilities;

-- What's the pilot property's lease + balance state right before cutover?
SELECT l.id AS lease_id, t.first_name || ' ' || t.last_name AS tenant,
       l.rent_amount, l.utility_fee,
       public.get_tenant_balance(t.id) AS current_rylexa_balance
FROM public.leases l
JOIN public.tenants t ON t.id = l.tenant_id
JOIN public.units u ON u.id = l.unit_id
WHERE u.property_id = '<pilot_property_id>' AND l.status = 'Active'
ORDER BY tenant;

-- After cutover, verify Rylexa P&L for the active property
SELECT * FROM public.get_property_pnl_by_period(
  '2026-06-01'::date,
  '2026-06-30'::date
);
```

---

## When you're ready to resume

Tell me where you are in the training/timeline review. Likely first task at that point will be the
safety-state audit (open item #1) — single query, takes 10 seconds, confirms we're not about to
post charges by accident.

If the timeline changes (e.g., June pilot pushed to July), update the phase calendar at the top of
this file and commit.
