/**
 * Chart of Accounts Import Script
 *
 * Imports AppFolio chart of accounts into gl_accounts with parent/child hierarchy.
 * Parses "Sub Account of" column to build parent_id relationships.
 *
 * Usage:
 *   npx tsx scripts/import-chart-of-accounts.ts                          # dry-run (default)
 *   npx tsx scripts/import-chart-of-accounts.ts --execute                # apply changes
 *   npx tsx scripts/import-chart-of-accounts.ts --file path/to/file.csv  # custom CSV path
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── CLI args ──
const args = process.argv.slice(2)
const execute = args.includes('--execute')
const fileIdx = args.indexOf('--file')
const csvPath = fileIdx !== -1 && args[fileIdx + 1]
  ? path.resolve(args[fileIdx + 1])
  : path.resolve(process.env.USERPROFILE || '', 'Downloads', 'chart_of_accounts-20260326.csv')

// ── Types ──
interface CsvRow {
  Number: string
  'Account Name': string
  'Account Type': string
  'Sub Account of': string
  'Offset Account': string
  Options: string
  Hidden: string
  'Fund Account': string
}

interface AccountRecord {
  code: string
  name: string
  account_type: string
  active: boolean
  is_header: boolean
  sub_type: string | null
  sort_order: number
  parent_code: string | null // resolved to parent_id after insert
}

// ── Helpers ──

/** Parse "6150 SUPPLIES" → "6150" */
function parseParentCode(subAccountOf: string): string | null {
  if (!subAccountOf || !subAccountOf.trim()) return null
  const match = subAccountOf.trim().match(/^(\S+)/)
  return match ? match[1] : null
}

/** Determine sub_type from account_type and context */
function classifySubType(accountType: string, code: string): string | null {
  const t = accountType.toLowerCase()
  // Other Expense / Other Income handled by type directly
  if (t === 'other expense') return 'Other Expense'
  if (t === 'other income') return 'Other Income'
  if (t === 'income') return 'Operating Income'
  if (t === 'expense') return 'Operating Expense'
  if (t === 'asset') return 'Asset'
  if (t === 'liability') return 'Liability'
  if (t === 'capital') return 'Capital'
  if (t === 'cash') return 'Cash'
  return null
}

/** Check if an account is a header (has sub-accounts but no parent) */
function isHeaderAccount(name: string, code: string, rows: CsvRow[]): boolean {
  // If other rows reference this code as parent, it's a header
  const codeAndName = `${code} ${name}`.trim()
  return rows.some(r => {
    const sub = r['Sub Account of']?.trim()
    return sub && (sub === codeAndName || sub.startsWith(code + ' '))
  })
}

// ══════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  CHART OF ACCOUNTS IMPORT')
  console.log(`  Mode: ${execute ? '⚡ EXECUTE (will update DB)' : '🔍 DRY-RUN (read-only)'}`)
  console.log(`  CSV:  ${csvPath}`)
  console.log('═══════════════════════════════════════════════\n')

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV not found: ${csvPath}`)
    process.exit(1)
  }

  const raw = fs.readFileSync(csvPath, 'utf-8')
  const rows: CsvRow[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  })

  console.log(`  Parsed ${rows.length} rows from CSV\n`)

  // ── Build account records ──
  const accounts: AccountRecord[] = []
  let sortOrder = 0

  for (const row of rows) {
    const name = row['Account Name']?.trim()
    const accountType = row['Account Type']?.trim()
    if (!name || !accountType) continue

    let code = row['Number']?.trim() || ''
    // Some accounts have no number — generate a slug
    if (!code) {
      code = `AUTO_${name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)}`
    }

    const parentCode = parseParentCode(row['Sub Account of'])
    const hidden = row['Hidden']?.trim().toLowerCase() === 'hidden'
    const isHeader = isHeaderAccount(name, code, rows)

    accounts.push({
      code,
      name,
      account_type: accountType,
      active: !hidden,
      is_header: isHeader,
      sub_type: classifySubType(accountType, code),
      sort_order: sortOrder++,
      parent_code: parentCode,
    })
  }

  console.log(`  Built ${accounts.length} account records\n`)

  // ── Summary by type ──
  const typeCounts: Record<string, number> = {}
  for (const a of accounts) {
    typeCounts[a.account_type] = (typeCounts[a.account_type] || 0) + 1
  }
  console.log('  Accounts by type:')
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`)
  }

  const withParent = accounts.filter(a => a.parent_code)
  const headers = accounts.filter(a => a.is_header)
  console.log(`\n  With parent: ${withParent.length}`)
  console.log(`  Headers:     ${headers.length}`)
  console.log()

  // ── Preview ──
  console.log('  Sample accounts:')
  for (const a of accounts.slice(0, 10)) {
    const parentStr = a.parent_code ? ` (child of ${a.parent_code})` : ''
    const hiddenStr = !a.active ? ' [HIDDEN]' : ''
    console.log(`    ${a.code.padEnd(10)} ${a.name.padEnd(45)} ${a.account_type.padEnd(15)}${parentStr}${hiddenStr}`)
  }
  console.log('    ...\n')

  if (!execute) {
    console.log('─────────────────────────────────────────────')
    console.log('  DRY-RUN complete. No changes made.')
    console.log('  Run with --execute to apply changes.')
    console.log('─────────────────────────────────────────────\n')
    return
  }

  // ══════════════════════════════════════════════
  //  EXECUTE: Insert accounts in two passes
  // ══════════════════════════════════════════════

  // Pass 1: Insert all accounts WITHOUT parent_id
  console.log('  Pass 1: Inserting accounts...')

  const insertRows = accounts.map(a => ({
    code: a.code,
    name: a.name,
    account_type: a.account_type,
    active: a.active,
    is_header: a.is_header,
    sub_type: a.sub_type,
    sort_order: a.sort_order,
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('gl_accounts')
    .upsert(insertRows, { onConflict: 'code' })
    .select('id, code')

  if (insertError) {
    console.error('❌ Insert error:', insertError.message)
    process.exit(1)
  }

  console.log(`  ✅ Inserted/upserted ${inserted?.length || 0} accounts\n`)

  // Build code → id map
  const { data: allAccounts, error: fetchError } = await supabase
    .from('gl_accounts')
    .select('id, code')

  if (fetchError || !allAccounts) {
    console.error('❌ Fetch error:', fetchError?.message)
    process.exit(1)
  }

  const codeToId = new Map<string, string>()
  for (const a of allAccounts) {
    codeToId.set(a.code, a.id)
  }

  // Pass 2: Set parent_id for accounts with parents
  console.log('  Pass 2: Linking parent/child relationships...')
  let linked = 0
  let linkErrors = 0

  for (const a of accounts) {
    if (!a.parent_code) continue

    const parentId = codeToId.get(a.parent_code)
    const childId = codeToId.get(a.code)

    if (!parentId) {
      console.log(`    ⚠️  Parent code "${a.parent_code}" not found for "${a.name}" (${a.code})`)
      linkErrors++
      continue
    }
    if (!childId) {
      console.log(`    ⚠️  Child code "${a.code}" not found`)
      linkErrors++
      continue
    }

    const { error: updateError } = await supabase
      .from('gl_accounts')
      .update({ parent_id: parentId })
      .eq('id', childId)

    if (updateError) {
      console.log(`    ❌ Failed to link ${a.code} → ${a.parent_code}: ${updateError.message}`)
      linkErrors++
    } else {
      linked++
    }
  }

  console.log(`\n  ✅ Linked ${linked} parent/child relationships`)
  if (linkErrors > 0) {
    console.log(`  ⚠️  ${linkErrors} link errors`)
  }

  // ── Final summary ──
  console.log('\n═══════════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Accounts imported: ${inserted?.length || 0}`)
  console.log(`  Hierarchies set:   ${linked}`)
  console.log(`  Link errors:       ${linkErrors}`)
  console.log('═══════════════════════════════════════════════\n')
}

main().catch(console.error)
