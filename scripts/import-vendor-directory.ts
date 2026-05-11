/**
 * Vendor Directory Import Script
 *
 * Updates existing vendors and inserts new ones from an AppFolio
 * vendor directory CSV export.
 *
 * - Matches by contact name (Last, First) or company name
 * - Fills missing emails, phones, addresses
 * - Updates trade types, GL accounts, 1099 status
 * - Adds insurance/license expiration dates
 *
 * Usage:
 *   npx tsx scripts/import-vendor-directory.ts                          # dry-run
 *   npx tsx scripts/import-vendor-directory.ts --execute                # apply
 *   npx tsx scripts/import-vendor-directory.ts --file path/to/file.csv  # custom CSV
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
    : path.resolve(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'vendor_directory-20260327.csv')

// ── Helpers ──

function cleanPhone(raw: string): string {
  if (!raw) return ''
  return raw
    .split(',')
    .map(p => p.trim().replace(/^(Office|Mobile|Phone|Home|Fax|Work|Cell):\s*/i, ''))
    .filter(Boolean)
    .join(', ')
}

function parseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null
  const parts = raw.trim().split('/')
  if (parts.length !== 3) return null
  const [m, d, y] = parts
  const year = y.length === 2 ? `20${y}` : y
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
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
  console.log('  VENDOR DIRECTORY IMPORT')
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
  const existingVendors = await fetchAll('vendors', 'id, company_name, contact_name, email, phone')
  console.log(`  Existing vendors: ${existingVendors.length}\n`)

  // Build lookup maps
  // Match by email (most reliable), then by contact_name, then company_name
  const vendorByEmail = new Map<string, any>()
  const vendorByContactName = new Map<string, any>()
  const vendorByCompany = new Map<string, any>()

  for (const v of existingVendors) {
    if (v.email) {
      for (const e of v.email.split(',')) {
        const clean = e.trim().toLowerCase()
        if (clean) vendorByEmail.set(clean, v)
      }
    }
    if (v.contact_name) vendorByContactName.set(v.contact_name.toLowerCase(), v)
    if (v.company_name) vendorByCompany.set(v.company_name.toLowerCase(), v)
  }

  // Filter valid rows (must have a name)
  const validRows = records.filter(r => {
    const name = r['Name']?.trim()
    const company = r['Company Name']?.trim()
    return name || company
  })

  console.log(`  Valid CSV rows: ${validRows.length}\n`)

  let updated = 0
  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  for (let i = 0; i < validRows.length; i++) {
    const r = validRows[i]
    const csvName = r['Name']?.trim() || ''
    const csvCompany = r['Company Name']?.trim() || ''
    const csvEmail = r['Email']?.trim() || ''
    const csvPhone = cleanPhone(r['Phone Numbers'] || '')
    const csvAddress = r['Address']?.trim() || ''
    const csvFirstName = r['First Name']?.trim() || ''
    const csvLastName = r['Last Name']?.trim() || ''

    // Build contact name
    const contactName = csvName || (csvFirstName && csvLastName ? `${csvLastName}, ${csvFirstName}` : csvFirstName || csvLastName)

    // Match existing vendor
    let vendor = csvEmail ? vendorByEmail.get(csvEmail.toLowerCase()) : null
    if (!vendor && contactName) vendor = vendorByContactName.get(contactName.toLowerCase())
    if (!vendor && csvCompany) vendor = vendorByCompany.get(csvCompany.toLowerCase())

    // Parse address into components
    let addressStreet = '', addressCity = '', addressState = '', addressZip = ''
    if (csvAddress) {
      // AppFolio format: "123 Main St City, ST 12345"
      const match = csvAddress.match(/^(.+?)\s+([A-Za-z\s.]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/)
      if (match) {
        addressStreet = match[1]
        addressCity = match[2]
        addressState = match[3]
        addressZip = match[4]
      } else {
        addressStreet = csvAddress
      }
    }

    const vendorData: any = {
      company_name: csvCompany || null,
      contact_name: contactName || null,
      email: csvEmail || null,
      phone: csvPhone || null,
      address: csvAddress || null,
      address_street: addressStreet || null,
      address_city: addressCity || null,
      address_state: addressState || null,
      address_zip: addressZip || null,
      trade_type: r['Vendor Trades']?.trim() || null,
      gl_account: r['Default GL Account']?.trim() || null,
      payment_type: r['Payment Type']?.trim() || null,
      is_1099: r['Send 1099?']?.trim().toLowerCase() === 'yes',
      insurance_exp: parseDate(r['Liability Insurance Expiration'] || '') || null,
    }

    // Don't overwrite existing data with empty values
    if (vendor) {
      const updates: any = {}
      for (const [key, val] of Object.entries(vendorData)) {
        if (val !== null && val !== '') {
          // Only overwrite if DB value is empty/null OR this is a non-destructive update
          const dbVal = (vendor as any)[key]
          if (dbVal === null || dbVal === '' || dbVal === undefined) {
            updates[key] = val
          } else {
            // Always update these fields from CSV (source of truth)
            if (['trade_type', 'gl_account', 'is_1099', 'insurance_exp', 'payment_type', 'address', 'address_street', 'address_city', 'address_state', 'address_zip'].includes(key)) {
              updates[key] = val
            }
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        if (!DRY_RUN) {
          const { error } = await supabase.from('vendors').update(updates).eq('id', vendor.id)
          if (error) {
            errors.push(`Row ${i + 2}: Update error for "${contactName}": ${error.message}`)
            continue
          }
        }
        updated++
      } else {
        skipped++
      }
    } else {
      // INSERT new vendor
      if (!DRY_RUN) {
        const { data, error } = await supabase.from('vendors').insert(vendorData).select('id').single()
        if (error) {
          errors.push(`Row ${i + 2}: Insert error for "${contactName}": ${error.message}`)
          continue
        }
        // Cache the new vendor
        if (csvEmail) vendorByEmail.set(csvEmail.toLowerCase(), { id: data.id, ...vendorData })
        if (contactName) vendorByContactName.set(contactName.toLowerCase(), { id: data.id, ...vendorData })
      }
      inserted++
    }
  }

  if (errors.length > 0) {
    console.log(`\n⚠️  Errors (${errors.length}):`)
    for (const e of errors.slice(0, 20)) console.log(`  ${e}`)
    if (errors.length > 20) console.log(`  ... and ${errors.length - 20} more`)
  }

  console.log('\n═══════════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Rows processed: ${validRows.length}`)
  console.log(`  Vendors updated: ${updated}`)
  console.log(`  Vendors inserted: ${inserted}`)
  console.log(`  Skipped (no changes): ${skipped}`)
  console.log(`  Errors: ${errors.length}`)
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
