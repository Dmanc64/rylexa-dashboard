import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"

// ── Types ──
interface ReportFilters {
  propertyId?: string
  dateFrom?: string
  dateTo?: string
  ownerId?: string
  dateRangeType?: string
}
interface ReportRequest {
  report_type: string
  filters?: ReportFilters
  format?: 'pdf' | 'csv'
  store?: boolean
}
type ColDef = {
  header: string
  key: string
  width: number
  align?: 'right' | 'left'
  format?: 'currency' | 'date' | 'percent'
}

// ── Helpers ──
function fmtCurrency(n: number | null): string {
  if (n === null || n === undefined) return '$0.00'
  return '$' + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null): string {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function reportLabel(type: string): string {
  const m: Record<string, string> = {
    rent_roll: 'Rent Roll',
    profit_loss: 'Profit & Loss',
    vacancy: 'Vacancy Report',
    maintenance_cost: 'Maintenance Cost',
    ar_aging: 'AR Aging',
    owner_statement: 'Owner Statement',
  }
  return m[type] || type
}

function resolveDateFilters(f: ReportFilters): ReportFilters {
  const r = { ...f }
  const t = new Date()
  const yy = t.getFullYear()
  const mm = t.getMonth()
  const dd = t.getDate()
  switch (f.dateRangeType) {
    case 'current_month':
      r.dateFrom = new Date(yy, mm, 1).toISOString().split('T')[0]
      r.dateTo = new Date(yy, mm + 1, 0).toISOString().split('T')[0]
      break
    case 'last_month': {
      const lm = new Date(yy, mm - 1, 1)
      r.dateFrom = lm.toISOString().split('T')[0]
      r.dateTo = new Date(lm.getFullYear(), lm.getMonth() + 1, 0).toISOString().split('T')[0]
      break
    }
    case 'last_30_days':
      r.dateTo = t.toISOString().split('T')[0]
      r.dateFrom = new Date(yy, mm, dd - 30).toISOString().split('T')[0]
      break
    case 'last_7_days':
      r.dateTo = t.toISOString().split('T')[0]
      r.dateFrom = new Date(yy, mm, dd - 7).toISOString().split('T')[0]
      break
  }
  return r
}

// ── Data Fetchers ──
async function fetchRentRoll(sb: any, f: ReportFilters) {
  let q = sb.from('view_rent_roll').select('*').order('property_name').order('unit_name')
  if (f.propertyId) q = q.eq('property_id', f.propertyId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

async function fetchProfitLoss(sb: any, f: ReportFilters) {
  let q = sb.from('view_profit_and_loss').select('*')
  if (f.propertyId) q = q.eq('property_id', f.propertyId)
  const { data, error } = await q
  if (error) throw error
  const agg = new Map<string, any>()
  for (const row of data || []) {
    const ex = agg.get(row.property_id)
    if (ex) {
      ex.total_income += row.total_income || 0
      ex.total_expenses += row.total_expenses || 0
      ex.net_operating_income += row.net_operating_income || 0
    } else {
      agg.set(row.property_id, {
        property_id: row.property_id,
        property_name: row.property_name,
        total_income: row.total_income || 0,
        total_expenses: row.total_expenses || 0,
        net_operating_income: row.net_operating_income || 0,
      })
    }
  }
  return Array.from(agg.values()).sort((a: any, b: any) => b.net_operating_income - a.net_operating_income)
}

async function fetchVacancy(sb: any, f: ReportFilters) {
  const results: any[] = []
  let vq = sb.from('units').select('id, name, property_id, properties ( name )').eq('status', 'Vacant')
  if (f.propertyId) vq = vq.eq('property_id', f.propertyId)
  const { data: vacant, error: vacantErr } = await vq
  if (vacantErr) throw vacantErr
  for (const u of vacant || []) {
    results.push({
      unit_name: u.name,
      property_name: u.properties?.name || 'Unknown',
      status: 'Vacant',
      tenant_name: '\u2014',
      lease_end_date: null,
      days_until_expiry: null,
    })
  }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + 60)
  const { data: expiring, error: expErr } = await sb
    .from('leases')
    .select('id, end_date, status, unit_id, units ( name, property_id, properties ( name ) ), tenants ( first_name, last_name )')
    .eq('status', 'Active')
    .not('end_date', 'is', null)
    .lte('end_date', cutoff.toISOString().split('T')[0])
    .gte('end_date', new Date().toISOString().split('T')[0])
  if (expErr) throw expErr
  for (const l of expiring || []) {
    const unit = (l as any).units
    const prop = unit?.properties
    const t = (l as any).tenants
    if (f.propertyId && unit?.property_id !== f.propertyId) continue
    const days = l.end_date ? Math.ceil((new Date(l.end_date).getTime() - Date.now()) / 86400000) : null
    results.push({
      unit_name: unit?.name || '?',
      property_name: prop?.name || '?',
      status: 'Expiring',
      tenant_name: t ? `${t.first_name} ${t.last_name}` : '\u2014',
      lease_end_date: l.end_date,
      days_until_expiry: days,
    })
  }
  return results.sort((a, b) => (a.days_until_expiry ?? 999) - (b.days_until_expiry ?? 999))
}

async function fetchMaintenanceCost(sb: any, f: ReportFilters) {
  let q = sb
    .from('work_orders')
    .select('id, title, cost, status, priority, created_at, units ( name, property_id, properties ( name ) )')
    .not('cost', 'is', null)
    .gt('cost', 0)
    .order('created_at', { ascending: false })
  if (f.dateFrom) q = q.gte('created_at', f.dateFrom)
  if (f.dateTo) q = q.lte('created_at', f.dateTo + 'T23:59:59')
  const { data, error } = await q
  if (error) throw error
  const rows: any[] = []
  for (const wo of data || []) {
    const unit = (wo as any).units
    const prop = unit?.properties
    if (f.propertyId && unit?.property_id !== f.propertyId) continue
    rows.push({
      title: wo.title,
      property_name: prop?.name || '?',
      unit_name: unit?.name || 'General',
      vendor_name: '\u2014',
      cost: wo.cost || 0,
      status: wo.status,
      priority: wo.priority,
      created_at: wo.created_at,
    })
  }
  return rows
}

async function fetchARAging(sb: any, f: ReportFilters) {
  let q = sb.from('view_ar_aging').select('*').order('balance_due', { ascending: false })
  if (f.propertyId) q = q.eq('property_id', f.propertyId)
  const { data, error } = await q
  if (error) throw error
  return (data || []).filter((r: any) => r.balance_due > 0)
}

async function fetchOwnerStatement(sb: any, f: ReportFilters) {
  let q = sb.from('distribution_summary').select('*').order('owner_name').order('property_name')
  if (f.ownerId) q = q.eq('owner_id', f.ownerId)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((r: any) => ({
    owner_name: r.owner_name || 'Unknown',
    property_name: r.property_name,
    total_income: r.total_income || 0,
    total_expenses: r.total_expenses || 0,
    net_balance: r.net_balance || 0,
  }))
}

async function fetchReportData(sb: any, type: string, f: ReportFilters): Promise<any[]> {
  switch (type) {
    case 'rent_roll': return fetchRentRoll(sb, f)
    case 'profit_loss': return fetchProfitLoss(sb, f)
    case 'vacancy': return fetchVacancy(sb, f)
    case 'maintenance_cost': return fetchMaintenanceCost(sb, f)
    case 'ar_aging': return fetchARAging(sb, f)
    case 'owner_statement': return fetchOwnerStatement(sb, f)
    default: throw new Error(`Unknown report type: ${type}`)
  }
}

// ── Column Definitions ──
function getColumns(type: string): ColDef[] {
  switch (type) {
    case 'rent_roll':
      return [
        { header: 'Property', key: 'property_name', width: 100 },
        { header: 'Unit', key: 'unit_name', width: 50 },
        { header: 'Tenant', key: 'tenant_name', width: 100 },
        { header: 'Email', key: 'tenant_email', width: 110 },
        { header: 'Rent', key: 'rent_amount', width: 60, align: 'right', format: 'currency' },
        { header: 'Start', key: 'start_date', width: 60, format: 'date' },
        { header: 'End', key: 'end_date', width: 60, format: 'date' },
      ]
    case 'profit_loss':
      return [
        { header: 'Property', key: 'property_name', width: 140 },
        { header: 'Income', key: 'total_income', width: 80, align: 'right', format: 'currency' },
        { header: 'Expenses', key: 'total_expenses', width: 80, align: 'right', format: 'currency' },
        { header: 'NOI', key: 'net_operating_income', width: 80, align: 'right', format: 'currency' },
      ]
    case 'vacancy':
      return [
        { header: 'Property', key: 'property_name', width: 120 },
        { header: 'Unit', key: 'unit_name', width: 60 },
        { header: 'Status', key: 'status', width: 60 },
        { header: 'Tenant', key: 'tenant_name', width: 100 },
        { header: 'Lease End', key: 'lease_end_date', width: 70, format: 'date' },
        { header: 'Days Left', key: 'days_until_expiry', width: 50, align: 'right' },
      ]
    case 'maintenance_cost':
      return [
        { header: 'Date', key: 'created_at', width: 65, format: 'date' },
        { header: 'Property', key: 'property_name', width: 90 },
        { header: 'Work Order', key: 'title', width: 110 },
        { header: 'Vendor', key: 'vendor_name', width: 80 },
        { header: 'Cost', key: 'cost', width: 60, align: 'right', format: 'currency' },
        { header: 'Status', key: 'status', width: 55 },
      ]
    case 'ar_aging':
      return [
        { header: 'Tenant', key: 'tenant_display', width: 100 },
        { header: 'Property', key: 'property_name', width: 90 },
        { header: 'Unit', key: 'unit_name', width: 50 },
        { header: 'Rent', key: 'rent_amount', width: 60, align: 'right', format: 'currency' },
        { header: 'Balance', key: 'balance_due', width: 65, align: 'right', format: 'currency' },
        { header: 'Aging', key: 'aging_bucket', width: 50 },
      ]
    case 'owner_statement':
      return [
        { header: 'Owner', key: 'owner_name', width: 110 },
        { header: 'Property', key: 'property_name', width: 110 },
        { header: 'Income', key: 'total_income', width: 70, align: 'right', format: 'currency' },
        { header: 'Expenses', key: 'total_expenses', width: 70, align: 'right', format: 'currency' },
        { header: 'Net', key: 'net_balance', width: 70, align: 'right', format: 'currency' },
      ]
    default:
      return []
  }
}

function prepareRows(type: string, rows: any[]): any[] {
  if (type === 'ar_aging') {
    return rows.map(r => ({ ...r, tenant_display: `${r.first_name || ''} ${r.last_name || ''}`.trim() }))
  }
  if (type === 'rent_roll') {
    return rows.map(r => ({ ...r, tenant_name: `${r.first_name || ''} ${r.last_name || ''}`.trim() }))
  }
  return rows
}

// ── CSV Builder ──
function buildCSV(rows: any[], columns: ColDef[]): string {
  const hdrs = columns.map(c => c.header).join(',')
  const lines = rows.map(row =>
    columns.map(col => {
      let val = row[col.key]
      if (val === null || val === undefined) return ''
      if (col.format === 'currency') val = Number(val).toFixed(2)
      if (col.format === 'date' && val) val = new Date(val).toLocaleDateString('en-US')
      const s = String(val)
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  )
  return [hdrs, ...lines].join('\n')
}

// ── PDF Builder ──
async function buildPDF(
  rows: any[],
  columns: ColDef[],
  reportType: string,
  filters: ReportFilters,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pw = 792
  const ph = 612
  const mg = 40
  const black = rgb(0, 0, 0)
  const gray = rgb(0.4, 0.4, 0.4)
  const darkBlue = rgb(0.1, 0.15, 0.35)
  const lightGray = rgb(0.95, 0.95, 0.97)

  let page = pdfDoc.addPage([pw, ph])
  let y = ph - mg

  function drawHdr() {
    let x = mg
    page.drawRectangle({ x: mg, y: y - 4, width: pw - mg * 2, height: 16, color: lightGray })
    for (const col of columns) {
      page.drawText(col.header, { x: x + 2, y, size: 7, font: fontBold, color: gray })
      x += col.width
    }
    y -= 18
  }

  function ensureSpace(n: number) {
    if (y - n < mg + 20) {
      page = pdfDoc.addPage([pw, ph])
      y = ph - mg
      drawHdr()
    }
  }

  // Header
  page.drawText('RYLEXA PROPERTIES', { x: mg, y, size: 10, font: fontBold, color: gray })
  y -= 14
  page.drawText('(775) 771-8088  \u2022  Rylexa.com', { x: mg, y, size: 8, font, color: gray })
  page.drawText(reportLabel(reportType).toUpperCase(), {
    x: pw - mg - 200, y: y + 14, size: 14, font: fontBold, color: darkBlue,
  })
  y -= 10
  page.drawLine({ start: { x: mg, y }, end: { x: pw - mg, y }, thickness: 1.5, color: darkBlue })
  y -= 20

  const genD = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  page.drawText(`Generated: ${genD}`, { x: mg, y, size: 8, font, color: gray })
  if (filters.dateFrom || filters.dateTo) {
    page.drawText(`Period: ${filters.dateFrom || 'Start'} to ${filters.dateTo || 'Present'}`, {
      x: mg + 180, y, size: 8, font, color: gray,
    })
  }
  page.drawText(`Records: ${rows.length}`, { x: pw - mg - 80, y, size: 8, font, color: gray })
  y -= 20

  drawHdr()

  for (const row of rows) {
    ensureSpace(14)
    let x = mg
    for (const col of columns) {
      let val = row[col.key]
      if (val === null || val === undefined) val = '\u2014'
      else if (col.format === 'currency') val = fmtCurrency(Number(val))
      else if (col.format === 'date') val = fmtDate(String(val))
      else val = String(val)
      const mx = Math.floor(col.width / 4.5)
      if (val.length > mx) val = val.substring(0, mx - 2) + '..'
      page.drawText(val, { x: x + 2, y, size: 7, font, color: black })
      x += col.width
    }
    y -= 12
  }

  if (rows.length === 0) {
    ensureSpace(16)
    page.drawText('No data found for the selected filters.', { x: mg, y, size: 9, font, color: gray })
    y -= 14
  }

  y -= 10
  page.drawLine({ start: { x: mg, y: y + 6 }, end: { x: pw - mg, y: y + 6 }, thickness: 0.3, color: gray })
  page.drawText('Rylexa Properties  \u2022  Confidential  \u2022  Generated by RylexaPM', {
    x: mg, y: y - 6, size: 7, font, color: gray,
  })

  return pdfDoc.save()
}

// ── Main Handler ──
serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return handleCorsPreFlight(req)
  }

  try {
    console.log('[generate-report] POST request received')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    const isServiceCall = token === serviceKey

    if (!isServiceCall) {
      console.log('[generate-report] Verifying user auth...')
      const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data: { user }, error: authErr } = await supabaseAuth.auth.getUser(token)
      if (authErr || !user) {
        console.error('[generate-report] Auth failed:', authErr?.message)
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      const admin = createClient(supabaseUrl, serviceKey)
      const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
      if (!profile || !['Admin', 'Property Manager', 'Accounting'].includes(profile.role)) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      console.log(`[generate-report] User verified: ${user.id} (${profile.role})`)
    } else {
      console.log('[generate-report] Service role call')
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const body: ReportRequest = await req.json()
    const { report_type, format = 'pdf', store = false } = body
    let filters = body.filters || {}

    console.log(`[generate-report] type=${report_type}, format=${format}, store=${store}`)

    if (!report_type) {
      return new Response(JSON.stringify({ error: 'report_type is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    filters = resolveDateFilters(filters)

    const rawRows = await fetchReportData(supabase, report_type, filters)
    const columns = getColumns(report_type)
    const rows = prepareRows(report_type, rawRows)

    console.log(`[generate-report] Data fetched: ${rows.length} rows, ${columns.length} columns`)

    let fileBytes: Uint8Array
    let contentType: string
    let ext: string

    if (format === 'csv') {
      fileBytes = new TextEncoder().encode(buildCSV(rows, columns))
      contentType = 'text/csv; charset=utf-8'
      ext = 'csv'
    } else {
      fileBytes = await buildPDF(rows, columns, report_type, filters)
      contentType = 'application/pdf'
      ext = 'pdf'
    }

    console.log(`[generate-report] File generated: ${fileBytes.length} bytes`)

    if (store) {
      const dateStr = new Date().toISOString().split('T')[0]
      const fileId = crypto.randomUUID()
      const storagePath = `reports/${report_type}/${dateStr}/${fileId}.${ext}`
      const { error: uploadErr } = await supabase.storage.from('documents').upload(storagePath, fileBytes, {
        contentType,
        upsert: false,
      })
      if (uploadErr) {
        console.error('[generate-report] Upload error:', uploadErr.message)
        throw uploadErr
      }
      const { data: exportRow } = await supabase
        .from('report_exports')
        .insert({ report_type, format: ext, filters, storage_path: storagePath })
        .select('id')
        .single()
      console.log(`[generate-report] Stored at ${storagePath}`)
      return new Response(
        JSON.stringify({ storage_path: storagePath, export_id: exportRow?.id || null, row_count: rows.length }),
        { headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    const filename = `${report_type}_${new Date().toISOString().split('T')[0]}.${ext}`
    console.log(`[generate-report] Returning file: ${filename}`)
    return new Response(fileBytes, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[generate-report] Error:', (err as Error).message, (err as Error).stack)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
