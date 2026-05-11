# Rylexa PM Dashboard — Architectural Audit & AI Roadmap

**Audited:** 2026-02-12
**Scope:** Full codebase — 60+ source files, 21 DB migrations, 13 edge functions, 4 portals
**Stack:** Next.js 16 (App Router) + React 19 + TypeScript 5 + Supabase + Tailwind CSS 4

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Performance Wins](#2-performance-wins)
3. [The AI Roadmap](#3-the-ai-roadmap)

---

## 1. Current State Analysis

### Architecture Overview

The application is a multi-portal property management platform with 4 distinct interfaces:

| Portal | Route | Roles | Purpose |
|--------|-------|-------|---------|
| Admin | `/admin/*` | Admin, Property Manager, Maintenance, Accounting | Full management console |
| Tenant | `/portal/*` | Tenant | Lease info, payments, maintenance requests |
| Vendor | `/vendor-portal/*` | Vendor | Work order management, cost logging |
| Public | `/apply`, `/login` | Anonymous | Rental applications, authentication |

**Database:** 17 tables, 5 views, 47 RLS policies, 20+ RPC functions, double-entry accounting ledger.
**Edge Functions:** 11 deployed functions (AI lease analysis, PDF generation, tenant assistant, late fee automation, notifications).

### The Top 3 Risks

#### Risk 1: RBAC Enforcement Gaps — Privilege Escalation Vectors

**Severity:** CRITICAL
**Impact:** A compromised or malicious staff account could modify data outside their property scope.

The middleware (`src/middleware.ts`) is well-designed — it enforces role-based routing on every request, validates sessions, and handles soft-disable via `is_active`. However, the server actions that execute privileged operations trust client-supplied IDs without ownership verification.

**Specific vulnerabilities found:**

| File | Function | Issue |
|------|----------|-------|
| `src/actions/maintenance-actions.ts` | `submitMaintenanceUpdate()` | Maintenance staff can update ANY work order system-wide. No check that the work order belongs to their assigned property. |
| `src/actions/application-actions.ts` | `processApplication()` | No property-level authorization. A PM for Property A can approve applications for Property B if they know the application UUID. |
| `src/actions/application-actions.ts` | Tenant reactivation branch | `existingTenantId` comes from the client with no verification the tenant belongs to the unit being processed. |
| `src/actions/create-user.ts` | `createStaffUser()` | `leaseId` parameter is unverified — an admin could link a new tenant to any lease in the system. |
| `src/actions/vendor-actions.ts` | Cost submission | Vendors self-report hours/materials with no approval workflow. Costs hit the ledger immediately. |

**Dev-mode data leak:** `src/app/portal/page.tsx` lines 130-144 expose a real tenant's full dashboard (name, rent, payments, tickets) to unauthenticated users when `NODE_ENV === 'development'`. If staging is internet-accessible, this is a PII breach.

#### Risk 2: Data Fetching Anti-Patterns — N+1 Queries & Waterfall Loading

**Severity:** HIGH
**Impact:** Slow page loads, excessive Supabase bandwidth, poor UX at scale.

The codebase has two distinct patterns: hooks using React Query (`useLeases`, `useTenantLedger`, `useFeatureFlags`) that are well-structured, and raw `useEffect` hooks + page-level fetching that exhibit significant anti-patterns.

**Worst offenders:**

| Location | Pattern | Impact |
|----------|---------|--------|
| `src/hooks/useProperties.ts` | Fetches ALL active leases into memory, then loops per-property to calculate revenue via `.filter()` | N+1 disguised as 2 queries. 100 properties x 500 leases = 50,000 filter operations client-side. |
| `src/app/portal/page.tsx` | 5 sequential API calls in a waterfall chain: auth → lease → (payments, tickets) → notifications | Tenant portal initial load requires 5 round-trips before rendering. |
| `src/app/vendor-portal/page.tsx` | 4 sequential calls: auth → profile → vendor lookup → work orders | Vendor sees a blank screen for 4 round-trips. |
| `src/app/admin/maintenance/page.tsx` | Triple refetch on every ticket update: `submitUpdate()` → `fetchLogs()` → `fetchData()` | 3 API calls per single status change. |
| `src/hooks/useFinancials.ts` | Fetches `view_profit_and_loss` with `SELECT *`, then deduplicates in JS using a `Map` | Database could do this with `GROUP BY` in milliseconds. |
| `src/hooks/useDistributions.ts` | Client-side aggregation via `Map` instead of SQL `GROUP BY + SUM` | Same pattern as useFinancials — unnecessary memory/CPU pressure. |

**Zero pagination across the entire app:** No hook or page implements cursor-based or offset pagination. `useApplications` fetches ALL applications. `useMaintenance` fetches ALL work orders. At scale (1000+ records), these become performance cliffs.

#### Risk 3: Edge Function Fragility — No Rate Limiting, Idempotency Gaps, Runaway AI Costs

**Severity:** HIGH
**Impact:** Financial data corruption, uncontrolled API spend, denial-of-service vectors.

| Function | Issue |
|----------|-------|
| `apply-late-fees` | **Not idempotent.** Multiple invocations apply duplicate $50 fees. Grace period logic checks day-of-month instead of days-past-due — broken for edge cases. No role check beyond JWT validity. |
| `provision-user` | Creates auth user but **never inserts a `profiles` row**. Downstream functions (middleware, edge functions) expect `profiles` to exist — this causes cascading failures. |
| `analyze-lease` | Sends full lease PDFs (containing tenant PII) to Google Gemini API with no cost ceiling. No rate limiting — a script could trigger hundreds of $1+ AI calls. |
| `tenant-assistant` | Creates work orders from chat with no rate limiting. A tenant could spam hundreds of maintenance tickets. Lease query uses wrong field (`user_id` vs `tenant_id`), returning no results. |
| `calculate-distribution` | Uses hardcoded `$5,000` income instead of actual rent collected. Results are fictional. |
| `list-users` | Dumps entire auth user database (emails, metadata) with no pagination. |

**Cross-cutting gap:** Zero edge functions implement rate limiting. No request throttling exists anywhere in the stack.

---

### Secondary Findings

#### Error Handling Gaps

| Hook | Bug |
|------|-----|
| `useFinancials.ts` | `Promise.all()` fetches P&L and expenses. Only P&L error is checked — expenses error is silently swallowed. |
| `useMaintenance.ts` | Same pattern — vendor query error never checked. |
| `useReconciliation.ts` | Statistics (total, reconciled, pending, flagged) calculated from a hardcoded 50-item limit, not the full dataset. Dashboard shows false metrics. |

#### CORS Configuration (`supabase/functions/_shared/cors.ts`)

- Localhost origins (`http://localhost:3000`, `3001`) included in production CORS whitelist.
- Direct Supabase project URL exposed as allowed origin — enables direct API calls from any page that can inject this origin header.

#### Logging (`src/lib/logger.ts`)

- Console-only logging. No persistent audit trail. No error tracking integration (Sentry/LogRocket mentioned in TODOs but unimplemented).
- Financial operations (late fees, distributions, ledger commits) leave no searchable log outside `system_activity`.

#### Document Storage

- Client-side image compression (`browser-image-compression`) reduces uploads to ~0.8 MB. Good.
- No server-side MIME validation — client checks MIME type but this is spoofable.
- No virus/malware scanning on uploaded files.
- Generated PDFs (leases, statements) are not cached — every download re-invokes the edge function.

---

## 2. Performance Wins

### Priority 1: Eliminate Waterfall Fetching (Estimated Impact: 40-60% faster page loads)

#### 2.1 — Parallelize Tenant Portal Load
**File:** `src/app/portal/page.tsx` (lines 40-149)

Current: 5 sequential calls creating a deep waterfall.
Proposed: Reduce to 2 sequential steps.

```
BEFORE: auth → lease → payments → tickets → notifications  (5 round-trips)
AFTER:  auth → lease → Promise.all([payments, tickets, notifications])  (3 round-trips)
```

Better yet, consolidate into a single RPC. The `get_tenant_portal_data()` function already exists and returns most of this data — use it exclusively and add `notifications` to its return shape.

#### 2.2 — Parallelize Vendor Portal Load
**File:** `src/app/vendor-portal/page.tsx` (lines 59-115)

```
BEFORE: auth → profile → vendor → work_orders  (4 round-trips)
AFTER:  auth → Promise.all([profile, vendor]) → work_orders  (3 round-trips)
```

#### 2.3 — Parallelize Property Detail
**File:** `src/app/admin/properties/[id]/page.tsx` (lines 22-45)

```
BEFORE: property → units  (2 sequential, but independent)
AFTER:  Promise.all([property, units])  (1 round-trip)
```

Also: remove `supabase` from the `useEffect` dependency array (line 52) — it is a stable singleton reference and triggers unnecessary refetches.

#### 2.4 — Replace Triple Refetch on Maintenance Update
**File:** `src/app/admin/maintenance/page.tsx` (lines 189-191)

```
BEFORE: submitUpdate() → fetchLogs() → fetchData()  (3 sequential calls per update)
AFTER:  submitUpdate() → Promise.all([fetchLogs(), fetchData()])  (2 calls)
BEST:   Optimistic update + single background invalidation via React Query
```

### Priority 2: Move Aggregations to SQL (Estimated Impact: 80% reduction in client-side computation)

#### 2.5 — Fix useProperties Revenue Calculation
**File:** `src/hooks/useProperties.ts` (lines 32-51)

Current: Fetches ALL active leases, then loops per-property with `.filter().reduce()`.
Proposed: Create a SQL view or modify `view_profit_and_loss` to include per-property revenue. Then join directly in the properties query.

```sql
-- New view: property_revenue_summary
SELECT p.id AS property_id, COALESCE(SUM(l.rent_amount), 0) AS monthly_revenue
FROM properties p
LEFT JOIN units u ON u.property_id = p.id
LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'Active'
GROUP BY p.id;
```

#### 2.6 — Fix useFinancials Deduplication
**File:** `src/hooks/useFinancials.ts` (lines 54-80)

Current: Fetches `view_profit_and_loss` with `SELECT *`, deduplicates via `Map` in JavaScript.
Proposed: The view itself should `GROUP BY property_id` — this is a schema fix, not a frontend fix.

#### 2.7 — Fix useDistributions Client-Side Aggregation
**File:** `src/hooks/useDistributions.ts` (lines 38-47)

Same pattern as useFinancials — move `Map`-based aggregation into the SQL view.

### Priority 3: Add Pagination (Estimated Impact: Prevents performance cliff at scale)

These hooks fetch unbounded datasets. Add cursor-based pagination:

| Hook | Current | Proposed |
|------|---------|----------|
| `useApplications.ts` | `SELECT *` — all applications | Add `.range(offset, offset + PAGE_SIZE)` with scroll-based loading |
| `useMaintenance.ts` (in page) | All work orders, no limit | Paginate with `.range()` + status filter |
| `useReconciliation.ts` | Hardcoded `.limit(50)` | Replace with proper pagination; compute stats via `COUNT()` RPC |
| `useProperties.ts` | All properties, no limit | Add pagination for portfolios with 50+ properties |
| `useVendors.ts` | `SELECT *` — all columns, all rows | Explicit column list + pagination |

### Priority 4: Bundle Optimization

#### 2.8 — Lazy Load Heavy Libraries
**Files:** Finance pages importing Recharts, Portfolio Map importing Mapbox GL.

```tsx
// Instead of:
import { RevenueChart } from '@/components/RevenueChart'

// Use:
const RevenueChart = React.lazy(() => import('@/components/RevenueChart'))
```

Apply to: `RevenueChart` (Recharts), `NodeMap` (Mapbox GL), `TenantAI` (speech recognition).

#### 2.9 — Parallelize GlobalSearchBar Queries
**File:** `src/components/GlobalSearchBar.tsx` (lines 37-105)

Current: 3 sequential queries (tenants, units, work_orders).
Proposed: Wrap in `Promise.all()` — or better, use the existing `search_global()` RPC which does a single `UNION` query.

### Priority 5: Fix Missing Error Handling

| File | Fix |
|------|-----|
| `src/hooks/useFinancials.ts` | Add `if (expensesRes.error) throw expensesRes.error` after `Promise.all` |
| `src/hooks/useMaintenance.ts` | Add `if (vendorRes.error) throw vendorRes.error` after `Promise.all` |
| `src/hooks/useReconciliation.ts` | Compute stats from `COUNT()` RPC, not from the limited 50-item client array |

---

## 3. The AI Roadmap

### Philosophy

The "Golden Triangle" in property management is the interaction loop between **Tenants** (who report issues and pay rent), **Managers** (who orchestrate operations and finances), and **Vendors** (who execute repairs and maintenance). Every manual handoff in this triangle is a source of delay, miscommunication, and cost leakage.

The following 3 AI features target the highest-friction handoffs in this triangle. They are not chatbots — they are workflow automation systems that use AI as a decision engine.

---

### Feature 1: Smart Maintenance Triage & Auto-Dispatch

**The Problem:**
A tenant submits "water is leaking from the ceiling." Today, a manager must manually read the ticket, assess severity, look up which vendor handles plumbing, check if the vendor is available, and dispatch. This takes 2-24 hours. If it is a burst pipe, every hour of delay causes $1,000+ in water damage.

**User Story:**

```
AS A Tenant, I submit a maintenance request with a photo and description.
  → AI analyzes the photo + text to classify: category (plumbing, electrical, HVAC, etc.),
    severity (routine, urgent, emergency), and estimated cost range.

AS A Manager, I see the AI-triaged ticket in my dashboard with:
  - Auto-classified category and severity
  - Confidence score (so I know when to override)
  - Recommended vendor (matched by trade_type + availability + past performance)
  - If severity = Emergency AND estimated cost < $500: auto-dispatch to vendor immediately
  - If severity = Emergency AND estimated cost >= $500: escalate to manager for approval

AS A Vendor, I receive an auto-dispatched work order with:
  - AI-generated scope of work
  - Photo analysis summary
  - Suggested materials list
  - Approval to proceed (if auto-dispatched)
```

**Technical Implementation:**

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Tenant     │────▶│  Edge Function:   │────▶│  Supabase DB    │
│  (Photo +    │     │  triage-ticket    │     │  work_orders    │
│   Text)      │     │                  │     │  (ai_priority,   │
└─────────────┘     │  1. Vision Model  │     │   category,      │
                    │     (GPT-4o /     │     │   ai_confidence) │
                    │      Gemini)      │     └────────┬────────┘
                    │  2. Cost Estimator│              │
                    │  3. Vendor Matcher│              ▼
                    │  4. Dispatch Logic│     ┌─────────────────┐
                    └──────────────────┘     │  DB Trigger:     │
                                             │  notify-vendor   │
                                             │  (if auto-       │
                                             │   dispatched)    │
                                             └─────────────────┘
```

**Models & Infrastructure:**

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Image Classification | GPT-4o Vision or Gemini 1.5 Pro (multimodal) | Best-in-class for photo understanding. Classifies damage type from a single photo. |
| Text Classification | Claude 3.5 Haiku or GPT-4o Mini | Fast, cheap intent extraction from tenant descriptions. |
| Cost Estimation | Fine-tuned regression model on historical `work_orders.cost` data | Property-specific cost predictions improve over time. Start with simple rules (plumbing avg, electrical avg). |
| Vendor Matching | SQL scoring query | Score vendors by: `trade_type` match + avg completion time + avg cost + current open orders. No ML needed. |
| Auto-Dispatch | Rule engine (not ML) | Configurable thresholds per property: `IF severity = 'Emergency' AND estimated_cost < threshold THEN auto_dispatch`. |

**Database Changes Required:**

```sql
-- Already exists (migration 016):
-- work_orders.category, work_orders.ai_priority, work_orders.ai_confidence

-- New columns needed:
ALTER TABLE work_orders ADD COLUMN ai_estimated_cost numeric;
ALTER TABLE work_orders ADD COLUMN ai_dispatch_status text
  CHECK (ai_dispatch_status IN ('pending_triage', 'triaged', 'auto_dispatched', 'manager_review'));
ALTER TABLE work_orders ADD COLUMN ai_scope_of_work text;

-- New table for vendor performance tracking:
CREATE TABLE vendor_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id),
  avg_completion_days numeric,
  avg_cost numeric,
  reliability_score numeric,  -- 0-100 based on on-time completion
  last_calculated_at timestamptz DEFAULT now()
);

-- Triage configuration per property:
CREATE TABLE triage_config (
  property_id uuid PRIMARY KEY REFERENCES properties(id),
  auto_dispatch_enabled boolean DEFAULT false,
  cost_threshold numeric DEFAULT 500,
  emergency_auto_dispatch boolean DEFAULT true
);
```

**Data Privacy Flags:**

| Data | Classification | Handling |
|------|---------------|----------|
| Tenant photos | PII-adjacent (may contain faces, unit interiors) | Process via API, do not store in AI provider. Delete from AI context after classification. |
| Tenant name/address | PII | Never sent to AI model. Only unit_id and description sent. |
| Work order descriptions | May contain PII | Scrub phone numbers and emails before sending to AI. |

**Existing Foundation:**
Your `tenant-assistant` edge function already creates work orders from chat. Your `work_orders` table already has `ai_priority`, `category`, and `ai_confidence` columns (migration 016). This feature extends what exists rather than building from scratch.

---

### Feature 2: Predictive Lease Intelligence — Churn Prevention & Revenue Optimization

**The Problem:**
Lease renewals are the single highest-leverage financial event in property management. A tenant who doesn't renew costs $3,000-$8,000 (vacancy loss + turnover + marketing). Today, managers discover non-renewals reactively — often when the tenant gives 30-day notice. By then, it is too late to intervene.

**User Story:**

```
AS A Manager, I open the Lease Intelligence dashboard and see:
  - Every lease expiring in the next 90 days, ranked by churn risk (0-100 score)
  - For high-risk tenants: AI-generated explanation of risk factors
    (e.g., "3 unresolved maintenance tickets, rent increased 12% last renewal,
     2 late payments in past 6 months")
  - Recommended retention action per tenant:
    - "Offer $50/mo discount (projected ROI: $4,200 vs vacancy cost)"
    - "Prioritize open maintenance tickets before renewal conversation"
    - "Schedule in-person walkthrough — tenant submitted 5 complaints this quarter"

AS A Manager, I click "Generate Renewal Offer" on a high-risk tenant:
  → AI drafts a personalized renewal letter with recommended terms
  → Includes market-rate comparison for the unit
  → Tracks whether the offer was sent, opened, and accepted

AS A Tenant, I receive a renewal offer that acknowledges my concerns:
  → "We've addressed the HVAC issue you reported, and we'd like to offer
     you renewal at [competitive rate] with [incentive]."
```

**Technical Implementation:**

```
┌──────────────────────────────────────────────────────────┐
│                  Nightly Batch Job (Cron)                  │
│                                                          │
│  1. Query all leases expiring in 90 days                 │
│  2. For each lease, compute feature vector:              │
│     - payment_history (late_count, avg_days_late)        │
│     - maintenance_history (open_tickets, resolved_ratio) │
│     - rent_delta (current vs market rate)                │
│     - tenure_months                                      │
│     - communication_frequency                            │
│  3. Score via ML model → churn_probability (0-100)       │
│  4. Store scores in lease_renewal_scores table           │
│  5. Generate explanations via LLM for high-risk (>60)    │
└──────────────────────────────────────────────────────────┘
```

**Models & Infrastructure:**

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Churn Scoring | Gradient Boosted Trees (XGBoost) or Logistic Regression | Tabular data with clear features. Start with logistic regression for interpretability; graduate to XGBoost when you have 500+ historical lease outcomes. |
| Feature Engineering | SQL materialized view | All features derivable from existing tables: `accounting` (payment history), `work_orders` (maintenance), `leases` (tenure, rent). |
| Explanation Generation | Claude 3.5 Sonnet | Given the feature vector and score, generate human-readable explanation. Cheap per call (~$0.003). |
| Renewal Offer Drafting | Claude 3.5 Sonnet | Generate personalized renewal letter with market comparison data injected as context. |
| Market Rate Comparison | Supabase function | Compare `unit.market_rent` vs `lease.rent_amount` vs average rent for similar units in the property. |

**Database Changes Required:**

```sql
-- Renewal scoring results (may already partially exist via useRenewalScores hook):
CREATE TABLE IF NOT EXISTS lease_renewal_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid REFERENCES leases(id) ON DELETE CASCADE,
  churn_score numeric NOT NULL,  -- 0-100
  risk_level text CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  factors jsonb,  -- { "late_payments": 3, "open_tickets": 2, "rent_vs_market": 1.12 }
  ai_explanation text,
  recommended_action text,
  scored_at timestamptz DEFAULT now(),
  UNIQUE(lease_id)
);

-- Renewal offers tracking:
CREATE TABLE renewal_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid REFERENCES leases(id) ON DELETE CASCADE,
  offered_rent numeric,
  incentive_description text,
  offer_letter_url text,  -- Supabase Storage path
  status text CHECK (status IN ('draft', 'sent', 'opened', 'accepted', 'declined', 'expired')),
  created_at timestamptz DEFAULT now(),
  responded_at timestamptz
);

-- Materialized view for feature engineering:
CREATE MATERIALIZED VIEW lease_churn_features AS
SELECT
  l.id AS lease_id,
  l.tenant_id,
  l.rent_amount,
  l.end_date,
  u.market_rent,
  EXTRACT(MONTH FROM AGE(now(), l.start_date)) AS tenure_months,
  COALESCE(pay.late_count, 0) AS late_payment_count,
  COALESCE(pay.avg_days_late, 0) AS avg_days_late,
  COALESCE(wo.open_count, 0) AS open_ticket_count,
  COALESCE(wo.total_count, 0) AS total_ticket_count,
  CASE WHEN u.market_rent > 0
    THEN l.rent_amount / u.market_rent
    ELSE 1.0
  END AS rent_to_market_ratio
FROM leases l
JOIN units u ON l.unit_id = u.id
LEFT JOIN (
  SELECT lease_id,
    COUNT(*) FILTER (WHERE date > (date + interval '5 days')) AS late_count,
    AVG(EXTRACT(DAY FROM (created_at::date - date))) AS avg_days_late
  FROM accounting WHERE type = 'Payment'
  GROUP BY lease_id
) pay ON pay.lease_id = l.id
LEFT JOIN (
  SELECT tenant_id,
    COUNT(*) FILTER (WHERE status IN ('Open', 'In Progress')) AS open_count,
    COUNT(*) AS total_count
  FROM work_orders
  GROUP BY tenant_id
) wo ON wo.tenant_id = l.tenant_id
WHERE l.status = 'Active' AND l.end_date IS NOT NULL;
```

**Data Privacy Flags:**

| Data | Classification | Handling |
|------|---------------|----------|
| Payment history | Financial PII | Never sent to external AI. Scoring model runs locally or via Supabase edge function. Only the computed score is stored. |
| Tenant name | PII | Included in renewal offers (necessary for personalization). Stored in Supabase with existing RLS. |
| Churn score | Sensitive internal | Visible to Admin/PM only. Never exposed to tenants. RLS policy required. |
| Feature vectors | Derived PII | Stored as JSONB in `lease_renewal_scores.factors`. Admin-only access. |

**Existing Foundation:**
Your `useRenewalScores` hook and `/admin/audit/lease-intelligence` page already exist. The `analyze-lease` edge function uses Gemini for PDF analysis. This feature replaces the current scoring with a data-driven model.

---

### Feature 3: Autonomous Accounts Receivable Agent — From Invoice to Collection

**The Problem:**
The accounts receivable cycle (charge rent → track payment → send reminder → apply late fee → escalate) is almost entirely manual today. Your `post_monthly_rent()` RPC charges rent, but everything after that — tracking who paid, sending reminders, applying late fees, flagging delinquencies — requires a manager to manually check dashboards and take action. This is the #1 time sink for property managers.

**User Story:**

```
AS THE SYSTEM, on the 1st of each month:
  → Auto-post rent charges for all active leases (existing RPC)
  → Start monitoring each lease for payment

AS THE SYSTEM, on day 3 (no payment received):
  → Send friendly reminder to tenant via email/SMS
  → "Hi [first_name], your rent of $[amount] for [unit] is due. Pay online at [portal_link]."

AS THE SYSTEM, on day 5 (grace period expired, still unpaid):
  → Send formal past-due notice
  → Notify property manager: "[tenant] at [unit] is past due. Balance: $[amount]."

AS THE SYSTEM, on day 6 (past grace period):
  → Apply late fee ($50 or configured amount) — idempotently
  → Create journal entry with proper double-entry accounting
  → Send late fee notice to tenant with updated balance

AS A Manager, I see a live AR dashboard:
  → Collection rate: 94% (target: 97%)
  → Past due: 12 tenants totaling $18,400
  → AI-recommended actions per tenant:
    - "Set up payment plan — tenant has partial payment history"
    - "Escalate to legal — 60+ days delinquent, no communication"
    - "Waive late fee — first offense, otherwise excellent tenant"
  → One-click to approve AI recommendations

AS A Tenant, I receive contextual, timely communications:
  → Day 1: "Rent posted — $1,200 due by the 5th"
  → Day 3: "Friendly reminder — payment due in 2 days"
  → Day 6: "Past due notice — $50 late fee applied. Total balance: $1,250"
  → Day 15: "Let's work together — reply to set up a payment plan"
```

**Technical Implementation:**

```
┌─────────────────────────────────────────────────────────────┐
│              Supabase Cron (pg_cron extension)               │
│                                                             │
│  Day 1:  post_monthly_rent()                                │
│  Day 3:  ar_agent_check() → Send reminders                  │
│  Day 5:  ar_agent_check() → Send past-due + notify manager  │
│  Day 6:  ar_agent_check() → Apply late fees (idempotent)    │
│  Day 15: ar_agent_check() → AI generates escalation plan    │
│  Day 30: ar_agent_check() → Flag for legal review           │
│                                                             │
│  Each step checks: "Has tenant paid since last action?"      │
│  If yes: Stop the sequence. Log resolution.                  │
│  If no:  Advance to next step.                               │
└─────────────────────────────────────────────────────────────┘

         ┌──────────────┐
         │  Edge Func:  │──── Resend / Twilio (email/SMS)
         │  ar-agent    │──── Supabase DB (late fees, journal entries)
         │              │──── Claude API (escalation recommendations)
         └──────────────┘
```

**Models & Infrastructure:**

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Scheduling | `pg_cron` (Supabase extension) | Runs inside the database. No external scheduler needed. Reliable, transactional. |
| Payment Tracking | SQL query on `accounting` table | Check if `SUM(payments) >= SUM(charges)` for each lease in the current month. |
| Reminder Delivery | Resend (email) + Twilio (SMS) | Both have Supabase edge function SDKs. Resend is cheaper for email; Twilio for SMS. |
| Late Fee Application | Enhanced `post_late_fee()` RPC | Add idempotency key: `UNIQUE(lease_id, billing_month, billing_year, type='Late Fee')`. |
| Escalation Recommendations | Claude 3.5 Haiku | Given tenant payment history + tenure + communication log, recommend action. ~$0.001 per tenant. |
| AR Dashboard | New Supabase view + existing `useFinancials` pattern | Real-time collection metrics. |

**Database Changes Required:**

```sql
-- AR automation state machine:
CREATE TABLE ar_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid REFERENCES leases(id) ON DELETE CASCADE,
  billing_month integer NOT NULL,
  billing_year integer NOT NULL,
  step text NOT NULL CHECK (step IN (
    'rent_posted', 'reminder_sent', 'past_due_sent',
    'late_fee_applied', 'escalation_sent', 'legal_flagged', 'resolved'
  )),
  executed_at timestamptz DEFAULT now(),
  delivery_method text,  -- 'email', 'sms', 'both'
  delivery_status text,  -- 'sent', 'delivered', 'failed', 'bounced'
  notes text,
  UNIQUE(lease_id, billing_month, billing_year, step)  -- Idempotency
);

-- AR dashboard view:
CREATE VIEW ar_dashboard AS
SELECT
  l.id AS lease_id,
  t.first_name || ' ' || t.last_name AS tenant_name,
  p.name AS property_name,
  u.name AS unit_name,
  l.rent_amount,
  COALESCE(charges.total, 0) AS total_charges,
  COALESCE(payments.total, 0) AS total_payments,
  COALESCE(charges.total, 0) - COALESCE(payments.total, 0) AS balance_due,
  latest_action.step AS current_step,
  latest_action.executed_at AS last_action_at,
  EXTRACT(DAY FROM now() - date_trunc('month', now())) AS day_of_month
FROM leases l
JOIN tenants t ON l.tenant_id = t.id
JOIN units u ON l.unit_id = u.id
JOIN properties p ON u.property_id = p.id
LEFT JOIN (
  SELECT lease_id, SUM(amount) AS total
  FROM accounting
  WHERE type IN ('Rent Charge', 'Late Fee')
    AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM now())
    AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM now())
  GROUP BY lease_id
) charges ON charges.lease_id = l.id
LEFT JOIN (
  SELECT lease_id, SUM(amount) AS total
  FROM accounting
  WHERE type = 'Payment'
    AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM now())
    AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM now())
  GROUP BY lease_id
) payments ON payments.lease_id = l.id
LEFT JOIN LATERAL (
  SELECT step, executed_at
  FROM ar_actions
  WHERE ar_actions.lease_id = l.id
    AND billing_month = EXTRACT(MONTH FROM now())
    AND billing_year = EXTRACT(YEAR FROM now())
  ORDER BY executed_at DESC
  LIMIT 1
) latest_action ON true
WHERE l.status = 'Active';

-- Fix existing late fee idempotency:
ALTER TABLE accounting ADD CONSTRAINT accounting_late_fee_unique
  UNIQUE (lease_id, type, date)
  WHERE (type = 'Late Fee');

-- Notification preferences (tenant opt-in):
CREATE TABLE notification_preferences (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  email_enabled boolean DEFAULT true,
  sms_enabled boolean DEFAULT false,
  phone_number text,
  preferred_language text DEFAULT 'en'
);
```

**Data Privacy Flags:**

| Data | Classification | Handling |
|------|---------------|----------|
| Tenant email/phone | PII | Stored in `tenants` table (existing). Sent to Resend/Twilio for delivery only. Never sent to AI models. |
| Payment amounts | Financial PII | Never leaves Supabase. AI receives only "days past due" and "payment pattern" (e.g., "usually pays by day 8"), not dollar amounts. |
| Collection recommendations | Sensitive internal | Generated by AI, reviewed by manager before execution. Stored in `ar_actions.notes`. Admin-only RLS. |
| Communication content | May contain PII | Templates use variables (`{first_name}`, `{amount}`). Template text stored in `ar_actions`. Tenant can request communication log (CCPA compliance). |

**Existing Foundation:**
Your `post_monthly_rent()` RPC, `post_late_fee()` RPC, `get_delinquent_tenants()` RPC, and `notify-tenant` edge function are all building blocks. The `apply-late-fees` edge function needs idempotency fixes (documented in Risk 3) before plugging into this workflow.

---

### AI Feature Comparison Matrix

| Dimension | Smart Triage | Lease Intelligence | AR Agent |
|-----------|-------------|-------------------|----------|
| **Primary User** | Tenant → Manager → Vendor | Manager | Manager → Tenant |
| **AI Type** | Vision + NLP classification | Predictive ML + generative text | Rule engine + generative recommendations |
| **LLM Dependency** | High (vision model per ticket) | Medium (explanations only) | Low (escalation recommendations only) |
| **Monthly AI Cost (est. 200 units)** | $15-40/mo | $5-10/mo | $2-5/mo |
| **Implementation Complexity** | Medium | High (requires historical data) | Medium |
| **Time to Value** | Immediate (first ticket triaged) | 3-6 months (needs training data) | Immediate (first rent cycle) |
| **Existing Code Leverage** | `tenant-assistant`, `work_orders.ai_*` columns | `useRenewalScores`, `analyze-lease` | `post_monthly_rent`, `post_late_fee`, `notify-tenant` |
| **Revenue Impact** | Cost reduction (faster response → less damage) | Revenue protection ($3K-8K per retained tenant) | Cash flow acceleration (faster collections) |

### Recommended Implementation Order

```
Phase 1 (Weeks 1-4):   AR Agent
  → Highest ROI. Uses existing RPCs. Fixes the late-fee idempotency bug.
  → Delivers value on the first rent cycle.

Phase 2 (Weeks 5-8):   Smart Maintenance Triage
  → Extends existing AI columns and tenant-assistant.
  → Requires vision model integration (1-2 week spike).

Phase 3 (Weeks 9-16):  Lease Intelligence
  → Requires 3-6 months of payment/maintenance data for meaningful scoring.
  → Start data collection in Phase 1, build model in Phase 3.
```

---

## Appendix A: Repo Map

```
rylexa-dashboard/
├── src/
│   ├── middleware.ts                    # Auth + RBAC enforcement
│   ├── app/
│   │   ├── layout.tsx                   # Root layout (Toaster, QueryProvider)
│   │   ├── page.tsx                     # Homepage redirect
│   │   ├── (public)/
│   │   │   ├── login/page.tsx
│   │   │   └── apply/page.tsx           # Public rental application
│   │   ├── admin/
│   │   │   ├── layout.tsx               # Admin shell (sidebar)
│   │   │   ├── page.tsx                 # Dashboard
│   │   │   ├── properties/
│   │   │   │   ├── page.tsx             # Portfolio list
│   │   │   │   └── [id]/page.tsx        # Property detail
│   │   │   ├── leases/page.tsx
│   │   │   ├── tenants/page.tsx
│   │   │   ├── maintenance/page.tsx
│   │   │   ├── vendors/page.tsx
│   │   │   ├── applications/page.tsx
│   │   │   ├── approvals/page.tsx
│   │   │   ├── audit/
│   │   │   │   ├── page.tsx
│   │   │   │   └── lease-intelligence/page.tsx
│   │   │   ├── finance/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── distributions/page.tsx
│   │   │   │   ├── reconcile/page.tsx
│   │   │   │   ├── payroll/page.tsx
│   │   │   │   ├── statements/page.tsx
│   │   │   │   └── billing/page.tsx
│   │   │   ├── analytics/
│   │   │   │   ├── scorecard/page.tsx
│   │   │   │   └── vacancy/page.tsx
│   │   │   ├── inspections/
│   │   │   │   ├── page.tsx
│   │   │   │   └── review/page.tsx
│   │   │   ├── onboarding/page.tsx
│   │   │   ├── portfolio-map/page.tsx
│   │   │   ├── chat/page.tsx
│   │   │   ├── notifications/page.tsx
│   │   │   ├── settlements/page.tsx
│   │   │   ├── payroll/page.tsx
│   │   │   └── settings/
│   │   │       ├── page.tsx
│   │   │       ├── assignments/page.tsx
│   │   │       └── users/page.tsx
│   │   ├── portal/
│   │   │   ├── page.tsx                 # Tenant dashboard
│   │   │   ├── maintenance/page.tsx
│   │   │   └── statements/page.tsx
│   │   └── vendor-portal/
│   │       ├── page.tsx                 # Vendor dashboard
│   │       └── log-work/page.tsx
│   ├── actions/
│   │   ├── application-actions.ts
│   │   ├── create-user.ts
│   │   ├── maintenance-actions.ts
│   │   ├── manage-user.ts
│   │   └── vendor-actions.ts
│   ├── hooks/
│   │   ├── useApplications.ts
│   │   ├── useDistributions.ts
│   │   ├── useFeatureFlags.ts
│   │   ├── useFinancials.ts
│   │   ├── useLeases.ts
│   │   ├── useMaintenance.ts
│   │   ├── usePayroll.ts
│   │   ├── useProperties.ts
│   │   ├── useReconciliation.ts
│   │   ├── useRenewalScores.ts
│   │   ├── useTenantLedger.ts
│   │   ├── useTenants.ts
│   │   └── useVendors.ts
│   ├── components/
│   │   ├── ActivityFeed.tsx
│   │   ├── AdminSidebar.tsx
│   │   ├── AssignVendorModal.tsx
│   │   ├── EditLeaseModal.tsx
│   │   ├── EndLeaseModal.tsx
│   │   ├── GenerateStatementModal.tsx
│   │   ├── GlobalSearchBar.tsx
│   │   ├── MaintenanceTicketModal.tsx
│   │   ├── MoveLeaseModal.tsx
│   │   ├── NewLeaseModal.tsx
│   │   ├── NodeMap.tsx
│   │   ├── PostRentModal.tsx
│   │   ├── QueryProvider.tsx
│   │   ├── ReconciliationDrawer.tsx
│   │   ├── RevenueChart.tsx
│   │   ├── Skeleton.tsx
│   │   ├── TenantAI.tsx
│   │   ├── TenantBuildModal.tsx
│   │   ├── TenantCheck.tsx
│   │   ├── TopBar.tsx
│   │   └── VendorFormModal.tsx
│   ├── lib/
│   │   ├── supabaseClient.ts            # Singleton browser client
│   │   ├── compress-image.ts
│   │   ├── logger.ts
│   │   ├── search.ts
│   │   └── upload-utils.ts
│   └── scripts/
│       └── geocode-assets.mjs
├── supabase/
│   ├── migrations/
│   │   ├── 001_views_tables_rpcs.sql    # Core schema
│   │   ├── 002_chat_messages_and_rpc.sql
│   │   ├── ...
│   │   └── 021_archive_committed_work_orders.sql
│   └── functions/
│       ├── _shared/
│       │   ├── auth.ts
│       │   └── cors.ts
│       ├── analyze-lease/index.ts
│       ├── apply-late-fees/index.ts
│       ├── assign-asset/index.ts
│       ├── calculate-distribution/index.ts
│       ├── generate-lease/index.ts
│       ├── generate-statement/index.ts
│       ├── list-users/index.ts
│       ├── notify-manager/index.ts
│       ├── notify-tenant/index.ts
│       ├── provision-user/index.ts
│       └── tenant-assistant/index.ts
├── package.json
├── next.config.js
├── tsconfig.json
├── tailwind.config.mjs
├── Dockerfile
├── fly.toml
└── *.py (data import scripts)
```

## Appendix B: Database Entity Relationship Summary

```
properties (1) ──── (N) units (1) ──── (N) leases (N) ──── (1) tenants
                         │                    │
                         │                    ├──── (N) accounting
                         │                    └──── (N) transactions
                         │
                         └──── (N) work_orders (N) ──── (1) vendors
                                    │
                                    └──── (N) work_order_updates

profiles (1:1) ──── auth.users
vendors (matched by email) ──── auth.users

gl_accounts ──── (N) ledger_entries (N) ──── (1) journal_entries
```

## Appendix C: RLS Policy Coverage

| Table | Policies | Admin | PM | Maint | Vendor | Tenant | Accounting | Anon |
|-------|----------|-------|----|----|--------|--------|-----------|------|
| profiles | 4 | ALL | R | - | - | R(own) | R(own) | - |
| properties | 5 | RWU | RWU | R | R(assigned) | R(own) | R | - |
| units | 5 | RWU | RWU | R | R(assigned) | R(own) | R | - |
| tenants | 3 | RWU | RWU | R | - | R(self) | - | - |
| leases | 3 | RWU | RWU | R | - | R(own) | R | - |
| work_orders | 7 | RWU | RWU | RU | RU(assigned) | RI(own) | - | - |
| vendors | 3 | RWU | RWU | R | R(self) | - | - | - |
| accounting | 3 | RWU | RWU | - | - | R(own) | R | - |
| transactions | 2 | RWU | RWU | - | R(own) | - | - | - |
| applications | 3 | RWU | RWU | - | - | - | - | I |

**Legend:** R=Read, W=Write(Insert), U=Update, I=Insert only, ALL=Full CRUD
