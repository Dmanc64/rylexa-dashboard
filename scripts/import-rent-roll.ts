/**
 * Rent Roll Import Script
 *
 * Updates units (sqft, market_rent) and leases (rent_amount, security_deposit)
 * from an AppFolio rent roll CSV export.
 *
 * SAFE: Only UPDATEs existing rows. Never touches tenants, never inserts, never deletes.
 *
 * Usage:
 *   npx tsx scripts/import-rent-roll.ts                          # dry-run (default)
 *   npx tsx scripts/import-rent-roll.ts --execute                # apply changes
 *   npx tsx scripts/import-rent-roll.ts --file path/to/file.csv  # custom CSV path
 */

import { createClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env.local for Next.js projects
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
    : path.resolve(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'rent_roll-20260326.csv')

// ── Types ──
interface RentRollRow {
  Unit: string
  Tenant: string
  Status: string
  Sqft: string
  'Market Rent': string
  Rent: string
  Deposit: string
  'Lease From': string
  'Lease To': string
  'Move-in': string
  'Move-out': string
  'Past Due': string
  'NSF Count': string
  'Late Count': string
  'Lease Expires Month': string
}

interface UpdateSummary {
  unitsUpdated: number
  leasesUpdated: number
  rowsProcessed: number
  rowsSkipped: number
  errors: string[]
  unitChanges: string[]
  leaseChanges: string[]
}

// ── Helpers ──
function parseNumber(val: string): number | null {
  if (!val || val.trim() === '') return null
  const cleaned = val.replace(/,/g, '').trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function parseDate(val: string): string | null {
  if (!val || val.trim() === '') return null
  // MM/DD/YYYY → YYYY-MM-DD
  const parts = val.trim().split('/')
  if (parts.length !== 3) return null
  const [month, day, year] = parts
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function isPropertyHeader(row: RentRollRow): boolean {
  return row.Unit.startsWith('-> ')
}

function isSubtotalRow(row: RentRollRow): boolean {
  // Subtotal rows have "X Units" in Unit column or "% Occupied" in Status
  return /\d+\s+Units?$/i.test(row.Unit) || /Occupied/.test(row.Status)
}

function isBlankRow(row: RentRollRow): boolean {
  return !row.Unit || row.Unit.trim() === ''
}

function extractPropertyName(headerUnit: string): string {
  // "-> Canyon Falls Business Center - 1802 N. Carson St. Carson City, NV 89701"
  // "-> 80 HIGH - JoeDar - 80 High Street Reno, NV 89502"
  // We need to match against DB names like "Canyon Falls Business Center" or "80 HIGH - JoeDar"
  const cleaned = headerUnit.replace(/^->\s*/, '').trim()

  // Try to match against known property names (longest match first)
  // This is populated after loadPropertyCache runs
  if (propertyCache.size > 0) {
    // Sort by length descending to match longest name first
    const names = Array.from(propertyCache.keys()).sort((a, b) => b.length - a.length)
    for (const name of names) {
      if (cleaned.startsWith(name)) {
        return name
      }
    }
  }

  // Fallback: return first segment before " - "
  const parts = cleaned.split(' - ')
  return parts[0].trim()
}

// ── Property/Unit Cache ──
let propertyCache: Map<string, string> = new Map() // name → id
let unitCache: Map<string, { id: string; sqft: number | null; market_rent: number | null }> =
  new Map() // "propertyId:unitName" → unit data

async function loadPropertyCache() {
  const { data, error } = await supabase.from('properties').select('id, name')
  if (error) throw new Error(`Failed to load properties: ${error.message}`)
  for (const p of data || []) {
    propertyCache.set(p.name, p.id)
  }
  console.log(`  Loaded ${propertyCache.size} properties`)
}

async function loadUnitCache() {
  // Paginate to get all units (Supabase default limit is 1000)
  let offset = 0
  const pageSize = 1000
  let total = 0
  while (true) {
    const { data, error } = await supabase
      .from('units')
      .select('id, name, property_id, sqft, market_rent')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Failed to load units: ${error.message}`)
    if (!data || data.length === 0) break
    for (const u of data) {
      const key = `${u.property_id}:${u.name}`
      unitCache.set(key, { id: u.id, sqft: u.sqft, market_rent: u.market_rent })
    }
    total += data.length
    if (data.length < pageSize) break
    offset += pageSize
  }
  console.log(`  Loaded ${unitCache.size} units`)
}

// ── Main ──
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  RENT ROLL IMPORT')
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '⚡ EXECUTE (will update DB)'}`)
  console.log(`  CSV:  ${CSV_PATH}`)
  console.log('═══════════════════════════════════════════════\n')

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV file not found: ${CSV_PATH}`)
    process.exit(1)
  }

  // Load caches
  console.log('Loading database caches...')
  await loadPropertyCache()
  await loadUnitCache()
  console.log()

  // Parse CSV
  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8')
  const rows: RentRollRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  })

  const summary: UpdateSummary = {
    unitsUpdated: 0,
    leasesUpdated: 0,
    rowsProcessed: 0,
    rowsSkipped: 0,
    errors: [],
    unitChanges: [],
    leaseChanges: [],
  }

  let currentPropertyName: string | null = null
  let currentPropertyId: string | null = null

  for (const row of rows) {
    // Track current property from header rows
    if (isPropertyHeader(row)) {
      currentPropertyName = extractPropertyName(row.Unit)
      currentPropertyId = propertyCache.get(currentPropertyName) ?? null
      if (!currentPropertyId) {
        summary.errors.push(`Property not found in DB: "${currentPropertyName}"`)
      }
      continue
    }

    // Skip non-data rows
    if (isBlankRow(row) || isSubtotalRow(row)) {
      summary.rowsSkipped++
      continue
    }

    if (!currentPropertyId || !currentPropertyName) {
      summary.rowsSkipped++
      continue
    }

    summary.rowsProcessed++
    const unitName = row.Unit.trim()
    const unitKey = `${currentPropertyId}:${unitName}`
    const unitData = unitCache.get(unitKey)

    if (!unitData) {
      summary.errors.push(`Unit not found: "${unitName}" in "${currentPropertyName}"`)
      continue
    }

    // ── UPDATE UNIT (sqft, market_rent) ──
    const csvSqft = parseNumber(row.Sqft)
    const csvMarketRent = parseNumber(row['Market Rent'])
    const unitUpdates: Record<string, number> = {}

    if (csvSqft !== null && csvSqft !== unitData.sqft) {
      unitUpdates.sqft = csvSqft
    }
    if (csvMarketRent !== null && csvMarketRent !== Number(unitData.market_rent)) {
      unitUpdates.market_rent = csvMarketRent
    }

    if (Object.keys(unitUpdates).length > 0) {
      const changeDesc = `  UNIT "${unitName}" @ ${currentPropertyName}: ${Object.entries(unitUpdates)
        .map(([k, v]) => `${k}: ${(unitData as any)[k] ?? 'null'} → ${v}`)
        .join(', ')}`
      summary.unitChanges.push(changeDesc)

      if (!DRY_RUN) {
        const { error } = await supabase
          .from('units')
          .update(unitUpdates)
          .eq('id', unitData.id)
        if (error) {
          summary.errors.push(`Failed to update unit "${unitName}": ${error.message}`)
        } else {
          summary.unitsUpdated++
        }
      } else {
        summary.unitsUpdated++
      }
    }

    // ── UPDATE LEASE (rent_amount, security_deposit) ──
    if (row.Status === 'Current' && row.Tenant) {
      const csvRent = parseNumber(row.Rent)
      const csvDeposit = parseNumber(row.Deposit)

      // Find active lease on this unit
      const { data: leases, error: leaseErr } = await supabase
        .from('leases')
        .select('id, rent_amount, security_deposit, end_date')
        .eq('unit_id', unitData.id)
        .eq('status', 'Active')
        .limit(1)

      if (leaseErr) {
        summary.errors.push(`Failed to query lease for unit "${unitName}": ${leaseErr.message}`)
        continue
      }

      if (!leases || leases.length === 0) {
        summary.errors.push(`No active lease found for unit "${unitName}" (tenant: ${row.Tenant})`)
        continue
      }

      const lease = leases[0]
      const leaseUpdates: Record<string, number | string | null> = {}

      if (csvRent !== null && csvRent !== Number(lease.rent_amount)) {
        leaseUpdates.rent_amount = csvRent
      }
      if (csvDeposit !== null && csvDeposit !== Number(lease.security_deposit)) {
        leaseUpdates.security_deposit = csvDeposit
      }

      // Only update end_date if DB already has one (preserve null = MTM)
      const csvEndDate = parseDate(row['Lease To'])
      const isMonthToMonth = row['Lease Expires Month'] === 'Month-To-Month'
      if (!isMonthToMonth && csvEndDate && lease.end_date && csvEndDate !== lease.end_date) {
        leaseUpdates.end_date = csvEndDate
      }

      if (Object.keys(leaseUpdates).length > 0) {
        const changeDesc = `  LEASE unit "${unitName}" (${row.Tenant}): ${Object.entries(leaseUpdates)
          .map(([k, v]) => `${k}: ${(lease as any)[k] ?? 'null'} → ${v}`)
          .join(', ')}`
        summary.leaseChanges.push(changeDesc)

        if (!DRY_RUN) {
          const { error } = await supabase
            .from('leases')
            .update(leaseUpdates)
            .eq('id', lease.id)
          if (error) {
            summary.errors.push(`Failed to update lease for "${unitName}": ${error.message}`)
          } else {
            summary.leasesUpdated++
          }
        } else {
          summary.leasesUpdated++
        }
      }
    }
  }

  // ── Print Results ──
  console.log('═══════════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('═══════════════════════════════════════════════\n')

  if (summary.unitChanges.length > 0) {
    console.log(`📦 Unit Updates (${summary.unitChanges.length}):`)
    for (const c of summary.unitChanges) console.log(c)
    console.log()
  }

  if (summary.leaseChanges.length > 0) {
    console.log(`📋 Lease Updates (${summary.leaseChanges.length}):`)
    for (const c of summary.leaseChanges) console.log(c)
    console.log()
  }

  if (summary.errors.length > 0) {
    console.log(`❌ Errors (${summary.errors.length}):`)
    for (const e of summary.errors) console.log(`  ${e}`)
    console.log()
  }

  console.log('─────────────────────────────────────────────')
  console.log(`  Rows processed:  ${summary.rowsProcessed}`)
  console.log(`  Rows skipped:    ${summary.rowsSkipped}`)
  console.log(`  Units updated:   ${summary.unitsUpdated}`)
  console.log(`  Leases updated:  ${summary.leasesUpdated}`)
  console.log(`  Errors:          ${summary.errors.length}`)
  console.log('─────────────────────────────────────────────')

  if (DRY_RUN) {
    console.log('\n🔍 This was a DRY RUN. No changes were made.')
    console.log('   Run with --execute to apply these changes.\n')
  } else {
    console.log('\n✅ Changes applied successfully.\n')
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
