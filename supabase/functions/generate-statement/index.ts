import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1"
import { getCorsHeaders, handleCorsPreFlight } from "./_shared/cors.ts"

// ── HELPERS ──
function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '$0.00'
  return '$' + Math.abs(Number(amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

// ── PDF BUILDER ──
interface StatementData {
  tenantName: string
  unitAddress: string
  propertyName: string
  billingPeriod: string
  billingMonth: number
  billingYear: number
  openingBalance: number
  totalCharges: number
  totalPayments: number
  closingBalance: number
  entries: {
    created_at: string
    type: string
    description: string
    amount: number
  }[]
}

async function buildStatementPdf(data: StatementData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pageWidth = 612
  const pageHeight = 792
  const margin = 50
  const contentWidth = pageWidth - margin * 2
  const black = rgb(0, 0, 0)
  const gray = rgb(0.4, 0.4, 0.4)
  const darkBlue = rgb(0.1, 0.15, 0.35)
  const lightGray = rgb(0.95, 0.95, 0.97)

  let currentPage = pdfDoc.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  function ensureSpace(needed: number) {
    if (y - needed < margin + 30) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
  }

  // ── HEADER ──
  currentPage.drawText('RYLEXA PROPERTIES', { x: margin, y, size: 10, font: fontBold, color: gray })
  y -= 14
  currentPage.drawText('(775) 771-8088  •  Rylexa.com', { x: margin, y, size: 8, font, color: gray })

  // Statement title (right-aligned)
  currentPage.drawText('MONTHLY STATEMENT', { x: pageWidth - margin - 160, y: y + 14, size: 14, font: fontBold, color: darkBlue })
  y -= 10
  currentPage.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1.5, color: darkBlue })
  y -= 24

  // ── TENANT & PERIOD INFO ──
  const infoFields = [
    ['Tenant:', data.tenantName],
    ['Property:', data.propertyName],
    ['Unit:', data.unitAddress],
    ['Billing Period:', data.billingPeriod],
  ]
  for (const [label, value] of infoFields) {
    currentPage.drawText(label, { x: margin, y, size: 9, font: fontBold, color: gray })
    currentPage.drawText(value, { x: margin + 100, y, size: 9, font: fontBold, color: black })
    y -= 16
  }
  y -= 10

  // ── SUMMARY BOX ──
  const boxHeight = 90
  ensureSpace(boxHeight + 20)
  const boxTop = y + 4
  currentPage.drawRectangle({
    x: margin, y: boxTop - boxHeight, width: contentWidth, height: boxHeight,
    borderColor: gray, borderWidth: 0.5, color: lightGray,
  })

  let boxY = boxTop - 18
  currentPage.drawText('ACCOUNT SUMMARY', { x: margin + 14, y: boxY, size: 10, font: fontBold, color: darkBlue })
  boxY -= 20

  const summaryFields = [
    ['Opening Balance:', formatCurrency(data.openingBalance)],
    ['Total Charges:', formatCurrency(data.totalCharges)],
    ['Total Payments:', '(' + formatCurrency(data.totalPayments) + ')'],
    ['Closing Balance:', formatCurrency(data.closingBalance)],
  ]

  for (let i = 0; i < summaryFields.length; i++) {
    const [label, value] = summaryFields[i]
    const isBold = i === summaryFields.length - 1
    const useFont = isBold ? fontBold : font
    const size = isBold ? 10 : 9
    currentPage.drawText(label, { x: margin + 14, y: boxY, size, font: useFont, color: gray })
    currentPage.drawText(value, { x: margin + 200, y: boxY, size, font: useFont, color: black })
    boxY -= 14
  }
  y = boxTop - boxHeight - 20

  // ── LINE ITEMS TABLE ──
  ensureSpace(40)
  currentPage.drawText('TRANSACTION DETAIL', { x: margin, y, size: 10, font: fontBold, color: darkBlue })
  y -= 6
  currentPage.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.5, color: gray })
  y -= 16

  // Table header
  const colDate = margin
  const colType = margin + 80
  const colDesc = margin + 160
  const colCharges = margin + 360
  const colPayments = margin + 440

  currentPage.drawText('Date', { x: colDate, y, size: 8, font: fontBold, color: gray })
  currentPage.drawText('Type', { x: colType, y, size: 8, font: fontBold, color: gray })
  currentPage.drawText('Description', { x: colDesc, y, size: 8, font: fontBold, color: gray })
  currentPage.drawText('Charges', { x: colCharges, y, size: 8, font: fontBold, color: gray })
  currentPage.drawText('Payments', { x: colPayments, y, size: 8, font: fontBold, color: gray })
  y -= 4
  currentPage.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.3, color: gray })
  y -= 14

  // Table rows
  for (const entry of data.entries) {
    ensureSpace(18)
    const isCharge = ['Rent Charge', 'Late Fee', 'Utility Charge'].includes(entry.type)
    const dateStr = new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const desc = entry.description.length > 30 ? entry.description.substring(0, 30) + '...' : entry.description

    currentPage.drawText(dateStr, { x: colDate, y, size: 8, font, color: black })
    currentPage.drawText(entry.type, { x: colType, y, size: 8, font, color: black })
    currentPage.drawText(desc, { x: colDesc, y, size: 8, font, color: black })

    if (isCharge) {
      currentPage.drawText(formatCurrency(entry.amount), { x: colCharges, y, size: 8, font: fontBold, color: black })
    } else {
      currentPage.drawText(formatCurrency(entry.amount), { x: colPayments, y, size: 8, font: fontBold, color: black })
    }
    y -= 14
  }

  if (data.entries.length === 0) {
    ensureSpace(18)
    currentPage.drawText('No transactions for this period.', { x: margin, y, size: 9, font, color: gray })
    y -= 14
  }

  // ── CLOSING BALANCE LINE ──
  y -= 4
  currentPage.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.5, color: darkBlue })
  y -= 16
  currentPage.drawText('BALANCE DUE:', { x: colCharges - 80, y, size: 11, font: fontBold, color: darkBlue })
  currentPage.drawText(formatCurrency(data.closingBalance), { x: colCharges + 20, y, size: 11, font: fontBold, color: data.closingBalance > 0 ? rgb(0.8, 0.1, 0.1) : rgb(0.1, 0.5, 0.3) })

  // ── FOOTER ──
  y -= 40
  ensureSpace(40)
  currentPage.drawLine({ start: { x: margin, y: y + 10 }, end: { x: pageWidth - margin, y: y + 10 }, thickness: 0.3, color: gray })
  currentPage.drawText('Rylexa Properties  •  (775) 771-8088  •  Rylexa.com', { x: margin, y: y - 6, size: 7, font, color: gray })
  currentPage.drawText('This is a computer-generated statement. Please contact management with any questions.', { x: margin, y: y - 16, size: 7, font, color: gray })

  return pdfDoc.save()
}

// ── MAIN HANDLER ──
serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return handleCorsPreFlight(req)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Auth check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }
    const token = authHeader.replace('Bearer ', '')

    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Admin client
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify role
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', user.id)
      .single()

    if (!callerProfile || !['Admin', 'Property Manager'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden: Admin or Property Manager required' }), {
        status: 403, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Parse request
    const { lease_id, billing_month, billing_year } = await req.json()
    if (!lease_id || !billing_month || !billing_year) {
      return new Response(JSON.stringify({ error: 'lease_id, billing_month, and billing_year are required' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Fetch lease data
    const { data: lease, error: leaseError } = await supabase
      .from('leases')
      .select(`
        id, rent_amount, start_date, end_date,
        tenants ( first_name, last_name, email ),
        units ( name, properties ( name, address ) )
      `)
      .eq('id', lease_id)
      .single()

    if (leaseError || !lease) {
      return new Response(JSON.stringify({ error: 'Lease not found' }), {
        status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    const tenant = (lease as any).tenants || {}
    const unit = (lease as any).units || {}
    const property = unit.properties || {}

    // Calculate period boundaries
    const periodStart = `${billing_year}-${String(billing_month).padStart(2, '0')}-01T00:00:00`
    const nextMonth = billing_month === 12 ? 1 : billing_month + 1
    const nextYear = billing_month === 12 ? billing_year + 1 : billing_year
    const periodEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00`

    // Fetch opening balance (all entries BEFORE period start)
    const { data: priorEntries } = await supabase
      .from('accounting')
      .select('type, amount')
      .eq('lease_id', lease_id)
      .lt('created_at', periodStart)

    let openingBalance = 0
    if (priorEntries) {
      for (const e of priorEntries) {
        if (['Rent Charge', 'Late Fee', 'Utility Charge'].includes(e.type)) openingBalance += Number(e.amount)
        else if (['Payment', 'Credit'].includes(e.type)) openingBalance -= Number(e.amount)
      }
    }

    // Fetch period entries
    const { data: periodEntries } = await supabase
      .from('accounting')
      .select('id, created_at, type, category, description, amount, status')
      .eq('lease_id', lease_id)
      .gte('created_at', periodStart)
      .lt('created_at', periodEnd)
      .order('created_at', { ascending: true })

    let totalCharges = 0
    let totalPayments = 0
    const entries = (periodEntries || []).map((e: any) => {
      const amt = Number(e.amount)
      if (['Rent Charge', 'Late Fee', 'Utility Charge'].includes(e.type)) totalCharges += amt
      else if (['Payment', 'Credit'].includes(e.type)) totalPayments += amt
      return { created_at: e.created_at, type: e.type, description: e.description || e.type, amount: amt }
    })

    const closingBalance = openingBalance + totalCharges - totalPayments

    // Build PDF
    const statementData: StatementData = {
      tenantName: `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || 'Tenant',
      unitAddress: `Unit ${unit.name || 'N/A'}`,
      propertyName: `${property.name || 'Property'}${property.address ? ', ' + property.address : ''}`,
      billingPeriod: `${MONTH_NAMES[billing_month - 1]} ${billing_year}`,
      billingMonth: billing_month,
      billingYear: billing_year,
      openingBalance,
      totalCharges,
      totalPayments,
      closingBalance,
      entries,
    }

    const pdfBytes = await buildStatementPdf(statementData)

    // Upload to storage
    const storagePath = `${lease_id}/${billing_year}-${String(billing_month).padStart(2, '0')}.pdf`
    await supabase.storage
      .from('statements')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      })

    // Upsert tenant_statements record
    await supabase
      .from('tenant_statements')
      .upsert({
        lease_id,
        billing_month,
        billing_year,
        period_name: MONTH_NAMES[billing_month - 1],
        opening_balance: openingBalance,
        total_charges: totalCharges,
        total_payments: totalPayments,
        closing_balance: closingBalance,
        pdf_path: storagePath,
        generated_at: new Date().toISOString(),
        generated_by: user.id,
      }, {
        onConflict: 'lease_id,billing_month,billing_year',
      })

    // Return PDF
    const filename = `Statement_${statementData.tenantName.replace(/\s+/g, '_')}_${billing_year}-${String(billing_month).padStart(2, '0')}.pdf`
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
