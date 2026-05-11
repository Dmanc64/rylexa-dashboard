import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, PDFFont, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { requireRole } from "../_shared/auth.ts";

/**
 * generate-check — build a voucher-layout check PDF (check on top + stub
 * below) for one or more Approved bills to the same vendor, upload it to
 * the documents bucket, and call record_check_payment() to:
 *   1. reserve a check number atomically,
 *   2. mark each bill Paid with reference "CHK#<n>",
 *   3. create check_runs + check_run_bills rows,
 *   4. post the AP→Cash ledger entries via mark_bill_paid.
 *
 * POST body: { bill_ids: string[], bank_account_id: string, memo?: string, check_date?: string }
 * Returns:   { check_run_id, check_number, pdf_url }
 *
 * MICR line:
 *   If env MICR_FONT_URL is set (a public URL to a licensed E-13B TTF),
 *   we fetch + embed it. Otherwise we fall back to Courier-Bold so the
 *   check is visually readable but NOT bank-scannable. The UI surfaces
 *   this so operators don't accidentally run a production payment on the
 *   fallback.
 */

const PAGE_W = 612;   // 8.5 in
const PAGE_H = 792;   // 11  in
const CHECK_H = 252;  // 3.5 in  (top band)

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2,
});

// MICR E-13B symbol mapping. Most licensed MICR fonts map the four special
// symbols to A/B/C/D — Transit(A), Amount(B), On-Us(C), Dash(D) — which is
// the de-facto standard for OCR-style MICR fonts (GnuMICR, TrueTypeMICR,
// Troy, etc.). If your font uses a different mapping, change these.
const MICR = {
  TRANSIT: 'A',  // ⑆ — frames routing number
  AMOUNT:  'B',  // ⑇ — not typically used on business checks
  ON_US:   'C',  // ⑈ — separates account # and check #
  DASH:    'D',  // ⑉ — dash within account/on-us field
};

// Amount → "one thousand nine hundred thirty-four and 94/100 DOLLARS"
function amountInWords(amount: number): string {
  const dollars = Math.floor(amount);
  const cents = Math.round((amount - dollars) * 100);

  const below20 = ['zero','one','two','three','four','five','six','seven','eight','nine',
    'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];

  const nnn = (n: number): string => {
    if (n === 0) return '';
    if (n < 20) return below20[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n % 10 ? '-' + below20[n % 10] : '');
    const h = Math.floor(n/100);
    const r = n % 100;
    return below20[h] + ' hundred' + (r ? ' ' + nnn(r) : '');
  };

  const scales = ['', 'thousand', 'million', 'billion'];
  const parts: string[] = [];
  let n = dollars;
  let scaleIdx = 0;
  if (n === 0) parts.push('zero');
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(nnn(chunk) + (scales[scaleIdx] ? ' ' + scales[scaleIdx] : ''));
    n = Math.floor(n / 1000);
    scaleIdx++;
  }
  const words = parts.join(' ').trim().replace(/\s+/g, ' ');
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
  return `${capitalized} and ${String(cents).padStart(2, '0')}/100 DOLLARS`;
}

function formatCheckDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

async function tryLoadMicrFont(pdfDoc: PDFDocument): Promise<PDFFont | null> {
  const url = Deno.env.get('MICR_FONT_URL');
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`MICR font fetch failed: ${res.status}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return await pdfDoc.embedFont(bytes);
  } catch (e) {
    console.error('MICR font load error:', e);
    return null;
  }
}

interface BankAccount {
  id: string;
  name: string;
  bank_name: string | null;
  routing_number: string;
  account_number: string;
  fractional_routing: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}

interface BillRow {
  id: string;
  invoice_number: string | null;
  description: string;
  amount: number;
  due_date: string;
  category: string;
  created_at: string;
}

interface Vendor {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

async function buildCheckPdf(args: {
  checkNumber: number;
  checkDate: string;
  bank: BankAccount;
  vendor: Vendor;
  bills: BillRow[];
  memo: string | null;
  totalAmount: number;
}): Promise<{ bytes: Uint8Array; micrEmbedded: boolean }> {
  const pdfDoc = await PDFDocument.create();
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const courierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
  const micrFont = await tryLoadMicrFont(pdfDoc);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  const black = rgb(0, 0, 0);
  const gray = rgb(0.5, 0.5, 0.5);

  // ═══════════════════════════════════════════════════════════════════
  // TOP: CHECK BODY (0 to CHECK_H from top → y = PAGE_H down to PAGE_H-CHECK_H)
  // ═══════════════════════════════════════════════════════════════════
  const checkTopY = PAGE_H;             // 792
  const checkBottomY = PAGE_H - CHECK_H; // 540

  // Border around check area (light, as a guide for blank stock)
  page.drawRectangle({
    x: 18, y: checkBottomY + 6, width: PAGE_W - 36, height: CHECK_H - 12,
    borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5,
  });

  // — Bank / company header, top-left
  let y = checkTopY - 36;
  page.drawText(args.bank.bank_name || args.bank.name, {
    x: 40, y, size: 11, font: helvBold, color: black,
  });
  y -= 14;
  if (args.bank.address_line1) {
    page.drawText(args.bank.address_line1, { x: 40, y, size: 9, font: helv, color: gray });
    y -= 11;
  }
  if (args.bank.city && args.bank.state) {
    const line = `${args.bank.city}, ${args.bank.state} ${args.bank.postal_code ?? ''}`.trim();
    page.drawText(line, { x: 40, y, size: 9, font: helv, color: gray });
  }

  // — Check number (top-right, large)
  const checkNumStr = String(args.checkNumber);
  const checkNumWidth = helvBold.widthOfTextAtSize(checkNumStr, 16);
  page.drawText(checkNumStr, {
    x: PAGE_W - 50 - checkNumWidth, y: checkTopY - 36,
    size: 16, font: helvBold, color: black,
  });
  page.drawText('CHECK NO.', {
    x: PAGE_W - 50 - helv.widthOfTextAtSize('CHECK NO.', 7),
    y: checkTopY - 22,
    size: 7, font: helv, color: gray,
  });

  // — Fractional routing just below check number
  if (args.bank.fractional_routing) {
    const fw = helv.widthOfTextAtSize(args.bank.fractional_routing, 9);
    page.drawText(args.bank.fractional_routing, {
      x: PAGE_W - 50 - fw, y: checkTopY - 60,
      size: 9, font: helv, color: black,
    });
  }

  // — Date (right side)
  const dateLabelY = checkTopY - 90;
  page.drawText('DATE', {
    x: PAGE_W - 180, y: dateLabelY + 12, size: 7, font: helv, color: gray,
  });
  page.drawText(formatCheckDate(args.checkDate), {
    x: PAGE_W - 150, y: dateLabelY, size: 11, font: helvBold, color: black,
  });
  page.drawLine({
    start: { x: PAGE_W - 150, y: dateLabelY - 3 },
    end:   { x: PAGE_W - 40,  y: dateLabelY - 3 },
    thickness: 0.5, color: black,
  });

  // — Pay to the order of
  const payLineY = checkTopY - 130;
  page.drawText('PAY TO THE', { x: 40, y: payLineY + 12, size: 7, font: helv, color: gray });
  page.drawText('ORDER OF',   { x: 40, y: payLineY + 2,  size: 7, font: helv, color: gray });

  const payeeName = args.vendor.company_name || args.vendor.contact_name || 'Unknown Vendor';
  page.drawText(payeeName, { x: 100, y: payLineY, size: 13, font: helvBold, color: black });
  page.drawLine({
    start: { x: 100, y: payLineY - 3 },
    end:   { x: PAGE_W - 180, y: payLineY - 3 },
    thickness: 0.5, color: black,
  });

  // — Numeric amount box (right)
  const amountBoxX = PAGE_W - 170;
  const amountBoxY = payLineY - 10;
  page.drawRectangle({
    x: amountBoxX, y: amountBoxY, width: 130, height: 24,
    borderColor: black, borderWidth: 0.8,
  });
  const amtStr = `$ ${USD.format(args.totalAmount).replace('$', '')}`;
  page.drawText(amtStr, {
    x: amountBoxX + 8, y: amountBoxY + 8, size: 12, font: helvBold, color: black,
  });

  // — Amount in words (full-width line under payee)
  const wordsY = payLineY - 30;
  const words = amountInWords(args.totalAmount);
  page.drawText(words, { x: 40, y: wordsY, size: 10, font: helv, color: black });
  // Fill remaining line with asterisks to prevent tampering
  const wordsWidth = helv.widthOfTextAtSize(words, 10);
  const fillStartX = 40 + wordsWidth + 6;
  const fillEndX   = PAGE_W - 50;
  if (fillEndX > fillStartX) {
    const asterisks = '*'.repeat(Math.floor((fillEndX - fillStartX) / 4.2));
    page.drawText(asterisks, { x: fillStartX, y: wordsY, size: 10, font: helv, color: gray });
  }
  page.drawLine({
    start: { x: 40, y: wordsY - 3 }, end: { x: fillEndX, y: wordsY - 3 },
    thickness: 0.5, color: black,
  });

  // — Payee address block (bottom-left of check)
  const addrY = wordsY - 30;
  if (args.vendor.address_street) {
    page.drawText(args.vendor.address_street, { x: 100, y: addrY, size: 9, font: helv, color: gray });
  }
  const cityLine = [args.vendor.address_city, args.vendor.address_state, args.vendor.address_zip].filter(Boolean).join(', ');
  if (cityLine) {
    page.drawText(cityLine, { x: 100, y: addrY - 12, size: 9, font: helv, color: gray });
  }

  // — Memo
  const memoY = checkBottomY + 64;
  page.drawText('MEMO', { x: 40, y: memoY + 12, size: 7, font: helv, color: gray });
  const memoText = args.memo ?? `Invoice ${args.bills.map(b => '#' + (b.invoice_number ?? b.id.slice(0, 8))).join(', ')}`;
  page.drawText(memoText, { x: 80, y: memoY, size: 9, font: helv, color: black });
  page.drawLine({
    start: { x: 80, y: memoY - 3 }, end: { x: 300, y: memoY - 3 },
    thickness: 0.5, color: black,
  });

  // — Signature line
  page.drawLine({
    start: { x: 340, y: memoY - 3 }, end: { x: PAGE_W - 40, y: memoY - 3 },
    thickness: 0.5, color: black,
  });
  page.drawText('AUTHORIZED SIGNATURE', {
    x: 340, y: memoY + 12, size: 7, font: helv, color: gray,
  });
  page.drawText('VOID AFTER 90 DAYS', {
    x: 340, y: memoY - 14, size: 7, font: helv, color: gray,
  });

  // — MICR LINE (bottom 5/8" of check area, left-aligned at ~0.5" margin)
  // Standard layout:  ⑆ routing ⑆ <space> account ⑈ <space> check#
  // Using 12pt is typical; MICR fonts are designed to render correctly at 10-12pt.
  const micrY = checkBottomY + 22;   // ~0.3" above the perforation
  const micrSize = 12;
  const routing = args.bank.routing_number;
  const account = args.bank.account_number;
  const micrString =
    `${MICR.TRANSIT}${routing}${MICR.TRANSIT} ` +
    `${account}${MICR.ON_US} ` +
    `${checkNumStr.padStart(4, '0')}`;

  if (micrFont) {
    page.drawText(micrString, { x: 54, y: micrY, size: micrSize, font: micrFont, color: black });
  } else {
    // Fallback: Courier-Bold so the line is visible but not bank-scannable.
    page.drawText(micrString, { x: 54, y: micrY, size: micrSize, font: courierBold, color: black });
    page.drawText('(MICR FONT NOT CONFIGURED — TEST/ALIGNMENT ONLY, NOT BANK-READABLE)', {
      x: 54, y: micrY - 12, size: 6, font: helv, color: rgb(0.8, 0, 0),
    });
  }

  // — Perforation line between check and stub
  const perfY = checkBottomY;
  for (let x = 20; x < PAGE_W - 20; x += 6) {
    page.drawLine({
      start: { x, y: perfY }, end: { x: x + 3, y: perfY },
      thickness: 0.3, color: gray,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // BOTTOM: VOUCHER STUB
  // ═══════════════════════════════════════════════════════════════════
  const stubTopY = checkBottomY - 30;

  page.drawText('REMITTANCE ADVICE', {
    x: 40, y: stubTopY, size: 10, font: helvBold, color: black,
  });
  page.drawText(`Check No. ${checkNumStr}`, {
    x: PAGE_W - 40 - helvBold.widthOfTextAtSize(`Check No. ${checkNumStr}`, 10),
    y: stubTopY, size: 10, font: helvBold, color: black,
  });

  // Payee + date
  let sy = stubTopY - 22;
  page.drawText(`Paid to:  ${payeeName}`, { x: 40, y: sy, size: 10, font: helv, color: black });
  page.drawText(`Date:  ${formatCheckDate(args.checkDate)}`, {
    x: PAGE_W - 200, y: sy, size: 10, font: helv, color: black,
  });
  sy -= 20;

  // Table header
  page.drawLine({
    start: { x: 40, y: sy + 14 }, end: { x: PAGE_W - 40, y: sy + 14 },
    thickness: 0.5, color: gray,
  });
  page.drawText('INVOICE #', { x: 40,  y: sy, size: 8, font: helvBold, color: gray });
  page.drawText('DATE',      { x: 150, y: sy, size: 8, font: helvBold, color: gray });
  page.drawText('DESCRIPTION', { x: 230, y: sy, size: 8, font: helvBold, color: gray });
  page.drawText('AMOUNT',    { x: PAGE_W - 90, y: sy, size: 8, font: helvBold, color: gray });
  page.drawLine({
    start: { x: 40, y: sy - 4 }, end: { x: PAGE_W - 40, y: sy - 4 },
    thickness: 0.5, color: gray,
  });
  sy -= 18;

  // Bill rows
  for (const b of args.bills) {
    if (sy < 100) break;
    const invoice = b.invoice_number || b.id.slice(0, 8);
    const date = formatCheckDate(b.created_at.split('T')[0]);
    const desc = (b.description || '').slice(0, 55);
    const amt  = USD.format(Number(b.amount));

    page.drawText(invoice, { x: 40,  y: sy, size: 9, font: helv, color: black });
    page.drawText(date,    { x: 150, y: sy, size: 9, font: helv, color: black });
    page.drawText(desc,    { x: 230, y: sy, size: 9, font: helv, color: black });
    const amtW = helv.widthOfTextAtSize(amt, 9);
    page.drawText(amt, { x: PAGE_W - 50 - amtW, y: sy, size: 9, font: helv, color: black });
    sy -= 14;
  }

  // Total
  sy -= 6;
  page.drawLine({
    start: { x: PAGE_W - 200, y: sy + 10 }, end: { x: PAGE_W - 40, y: sy + 10 },
    thickness: 0.5, color: black,
  });
  page.drawText('TOTAL PAID', { x: PAGE_W - 200, y: sy, size: 10, font: helvBold, color: black });
  const totalStr = USD.format(args.totalAmount);
  const totalW = helvBold.widthOfTextAtSize(totalStr, 11);
  page.drawText(totalStr, {
    x: PAGE_W - 50 - totalW, y: sy, size: 11, font: helvBold, color: black,
  });

  // Footer note
  page.drawText('Detach before depositing.', {
    x: 40, y: 40, size: 8, font: helv, color: gray,
  });

  const bytes = await pdfDoc.save();
  return { bytes, micrEmbedded: !!micrFont };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req);
  const corsHeaders = getCorsHeaders(req);

  try {
    await requireRole(req, ['Admin', 'Property Manager', 'Accounting']);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Feature flag guard
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('value')
      .eq('key', 'check_printing')
      .single();
    if (!flag?.value) {
      return new Response(
        JSON.stringify({ error: 'Check printing feature is disabled.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
      );
    }

    const body = await req.json();
    const billIds: string[] = body.bill_ids;
    const bankAccountId: string = body.bank_account_id;
    const memo: string | null = body.memo ?? null;
    const checkDate: string = body.check_date ?? new Date().toISOString().slice(0, 10);

    if (!Array.isArray(billIds) || billIds.length === 0) {
      throw new Error('bill_ids must be a non-empty array');
    }
    if (!bankAccountId) throw new Error('bank_account_id is required');

    // Fetch bank account
    const { data: bank, error: bankErr } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('id', bankAccountId)
      .eq('is_active', true)
      .single();
    if (bankErr || !bank) throw new Error('Bank account not found or inactive');

    // Fetch bills + vendor, validate
    const { data: bills, error: billsErr } = await supabase
      .from('bills')
      .select('id, vendor_id, invoice_number, description, amount, due_date, category, status, created_at')
      .in('id', billIds);
    if (billsErr) throw billsErr;
    if (!bills || bills.length !== billIds.length) throw new Error('One or more bills not found');
    if (bills.some(b => b.status !== 'Approved')) throw new Error('All bills must be in Approved status');

    const vendorIds = new Set(bills.map(b => b.vendor_id));
    if (vendorIds.size > 1) throw new Error('All bills on one check must be the same vendor');
    const vendorId = bills[0].vendor_id;

    const { data: vendor, error: vErr } = await supabase
      .from('vendors')
      .select('id, company_name, contact_name, address_street, address_city, address_state, address_zip')
      .eq('id', vendorId)
      .single();
    // Surface the actual reason so misses on schema/columns don't hide as "Vendor not found"
    if (vErr) throw new Error(`Vendor lookup failed: ${vErr.message}`);
    if (!vendor) throw new Error(`Vendor ${vendorId} not found`);

    const totalAmount = bills.reduce((s, b) => s + Number(b.amount), 0);

    // Peek at the next check number WITHOUT reserving it (so we can bake it
    // into the PDF). The RPC below reserves atomically.
    const peekedNumber = bank.next_check_number as number;

    const { bytes, micrEmbedded } = await buildCheckPdf({
      checkNumber: peekedNumber,
      checkDate,
      bank: bank as BankAccount,
      vendor: vendor as Vendor,
      bills: bills as BillRow[],
      memo,
      totalAmount,
    });

    // Upload PDF to documents bucket
    const storagePath = `checks/${bank.id}/${peekedNumber}_${Date.now()}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, bytes, {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (uploadErr) throw new Error(`PDF upload failed: ${uploadErr.message}`);

    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(storagePath);
    const pdfUrl = urlData.publicUrl;

    // Transactional record — reserves check number, creates rows, marks bills paid.
    const { data: rpcResult, error: rpcErr } = await supabase.rpc('record_check_payment', {
      p_bill_ids: billIds,
      p_bank_account_id: bankAccountId,
      p_memo: memo,
      p_check_date: checkDate,
      p_pdf_url: pdfUrl,
      p_pdf_path: storagePath,
    });
    if (rpcErr) {
      // Clean up the uploaded PDF so we don't leak files.
      await supabase.storage.from('documents').remove([storagePath]);
      throw new Error(`record_check_payment failed: ${rpcErr.message}`);
    }

    const payload = rpcResult as {
      success: boolean;
      check_run_id: string;
      check_number: number;
      total_amount: number;
      reference: string;
    };

    // If the peeked number drifted from the reserved one (shouldn't happen in
    // single-user case, but possible under concurrency), warn the caller —
    // the PDF shows peekedNumber but the DB has payload.check_number.
    const numberMismatch = payload.check_number !== peekedNumber;

    return new Response(
      JSON.stringify({
        success: true,
        check_run_id: payload.check_run_id,
        check_number: payload.check_number,
        reference: payload.reference,
        total_amount: payload.total_amount,
        pdf_url: pdfUrl,
        pdf_path: storagePath,
        micr_embedded: micrEmbedded,
        number_mismatch: numberMismatch,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error) {
    const message = (error as Error).message || 'Unknown error';
    console.error('generate-check error:', message);
    const status = /Authorization|token|Access denied/i.test(message) ? 401 : 400;
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status },
    );
  }
});
