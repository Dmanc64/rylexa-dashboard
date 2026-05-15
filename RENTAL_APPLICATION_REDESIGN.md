# Rental Application Redesign — Plan & Status

**Started:** 2026-05-11
**Owner:** Dan
**Status:** Phase 1 (schema) in progress

---

## Decisions

| # | Decision | Notes |
|---|---|---|
| 1 | SSN/ITIN: store full, encrypted with `pgcrypto`, **not required** | User may revise storage approach later |
| 2 | Bank accounts: store **bank name + last 4 only** | No full account numbers in DB |
| 3 | Applicant Type values | `Financially Responsible`, `Co-Signer`, `Other Applicant` |
| 4 | Co-applicants | **One application** with a co-applicant section (not separate apps) |
| 5 | Required fields | Per builder's discretion. SSN is explicitly optional. |
| 6 | Form layout | **Multi-step wizard** |
| 7 | Save as draft + resume | **Yes** — magic-link email back to applicant's draft |
| 8 | Existing applications | **Leave as-is** in old flat schema. New apps use new schema. |
| 9 | Build now even if launch is postponed | **Yes** |
| 10 | Co-signers / other applicants | **Get their own portal access** — magic-link to fill their section |

---

## Architecture overview

**One application record** drives the whole flow. Co-applicants are stored as **child records** with their own data + invite token, but the application is approved/denied as a unit.

### Schema (Phase 1)

#### Main `applications` table — additive columns
- Identity: `salutation`, `legal_first_name` (alias of first_name), `middle_name`, `no_middle_name_certified`, `suffix`
- Type: `applicant_type` ∈ {`Financially Responsible`,`Co-Signer`,`Other Applicant`}
- Company: `company_name`, `use_company_as_display_name`
- Dates: `desired_move_in`
- Personal IDs: `ssn_encrypted` (bytea, pgcrypto), `ssn_last4` (display), `gov_id_number_encrypted`, `gov_id_issuing_state`
- Employment: `employer_phone`, `employer_address`, `employer_address_2`, `position_held`, `years_worked`, `supervisor_name`, `supervisor_title`, `supervisor_email`, `monthly_salary`
- Yes/No questions: `q_delinquent_payment`, `q_felony_conviction`, `q_sued_landlord`, `q_water_filled_furniture`, `q_smoker`
- Notes: `notes` (text)
- Draft handling: `draft_token` (uuid for magic-link), `draft_email`, `submitted_at` (NULL = draft)

#### New child tables (1:N)
- `application_phones` — label + number, one app has many
- `application_emails` — primary + alternates
- `application_addresses` — `kind ∈ {current, previous}`, full address fields, dates, monthly payment, landlord info, reason for leaving, occupancy type
- `application_dependents` — name, DOB, relationship
- `application_pets` — name, type/breed, weight, age
- `application_bank_accounts` — bank_name, account_type, last4, balance
- `application_credit_cards` — issuer, balance
- `application_additional_income` — source, monthly amount
- `application_emergency_contacts` — name, address, phone, email, relationship
- `application_coapplicants` — name, email, applicant_type, status, invite_sent_at, portal_token

### Security model

- **All writes via server actions** with service role — anon never touches the DB directly via Supabase JS client.
- **RLS on child tables**: SELECT scoped via the parent application (admin or property_access). INSERT/UPDATE/DELETE: service role only.
- **SSN encryption**: `pgp_sym_encrypt` with a key from env (`APPLICATION_PII_ENCRYPTION_KEY`). Server actions decrypt on demand for authorized roles. Lose the key → lose ability to decrypt (acceptable tradeoff vs. Vault complexity right now).
- **Bank account numbers** — only last 4 stored. Full number never enters DB.

### Form architecture (Phase 3)

**Multi-step wizard** at `/apply` (replaces current single-page form). Approximately 11 steps:

1. **Welcome / Unit selection** — pick vacant unit, see vacant-from date, choose desired move-in
2. **Applicant identity** — salutation, names, suffix, applicant type, company
3. **Contact info** — phones (list), emails (list)
4. **Residential history** — current address (required), add previous addresses (optional, multiple)
5. **Personal info** — DOB, SSN (optional), gov ID
6. **Financial info** — bank accounts (list), credit cards (list)
7. **Income & employment** — employer details, supervisor, salary, additional income (list)
8. **Household** — dependents (list), pets (list)
9. **Emergency contact** — single record
10. **Screening questions** — 5 yes/no
11. **Notes & attachments** — text + drag-drop files
12. **Co-applicants** — list of co-applicants with invitation
13. **Review & submit**

Old `/apply` page remains until new wizard is fully validated, then we deprecate.

---

## Phase plan

| Phase | Deliverables | Status |
|---|---|---|
| **1 — Schema** | Migration 075: column extensions + 10 child tables + RLS<br>Migration 076: pgcrypto setup<br>Migration 077: attachments storage bucket | In progress |
| **2 — Server actions** | `application-actions-v2.ts`: draft save, submit, co-applicant invite, file upload, fetch by token | Not started |
| **3 — Multi-step wizard** | `/apply/page.tsx` rewrite with step components | Not started |
| **4 — Co-applicant portal** | `/apply/co/[token]/page.tsx` — focused subset form for invited co-applicants | Not started |
| **5 — Admin review** | Update `/admin/applications` to surface new fields + child records | Not started |
| **6 — Cleanup** | Deprecate old flat-schema fields once data has migrated; optionally migrate legacy applications | Not started |

---

## Open items / future-Dan notes

- **Encryption key management**: stored in `.env.local` as `APPLICATION_PII_ENCRYPTION_KEY`. If you ever migrate to Supabase Vault, you'll need to re-encrypt all stored SSNs with the new key.
- **Email magic-link expiration**: drafts and co-applicant invites should expire (suggest 30 days). Implement as a check in the server action: `WHERE created_at > now() - interval '30 days'`.
- **Attachments**: planned bucket `application-attachments`. Path convention `{application_id}/{filename}`. Max 10MB per file. Allowed types: PDF, JPG, PNG, DOCX.
- **Application screening integration**: future — integrate with TransUnion SmartMove or similar. The screening columns (`screening_score`, `screening_status`, etc.) are already on the table from earlier work.
- **Validation rules** (front-end):
  - SSN format (XXX-XX-XXXX) or ITIN (9XX-XX-XXXX)
  - Phone format (US-friendly, E.164 backend)
  - DOB not in the future
  - resided_to >= resided_from
  - desired_move_in >= today
  - All-cash applicants OK (no income required if has bank balance > X)
- **Co-applicant flow**:
  1. Primary submits app
  2. System emails each co-applicant with portal_token URL
  3. Co-applicant fills their section, submits
  4. Application not "Complete" until all co-applicants have submitted
  5. Admin reviews and decisions the application as a unit
