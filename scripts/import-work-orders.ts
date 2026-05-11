/**
 * Work Order Import Script
 *
 * Imports work orders from an AppFolio work order CSV export.
 *
 * - Matches vendors by name
 * - Links to units and properties
 * - Sets correct statuses (New, Assigned, Completed, etc.)
 * - Imports costs, dates, descriptions
 *
 * Usage:
 *   npx tsx scripts/import-work-orders.ts                          # dry-run
 *   npx tsx scripts/import-work-orders.ts --execute                # apply
 *   npx tsx scripts/import-work-orders.ts --file path/to/file.csv  # custom CSV
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

const args = process.argv.slice(2)
const DRY_RUN = !args.includes('--execute')
const fileArgIdx = args.indexOf('--file')
const CSV_PATH =
  fileArgIdx !== -1 && args[fileArgIdx + 1]
    ? path.resolve(args[fileArgIdx + 1])
    : path.resolve(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'work_order-20260327.csv')

// ── Helpers ──

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
  const s = csvStatus?.trim()
  // Valid DB statuses: Open, Assigned, In Progress, Completed, On Hold, Done, Closed
  if (s === 'New' || s === 'New by AppFolio') return 'Open'
  if (s === 'Assigned') return 'Assigned'
  if (s === 'In Progress') return 'In Progress'
  if (s === 'Scheduled') return 'Assigned'
  if (s === 'Completed' || s === 'Completed No Need To Bill' || s === 'Work Done') return 'Completed'
  if (s === 'On Hold') return 'On Hold'
  if (s === 'Closed') return 'Closed'
  if (s === 'Done') return 'Done'
  return 'Open'
}

function mapPriority(csvPriority: string): string {
  const p = csvPriority?.trim()
  if (p === 'Emergency') return 'Emergency'
  if (p === 'High') return 'High'
  if (p === 'Low') return 'Low'
  return 'Normal'
}

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
  console.log('  WORK ORDER IMPORT')
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

  console.log('Loading database caches...')

  const properties = await fetchAll('properties', 'id, name')
  const units = await fetchAll('units', 'id, name, property_id')
  const vendors = await fetchAll('vendors', 'id, contact_name, company_name')
  const existingWOs = await fetchAll('work_orders', 'id, title, unit_id, created_at')

  console.log(`  Properties: ${properties.length}`)
  console.log(`  Units: ${units.length}`)
  console.log(`  Vendors: ${vendors.length}`)
  console.log(`  Existing work orders: ${existingWOs.length}\n`)

  // Build lookup maps
  const propByName = new Map<string, string>()
  for (const p of properties) propByName.set(p.name.toLowerCase(), p.id)

  const unitByNameProp = new Map<string, string>()
  for (const u of units) {
    const key = `${u.name.toLowerCase()}|${u.property_id}`
    unitByNameProp.set(key, u.id)
  }

  // Vendor lookup by contact_name (AppFolio format: "Last, First")
  const vendorByContactName = new Map<string, string>()
  const vendorByCompany = new Map<string, string>()
  for (const v of vendors) {
    if (v.contact_name) vendorByContactName.set(v.contact_name.toLowerCase(), v.id)
    if (v.company_name) vendorByCompany.set(v.company_name.toLowerCase(), v.id)
  }

  // Filter valid rows — skip header rows (start with "->") and subtotal rows
  const validRows = records.filter(r => {
    const woNum = r['Work Order Number']?.trim()
    const prop = r['Property Name']?.trim()
    const desc = r['Job Description']?.trim()
    // Must have a work order number and not be a header/subtotal row
    return woNum && prop && desc
  })

  console.log(`  Valid CSV rows: ${validRows.length}`)

  // Status breakdown
  const statusCounts = new Map<string, number>()
  for (const r of validRows) {
    const s = r['Status']?.trim() || 'Unknown'
    statusCounts.set(s, (statusCounts.get(s) || 0) + 1)
  }
  console.log('\n  Status breakdown:')
  for (const [s, c] of statusCounts) console.log(`    ${s}: ${c}`)
  console.log()

  let inserted = 0
  let skipped = 0
  const errors: string[] = []
  const vendorMisses = new Set<string>()
  const unitMisses = new Set<string>()

  for (let i = 0; i < validRows.length; i++) {
    const r = validRows[i]
    const woNumber = r['Work Order Number']?.trim()
    const propName = r['Property Name']?.trim()
    const unitName = r['Unit']?.trim()
    const description = r['Job Description']?.trim()
    const instructions = r['Instructions']?.trim()
    const csvStatus = r['Status']?.trim()
    const csvPriority = r['Priority']?.trim()
    const csvVendor = r['Vendor']?.trim()
    const csvCreatedAt = parseDate(r['Created At'] || '')
    const csvCompletedOn = parseDate(r['Completed On'] || '')
    const csvScheduledStart = parseDate(r['Scheduled Start'] || '')
    const csvAmount = parseAmount(r['Amount'] || '')
    const csvWoType = r['Work Order Type']?.trim()
    const csvIssue = r['Work Order Issue']?.trim()

    // Look up property
    const propId = propByName.get(propName.toLowerCase())
    if (!propId) {
      errors.push(`Row ${i + 2}: Property not found: "${propName}"`)
      continue
    }

    // Look up unit (optional — some WOs are property-level)
    let unitId: string | null = null
    if (unitName) {
      const unitKey = `${unitName.toLowerCase()}|${propId}`
      unitId = unitByNameProp.get(unitKey) || null
      if (!unitId) {
        unitMisses.add(`${unitName} @ ${propName}`)
      }
    }

    // Look up vendor (optional)
    let vendorId: string | null = null
    if (csvVendor) {
      vendorId = vendorByContactName.get(csvVendor.toLowerCase()) || null
      if (!vendorId) vendorId = vendorByCompany.get(csvVendor.toLowerCase()) || null
      if (!vendorId) vendorMisses.add(csvVendor)
    }

    // Build title from description (first 100 chars)
    const title = description.length > 100 ? description.substring(0, 97) + '...' : description

    // Build full notes
    const notesParts: string[] = []
    if (instructions) notesParts.push(`Instructions: ${instructions}`)
    if (csvIssue) notesParts.push(`Issue: ${csvIssue}`)
    if (csvWoType) notesParts.push(`Type: ${csvWoType}`)
    if (woNumber) notesParts.push(`AppFolio WO#: ${woNumber}`)
    const notes = notesParts.join('\n')

    const woData: any = {
      unit_id: unitId,
      vendor_id: vendorId,
      title,
      description: description + (instructions ? `\n\n${instructions}` : ''),
      priority: mapPriority(csvPriority),
      status: mapStatus(csvStatus),
      created_at: csvCreatedAt ? `${csvCreatedAt}T00:00:00Z` : new Date().toISOString(),
      completed_at: csvCompletedOn ? `${csvCompletedOn}T00:00:00Z` : null,
      cost: csvAmount || 0,
      notes,
      assigned_vendor: csvVendor || null,
      scheduled_date: csvScheduledStart || null,
      category: csvWoType === 'Resident' ? 'Tenant Request' : csvWoType === 'Internal' ? 'Internal' : null,
    }

    if (!DRY_RUN) {
      const { error } = await supabase.from('work_orders').insert(woData)
      if (error) {
        errors.push(`Row ${i + 2}: Insert error for WO#${woNumber}: ${error.message}`)
        continue
      }
    }
    inserted++
  }

  // Print misses
  if (vendorMisses.size > 0) {
    console.log(`\n📋 Vendor misses (${vendorMisses.size} unique — WO linked by name only):`)
    for (const v of [...vendorMisses].slice(0, 10)) console.log(`    "${v}"`)
    if (vendorMisses.size > 10) console.log(`    ... and ${vendorMisses.size - 10} more`)
  }

  if (unitMisses.size > 0) {
    console.log(`\n📋 Unit misses (${unitMisses.size} unique — WO has no unit link):`)
    for (const u of [...unitMisses].slice(0, 10)) console.log(`    "${u}"`)
    if (unitMisses.size > 10) console.log(`    ... and ${unitMisses.size - 10} more`)
  }

  if (errors.length > 0) {
    console.log(`\n⚠️  Errors (${errors.length}):`)
    for (const e of errors.slice(0, 20)) console.log(`  ${e}`)
    if (errors.length > 20) console.log(`  ... and ${errors.length - 20} more`)
  }

  console.log('\n═══════════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Rows processed:      ${validRows.length}`)
  console.log(`  Work orders inserted: ${inserted}`)
  console.log(`  Skipped:             ${skipped}`)
  console.log(`  Vendor misses:       ${vendorMisses.size}`)
  console.log(`  Unit misses:         ${unitMisses.size}`)
  console.log(`  Errors:              ${errors.length}`)
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
