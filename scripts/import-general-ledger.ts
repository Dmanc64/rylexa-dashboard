/**
 * General Ledger Import Script
 *
 * Imports AppFolio general ledger CSV into journal_entries + ledger_entries.
 * Groups transactions by (date + payee + type + reference) into journal entries,
 * then creates individual ledger entries per GL line.
 *
 * Skips: section headers ("-> ..."), Starting/Net/Ending Balance rows, totals.
 *
 * Usage:
 *   npx tsx scripts/import-general-ledger.ts                          # dry-run
 *   npx tsx scripts/import-general-ledger.ts --execute                # apply
 *   npx tsx scripts/import-general-ledger.ts --file path/to/file.csv  # custom CSV
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
  : path.resolve(process.env.USERPROFILE || '', 'Downloads', 'general_ledger-20260326.csv')

// ── Types ──
interface GlRow {
  date: string
  payee: string
  type: string
  reference: string
  debit: number
  credit: number
  description: string
  glAccountCode: string
  glAccountName: string
  propertyName: string
  unitName: string
  month: string
}

// ── Helpers ──

function parseMoney(val: string): number {
  if (!val || !val.trim()) return 0
  return parseFloat(val.replace(/[,"]/g, '')) || 0
}

/** Parse GL Account column: "0000 - Tenant Utility Fee" → code "0000", or name-only for AUTO codes */
function parseGlAccount(glStr: string): { code: string; name: string } {
  if (!glStr || !glStr.trim()) return { code: '', name: '' }
  const trimmed = glStr.trim()
  const match = trimmed.match(/^(\S+)\s*-\s*(.+)$/)
  if (match) {
    return { code: match[1], name: match[2].trim() }
  }
  // Name-only accounts (no code prefix) → use AUTO_ code
  return { code: `AUTO_${trimmed.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)}`, name: trimmed }
}

function parseDate(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null
  const match = dateStr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null
  return `${match[3]}-${match[1]}-${match[2]}`
}

function isSkipRow(date: string, payee: string): boolean {
  if (!date && !payee) return true
  const d = date?.trim() || ''
  const p = payee?.trim() || ''
  if (d.startsWith('->')) return true
  if (p === 'Starting Balance') return true
  if (p === 'Net Change') return true
  if (p === 'Ending Balance') return true
  if (p === 'Total') return true
  if (d === '' && p === '') return true
  return false
}

// ══════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  GENERAL LEDGER IMPORT')
  console.log(`  Mode: ${execute ? '⚡ EXECUTE (will update DB)' : '🔍 DRY-RUN (read-only)'}`)
  console.log(`  CSV:  ${csvPath}`)
  console.log('═══════════════════════════════════════════════\n')

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV not found: ${csvPath}`)
    process.exit(1)
  }

  // ── Load caches ──
  console.log('Loading database caches...')

  const { data: glAccounts } = await supabase.from('gl_accounts').select('id, code, name')
  const { data: properties } = await supabase.from('properties').select('id, name')
  const { data: units } = await supabase.from('units').select('id, name, property_id')

  const glCodeToId = new Map<string, string>()
  const glNameToId = new Map<string, string>()
  for (const a of glAccounts || []) {
    glCodeToId.set(a.code, a.id)
    glNameToId.set(a.name.toLowerCase(), a.id)
  }

  const propNameToId = new Map<string, string>()
  for (const p of properties || []) {
    propNameToId.set(p.name.toLowerCase(), p.id)
  }

  // Build unit lookup: (property_id, unit_name) → unit_id
  const unitLookup = new Map<string, string>()
  for (const u of units || []) {
    unitLookup.set(`${u.property_id}::${u.name.toLowerCase()}`, u.id)
  }

  console.log(`  GL accounts: ${glAccounts?.length || 0}`)
  console.log(`  Properties:  ${properties?.length || 0}`)
  console.log(`  Units:       ${units?.length || 0}\n`)

  // ── Parse CSV ──
  const raw = fs.readFileSync(csvPath, 'utf-8')
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: false,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  })

  // ── Filter to real transaction rows ──
  let currentGlAccount = ''
  const transactions: GlRow[] = []
  let skipped = 0

  for (const row of rows) {
    const dateRaw = row['Date']?.trim() || ''
    const payeeRaw = row['Payee / Payer']?.trim() || ''

    // Track current GL account from section headers
    if (dateRaw.startsWith('->')) {
      const headerMatch = dateRaw.match(/^->\s*(.+)$/)
      if (headerMatch) {
        currentGlAccount = headerMatch[1].trim()
      }
      skipped++
      continue
    }

    if (isSkipRow(dateRaw, payeeRaw)) {
      skipped++
      continue
    }

    const parsedDate = parseDate(dateRaw)
    if (!parsedDate) {
      skipped++
      continue
    }

    const debit = parseMoney(row['Debit'] || '')
    const credit = parseMoney(row['Credit'] || '')
    if (debit === 0 && credit === 0) {
      skipped++
      continue
    }

    // Use row's GL Account column, or fall back to section header
    const glAccountStr = row['GL Account']?.trim() || currentGlAccount

    const { code: glCode } = parseGlAccount(glAccountStr)

    transactions.push({
      date: parsedDate,
      payee: payeeRaw,
      type: row['Type']?.trim() || 'Other',
      reference: row['Reference']?.trim() || '',
      debit,
      credit,
      description: row['Description']?.trim() || '',
      glAccountCode: glCode,
      glAccountName: parseGlAccount(glAccountStr).name,
      propertyName: row['Property Name']?.trim() || '',
      unitName: row['Unit']?.trim() || '',
      month: row['Month']?.trim() || '',
    })
  }

  console.log(`  Parsed ${rows.length} total rows`)
  console.log(`  Skipped ${skipped} non-transaction rows`)
  console.log(`  Found ${transactions.length} transactions\n`)

  // ── Resolve lookups ──
  let glMisses = 0
  let propMisses = 0
  const missingGl = new Set<string>()
  const missingProp = new Set<string>()

  for (const t of transactions) {
    const accountId = glCodeToId.get(t.glAccountCode) || glNameToId.get(t.glAccountName.toLowerCase())
    if (!accountId) {
      missingGl.add(`${t.glAccountCode} - ${t.glAccountName}`)
      glMisses++
    }
    if (t.propertyName && !propNameToId.get(t.propertyName.toLowerCase())) {
      missingProp.add(t.propertyName)
      propMisses++
    }
  }

  if (missingGl.size > 0) {
    console.log(`  ⚠️  Missing GL accounts (${missingGl.size} unique):`)
    for (const m of [...missingGl].slice(0, 10)) {
      console.log(`      ${m}`)
    }
    if (missingGl.size > 10) console.log(`      ... and ${missingGl.size - 10} more`)
    console.log()
  }

  if (missingProp.size > 0) {
    console.log(`  ⚠️  Missing properties (${missingProp.size} unique):`)
    for (const m of [...missingProp].slice(0, 10)) {
      console.log(`      ${m}`)
    }
    console.log()
  }

  // ── Type breakdown ──
  const typeCounts: Record<string, number> = {}
  for (const t of transactions) {
    typeCounts[t.type] = (typeCounts[t.type] || 0) + 1
  }
  console.log('  Transaction types:')
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`)
  }

  // ── Totals ──
  let totalDebit = 0
  let totalCredit = 0
  for (const t of transactions) {
    totalDebit += t.debit
    totalCredit += t.credit
  }
  console.log(`\n  Total debits:  $${totalDebit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  Total credits: $${totalCredit.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`)

  if (!execute) {
    console.log('─────────────────────────────────────────────')
    console.log('  DRY-RUN complete. No changes made.')
    console.log('  Run with --execute to apply changes.')
    console.log('─────────────────────────────────────────────\n')
    return
  }

  // ══════════════════════════════════════════════
  //  EXECUTE: Insert journal entries + ledger entries
  // ══════════════════════════════════════════════

  console.log('  Inserting transactions in batches...\n')

  const BATCH_SIZE = 200
  let journalCount = 0
  let ledgerCount = 0
  let errorCount = 0

  // Process each transaction as its own journal entry + ledger entry
  // (AppFolio GL is already one line per transaction)
  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE)

    // Create journal entries
    const journalRows = batch.map(t => {
      const propertyId = t.propertyName
        ? propNameToId.get(t.propertyName.toLowerCase()) || null
        : null

      return {
        description: t.payee || t.description || 'AppFolio Import',
        entry_type: t.type,
        amount: t.debit || t.credit,
        created_at: `${t.date}T00:00:00Z`,
        payee: t.payee || null,
        reference: t.reference || null,
        property_id: propertyId,
        source: 'appfolio',
      }
    })

    const { data: insertedJournals, error: jError } = await supabase
      .from('journal_entries')
      .insert(journalRows)
      .select('id')

    if (jError) {
      console.error(`  ❌ Journal batch error at row ${i}: ${jError.message}`)
      errorCount += batch.length
      continue
    }

    if (!insertedJournals || insertedJournals.length !== batch.length) {
      console.error(`  ❌ Journal count mismatch at row ${i}: expected ${batch.length}, got ${insertedJournals?.length}`)
      errorCount += batch.length
      continue
    }

    journalCount += insertedJournals.length

    // Create ledger entries linked to journal entries
    const ledgerRows = batch.map((t, idx) => {
      const accountId = glCodeToId.get(t.glAccountCode)
        || glNameToId.get(t.glAccountName.toLowerCase())
        || null

      const propertyId = t.propertyName
        ? propNameToId.get(t.propertyName.toLowerCase()) || null
        : null

      let unitId: string | null = null
      if (propertyId && t.unitName) {
        unitId = unitLookup.get(`${propertyId}::${t.unitName.toLowerCase()}`) || null
      }

      return {
        journal_entry_id: insertedJournals[idx].id,
        account_id: accountId,
        debit: t.debit || 0,
        credit: t.credit || 0,
        description: t.description || t.payee || null,
        created_at: `${t.date}T00:00:00Z`,
        property_id: propertyId,
        unit_id: unitId,
      }
    })

    const { error: lError } = await supabase
      .from('ledger_entries')
      .insert(ledgerRows)

    if (lError) {
      console.error(`  ❌ Ledger batch error at row ${i}: ${lError.message}`)
      errorCount += batch.length
    } else {
      ledgerCount += ledgerRows.length
    }

    // Progress
    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= transactions.length) {
      const pct = Math.min(100, Math.round(((i + BATCH_SIZE) / transactions.length) * 100))
      console.log(`    ${pct}% — ${journalCount} journals, ${ledgerCount} ledgers`)
    }
  }

  // ── Final summary ──
  console.log('\n═══════════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Journal entries: ${journalCount}`)
  console.log(`  Ledger entries:  ${ledgerCount}`)
  console.log(`  Errors:          ${errorCount}`)
  console.log(`  GL misses:       ${glMisses} (${missingGl.size} unique accounts)`)
  console.log(`  Property misses: ${propMisses} (${missingProp.size} unique)`)
  console.log('═══════════════════════════════════════════════\n')
}

main().catch(console.error)
