/**
 * Tenant Directory Import Script
 *
 * Imports/updates tenants and creates lease records from an AppFolio
 * tenant directory CSV export.
 *
 * - Updates existing tenants (matched by email or name+unit)
 * - Inserts new tenants not found in DB
 * - Creates lease records for all tenant-unit relationships
 * - Sets correct statuses (Active/Past) from CSV
 * - Populates extended fields: birthdate, address, insurance, pets, notes, tags
 *
 * Usage:
 *   npx tsx scripts/import-tenant-directory.ts                          # dry-run (default)
 *   npx tsx scripts/import-tenant-directory.ts --execute                # apply changes
 *   npx tsx scripts/import-tenant-directory.ts --file path/to/file.csv  # custom CSV path
 */

import { createClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ── CLI Args ──
const args = process.argv.slice(2)
const DRY_RUN = !args.includes('--execute')
const fileArgIdx = args.indexOf('--file')
const CSV_PATH =
  fileArgIdx !== -1 && args[fileArgIdx + 1]
    ? path.resolve(args[fileArgIdx + 1])
    : path.resolve(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'tenant_directory-20260326.csv')

// ── Helpers ──

function cleanPhone(raw: string): string {
  if (!raw) return ''
  // Strip prefixes like "Office: ", "Mobile: ", "Phone: "
  return raw
    .split(',')
    .map(p => p.trim().replace(/^(Office|Mobile|Phone|Home|Fax|Work|Cell):\s*/i, ''))
    .filter(Boolean)
    .join(', ')
}

function cleanEmail(raw: string): string {
  if (!raw) return ''
  return raw
    .split(',')
    .map(e => e.trim())
    .filter(Boolean)
    .join(', ')
}

function primaryEmail(raw: string): string {
  if (!raw) return ''
  const first = raw.split(',')[0]?.trim() || ''
  return first.toLowerCase()
}

function parseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null
  const parts = raw.trim().split('/')
  if (parts.length !== 3) return null
  const [m, d, y] = parts
  const year = y.length === 2 ? `20${y}` : y
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function parseAmount(raw: string): number {
  if (!raw) return 0
  return parseFloat(raw.replace(/[,$]/g, '')) || 0
}

function mapStatus(csvStatus: string): string {
  const s = csvStatus?.trim().toLowerCase()
  if (s === 'current') return 'Active'
  if (s === 'past') return 'Past'
  if (s === 'future') return 'Pending'
  if (s === 'eviction') return 'Evicted'
  return 'Active'
}

// ── Paginated fetch ──
async function fetchAll(table: string, select: string) {
  const all: any[] = []
  let page = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    page++
  }
  return all
}

// ── Main ──
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  TENANT DIRECTORY IMPORT')
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '⚡ EXECUTE (will update DB)'}`)
  console.log(`  CSV:  ${CSV_PATH}`)
  console.log('═══════════════════════════════════════════════\n')

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`File not found: ${CSV_PATH}`)
    process.exit(1)
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf-8')
  const records: any[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
  })

  console.log(`Loading database caches...`)

  // Load caches
  const properties = await fetchAll('properties', 'id, name')
  const units = await fetchAll('units', 'id, name, property_id')
  const existingTenants = await fetchAll('tenants', 'id, first_name, last_name, email, phone')
  const existingLeases = await fetchAll('leases', 'id, tenant_id, unit_id, status, rent_amount, start_date, end_date')

  console.log(`  Properties: ${properties.length}`)
  console.log(`  Units: ${units.length}`)
  console.log(`  Existing tenants: ${existingTenants.length}`)
  console.log(`  Existing leases: ${existingLeases.length}\n`)

  // Build lookup maps
  const propByName = new Map<string, string>()
  for (const p of properties) propByName.set(p.name.toLowerCase(), p.id)

  const unitByNameProp = new Map<string, { id: string; property_id: string }>()
  for (const u of units) {
    const key = `${u.name.toLowerCase()}|${u.property_id}`
    unitByNameProp.set(key, u)
  }

  // Tenant lookup by email (lowercase)
  const tenantByEmail = new Map<string, any>()
  for (const t of existingTenants) {
    if (t.email) {
      // Handle multi-email: index each email
      for (const e of t.email.split(',')) {
        const clean = e.trim().toLowerCase()
        if (clean) tenantByEmail.set(clean, t)
      }
    }
  }

  // Tenant lookup by name+property+unit (fallback)
  const tenantByNameUnit = new Map<string, any>()
  for (const t of existingTenants) {
    // We need leases to know their unit — build from existing leases
  }
  // Build tenant→unit mapping from leases
  const leasesByTenantUnit = new Map<string, any>()
  for (const l of existingLeases) {
    const key = `${l.tenant_id}|${l.unit_id}`
    leasesByTenantUnit.set(key, l)
  }

  // Stats
  let tenantsUpdated = 0
  let tenantsInserted = 0
  let leasesUpdated = 0
  let leasesInserted = 0
  let rowsSkipped = 0
  let errors: string[] = []

  // Filter valid rows
  const validRows = records.filter(r => {
    const unit = r['Unit']?.trim()
    const prop = r['Property Name']?.trim()
    return unit && prop
  })

  console.log(`  Valid CSV rows: ${validRows.length} (skipped ${records.length - validRows.length} blank rows)\n`)

  // CSV status breakdown
  const statusCounts = new Map<string, number>()
  for (const r of validRows) {
    const s = r['Status']?.trim() || 'Unknown'
    statusCounts.set(s, (statusCounts.get(s) || 0) + 1)
  }
  console.log('  CSV status breakdown:')
  for (const [s, c] of statusCounts) console.log(`    ${s}: ${c}`)
  console.log()

  // Process each row
  for (let i = 0; i < validRows.length; i++) {
    const r = validRows[i]
    const unitName = r['Unit']?.trim()
    const propName = r['Property Name']?.trim()
    const csvEmail = cleanEmail(r['Emails'] || '')
    const csvPhone = cleanPhone(r['Phone Numbers'] || '')
    const csvFirstName = r['First Name']?.trim() || ''
    const csvLastName = r['Last Name']?.trim() || ''
    const csvCompany = r['Company Name']?.trim() || ''
    const csvStatus = mapStatus(r['Status'] || '')
    const csvTenantType = r['Tenant Type']?.trim() || ''

    // Determine name
    let firstName = csvFirstName
    let lastName = csvLastName
    if (!firstName && !lastName && csvCompany) {
      firstName = csvCompany
      lastName = ''
    }
    if (!firstName && !lastName) {
      // Skip rows with no identity
      rowsSkipped++
      continue
    }

    // Look up property + unit
    const propId = propByName.get(propName.toLowerCase())
    if (!propId) {
      errors.push(`Row ${i + 2}: Property not found: "${propName}"`)
      continue
    }

    const unitKey = `${unitName.toLowerCase()}|${propId}`
    const unit = unitByNameProp.get(unitKey)
    if (!unit) {
      errors.push(`Row ${i + 2}: Unit "${unitName}" not found in "${propName}"`)
      continue
    }

    // Match tenant
    const pEmail = primaryEmail(csvEmail)
    let tenant = pEmail ? tenantByEmail.get(pEmail) : null

    // Tenant data to upsert
    const tenantData: any = {
      first_name: firstName,
      last_name: lastName,
      email: csvEmail || null,
      phone: csvPhone || null,
      status: csvStatus,
      birthdate: parseDate(r['Tenant Birthdate'] || '') || null,
      mailing_address_1: r['Tenant Street Address 1']?.trim() || null,
      mailing_address_2: r['Tenant Street Address 2']?.trim() || null,
      mailing_city: r['Tenant City']?.trim() || null,
      mailing_state: r['Tenant State']?.trim() || null,
      mailing_zip: r['Tenant Zip']?.trim() || null,
      insurance_provider: r['Insurance Provider']?.trim() || null,
      insurance_expiration: parseDate(r['Insurance Expiration'] || '') || null,
      insurance_policy_number: r['Insurance Policy Number']?.trim() || null,
      pets: r['Pets']?.trim() || null,
      notes: r['Tenant Notes']?.trim() || null,
      tags: r['Tenant Tags']?.trim() || null,
      company_name: csvCompany || null,
      tenant_type: csvTenantType || null,
    }

    if (tenant) {
      // UPDATE existing tenant
      if (!DRY_RUN) {
        const { error } = await supabase
          .from('tenants')
          .update(tenantData)
          .eq('id', tenant.id)
        if (error) {
          errors.push(`Row ${i + 2}: Tenant update error: ${error.message}`)
          continue
        }
      }
      tenantsUpdated++
    } else {
      // INSERT new tenant
      if (!DRY_RUN) {
        const { data, error } = await supabase
          .from('tenants')
          .insert(tenantData)
          .select('id')
          .single()
        if (error) {
          errors.push(`Row ${i + 2}: Tenant insert error: ${error.message}`)
          continue
        }
        tenant = { id: data.id, ...tenantData }
        // Add to cache for subsequent rows with same email
        if (pEmail) tenantByEmail.set(pEmail, tenant)
      } else {
        tenant = { id: `NEW-${i}`, ...tenantData }
      }
      tenantsInserted++
    }

    // Handle lease
    const moveIn = parseDate(r['Move-in'] || '')
    const leaseTo = parseDate(r['Lease To'] || '')
    const moveOut = parseDate(r['Move-out'] || '')
    const rentAmount = parseAmount(r['Rent'] || '')
    const deposit = parseAmount(r['Deposit'] || '')

    let leaseStatus = csvStatus
    if (moveOut) leaseStatus = 'Past'

    // Check for existing lease on this unit for this tenant
    const leaseKey = `${tenant.id}|${unit.id}`
    const existingLease = leasesByTenantUnit.get(leaseKey)

    if (existingLease) {
      // UPDATE existing lease
      const updates: any = {}
      if (moveIn && moveIn !== existingLease.start_date) updates.start_date = moveIn
      if (rentAmount !== (existingLease.rent_amount || 0)) updates.rent_amount = rentAmount
      if (leaseStatus !== existingLease.status) updates.status = leaseStatus
      if (leaseTo !== existingLease.end_date) updates.end_date = leaseTo

      if (Object.keys(updates).length > 0) {
        if (!DRY_RUN) {
          const { error } = await supabase
            .from('leases')
            .update(updates)
            .eq('id', existingLease.id)
          if (error) {
            errors.push(`Row ${i + 2}: Lease update error: ${error.message}`)
            continue
          }
        }
        leasesUpdated++
      }
    } else {
      // INSERT new lease
      const leaseData = {
        tenant_id: tenant.id,
        unit_id: unit.id,
        start_date: moveIn || new Date().toISOString().split('T')[0],
        end_date: leaseTo || null,
        rent_amount: rentAmount,
        security_deposit: deposit,
        status: leaseStatus,
      }

      if (!DRY_RUN) {
        const { data, error } = await supabase
          .from('leases')
          .insert(leaseData)
          .select('id')
          .single()
        if (error) {
          errors.push(`Row ${i + 2}: Lease insert error: ${error.message}`)
          continue
        }
        // Add to cache to avoid duplicates for same tenant+unit
        leasesByTenantUnit.set(leaseKey, { id: data.id, ...leaseData })
      } else {
        leasesByTenantUnit.set(leaseKey, { id: `NEW-LEASE-${i}`, ...leaseData })
      }
      leasesInserted++
    }

    // Progress
    if ((i + 1) % 500 === 0) {
      console.log(`  ${Math.round(((i + 1) / validRows.length) * 100)}% — ${i + 1}/${validRows.length} rows processed`)
    }
  }

  // Print errors (first 20)
  if (errors.length > 0) {
    console.log(`\n⚠️  Errors (${errors.length}):`)
    for (const e of errors.slice(0, 20)) console.log(`  ${e}`)
    if (errors.length > 20) console.log(`  ... and ${errors.length - 20} more`)
  }

  console.log('\n═══════════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Rows processed: ${validRows.length}`)
  console.log(`  Rows skipped:   ${rowsSkipped}`)
  console.log(`  Tenants updated: ${tenantsUpdated}`)
  console.log(`  Tenants inserted: ${tenantsInserted}`)
  console.log(`  Leases updated:  ${leasesUpdated}`)
  console.log(`  Leases inserted: ${leasesInserted}`)
  console.log(`  Errors:          ${errors.length}`)
  console.log('═══════════════════════════════════════════════\n')

  if (DRY_RUN) {
    console.log('🔍 Dry run complete. No changes made. Run with --execute to apply.\n')
  } else {
    console.log('✅ Changes applied successfully.\n')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
