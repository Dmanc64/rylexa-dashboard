/**
 * Shared lease PDF builder used by generate-lease and sign-lease edge functions.
 *
 * Extracted from generate-lease/index.ts to avoid duplication.
 * Produces a professional Residential Lease Agreement PDF with optional
 * electronic signature embedding.
 */

import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1"

// ── HELPERS ──

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Month-to-Month'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function formatCurrency(amount: number | null): string {
  if (!amount) return '$0.00'
  return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const width = font.widthOfTextAtSize(testLine, fontSize)
    if (width > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

// ── TYPES ──

export interface LeaseData {
  tenantName: string
  unitAddress: string
  propertyName: string
  startDate: string
  endDate: string | null
  monthlyRent: number
  securityDeposit: number
  proratedRent: number | null
  agentName: string
  tenantEmail: string
  tenantPhone: string
}

export interface SignatureData {
  tenantSignature: string
  tenantSignedDate: string
  agentSignature: string
  agentSignedDate: string
}

// ── PDF BUILDER ──

export async function buildLeasePdf(
  data: LeaseData,
  signature?: SignatureData
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const pageWidth = 612 // Letter
  const pageHeight = 792
  const margin = 60
  const contentWidth = pageWidth - margin * 2
  const black = rgb(0, 0, 0)
  const gray = rgb(0.4, 0.4, 0.4)
  const darkBlue = rgb(0.1, 0.15, 0.35)

  let currentPage = pdfDoc.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  function ensureSpace(needed: number) {
    if (y - needed < margin) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
  }

  function drawTitle(text: string, size = 18) {
    ensureSpace(size + 20)
    currentPage.drawText(text, { x: margin, y, size, font: fontBold, color: darkBlue })
    y -= size + 12
  }

  function drawSectionHeader(num: string, title: string) {
    ensureSpace(40)
    y -= 10
    currentPage.drawLine({ start: { x: margin, y: y + 5 }, end: { x: pageWidth - margin, y: y + 5 }, thickness: 0.5, color: gray })
    y -= 8
    currentPage.drawText(`Section ${num}`, { x: margin, y, size: 8, font: fontItalic, color: gray })
    y -= 16
    currentPage.drawText(title, { x: margin, y, size: 13, font: fontBold, color: darkBlue })
    y -= 22
  }

  function drawSubHeader(num: string, title: string) {
    ensureSpace(30)
    y -= 4
    currentPage.drawText(`${num}  ${title}`, { x: margin, y, size: 10, font: fontBold, color: black })
    y -= 16
  }

  function drawParagraph(text: string, size = 9) {
    const lines = wrapText(text, font, size, contentWidth)
    for (const line of lines) {
      ensureSpace(size + 4)
      currentPage.drawText(line, { x: margin, y, size, font, color: black })
      y -= size + 4
    }
    y -= 6
  }

  function drawField(label: string, value: string) {
    ensureSpace(24)
    currentPage.drawText(label + ':', { x: margin, y, size: 9, font: fontBold, color: gray })
    currentPage.drawText(value, { x: margin + 150, y, size: 10, font: fontBold, color: black })
    y -= 18
  }

  function drawInitialLine() {
    ensureSpace(20)
    y -= 4
    currentPage.drawText('X __________ Initial Here', { x: margin + 300, y, size: 8, font: fontItalic, color: gray })
    y -= 18
  }

  // ═══════════════════════════════════════════
  //  PAGE 1: HEADER + SECTION 1
  // ═══════════════════════════════════════════

  // Header
  currentPage.drawText(data.propertyName.toUpperCase(), { x: margin, y, size: 22, font: fontBold, color: darkBlue })
  y -= 28
  currentPage.drawText('RESIDENTIAL LEASE AGREEMENT', { x: margin, y, size: 14, font: fontBold, color: black })
  y -= 20
  currentPage.drawText('Managed by Rylexa Properties  |  595 Humboldt St, Ste #100, Reno, NV 89509  |  (775) 771-8088', {
    x: margin, y, size: 8, font: fontItalic, color: gray
  })
  y -= 10
  currentPage.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1, color: darkBlue })
  y -= 24

  // Key Terms Summary Box
  const fields: [string, string][] = [
    ['Tenant(s):', data.tenantName],
    ['Premises:', data.unitAddress],
    ['Lease Term:', `${formatDate(data.startDate)} through ${formatDate(data.endDate)}`],
    ['Monthly Rent:', formatCurrency(data.monthlyRent)],
    ['Security Deposit:', formatCurrency(data.securityDeposit)],
  ]
  if (data.proratedRent) {
    fields.push(['1st Month (Prorated):', formatCurrency(data.proratedRent)])
  }
  const boxHeight = 35 + fields.length * 16
  ensureSpace(boxHeight + 30)
  const boxTop = y + 4
  currentPage.drawRectangle({ x: margin, y: boxTop - boxHeight, width: contentWidth, height: boxHeight, borderColor: gray, borderWidth: 0.5, color: rgb(0.97, 0.97, 0.99) })
  let boxY = boxTop - 16
  currentPage.drawText('LEASE SUMMARY', { x: margin + 12, y: boxY, size: 9, font: fontBold, color: darkBlue })
  boxY -= 18
  for (const [lbl, val] of fields) {
    currentPage.drawText(lbl, { x: margin + 12, y: boxY, size: 9, font: fontBold, color: gray })
    currentPage.drawText(val, { x: margin + 130, y: boxY, size: 9, font: fontBold, color: black })
    boxY -= 16
  }
  y = boxTop - boxHeight - 20

  // ── SECTION 1 ──
  drawSectionHeader('1', 'Residency and Financials')

  drawSubHeader('1.1', 'Parties and Occupants')
  drawParagraph(`This Lease Contract is between you, the Resident(s): ${data.tenantName} and us, the Owner/Agent: ${data.propertyName}, for the premises located at: ${data.unitAddress}, for use as a private residence only. The terms "you" and "your" refer to all residents listed above. The terms "we," "us," and "our" refer to the owner/agent listed. The apartment will be occupied exclusively by the resident listed above. There will be an additional charge of $75 per person per month applied for each additional resident. The Owner/Agent must approve unauthorized occupants living in the premises for longer than 3 consecutive days. All occupants age 18 or older must be listed on and sign this Lease Contract.`)

  drawSubHeader('1.2', 'Lease Duration')
  drawParagraph(`The terms of this tenancy shall commence on ${formatDate(data.startDate)} and end on ${formatDate(data.endDate)}, and thereafter, shall be month-to-month on the same terms and conditions as stated herein, save any changes made pursuant to law, until terminated. If you prefer a full lease renewal please contact the office.`)

  drawSubHeader('1.3', 'Rents and Charges')
  if (data.proratedRent) {
    drawParagraph(`You shall pay ${formatCurrency(data.monthlyRent)} per month for rent. The first month's rent shall be ${formatCurrency(data.proratedRent)} (prorated), with ${formatCurrency(data.monthlyRent)} due monthly thereafter. Every month thereafter, you must pay your rent on or before the 1st day of each month, a grace period to the 5th of each month will be provided. The following late fees will apply for payments made after the grace period: Late fee rule: 5% of the monthly rent amount. Administrative fee: $65 processing fee & $25 fee for each notice posted.`)
  } else {
    drawParagraph(`You shall pay ${formatCurrency(data.monthlyRent)} per month for rent. The first month's rent and/or prorated rent amount shall be due prior to move-in. Every month thereafter, you must pay your rent on or before the 1st day of each month, a grace period to the 5th of each month will be provided. The following late fees will apply for payments made after the grace period: Late fee rule: 5% of the monthly rent amount. Administrative fee: $65 processing fee & $25 fee for each notice posted.`)
  }
  drawParagraph('A charge of $35 will apply for every returned check or rejected electronic payment plus the amount of any fees charged to the Owner/Agent by any financial institution as a result of the check not being honored, plus any applicable late fee charges. If you don\'t pay rent on time, you\'ll be delinquent and all remedies under this Lease Contract will be authorized. Any payments received will be applied first toward late fees and/or additional charges, then toward rent.')
  drawParagraph('We may change the terms of this lease in accordance with applicable law, including rent increases and other modifications to the terms of the contract. All rent payments shall be made through our website, Rylexa.com through your registered Appfolio portal. Rent payments are also acceptable at our office by cashier\'s check or money order. Cash is not acceptable.')

  drawSubHeader('1.4', 'Security Deposit')
  drawParagraph(`The total security deposit at the time of execution of this Lease Contract for all residents in the apartment is ${formatCurrency(data.securityDeposit)}, due on or before the date this Lease Contract is signed. $160.00 of your deposit is non-refundable.`)
  drawParagraph('1. Landlord may apply charges above and beyond the deposit as are reasonably necessary to repair damage to the Unit or Premises other than normal wear caused by Resident, or its invitees, including reasonable repair or replacement of, without limitation, furniture, fixtures, appliances, keys, floors, and/or floor coverings, windows, ceilings or wall in or about the Unit or Premises. Resident remains liable for and shall promptly pay Landlord all sums in excess of said deposit required for said repair or replacement purposes. Any overage balances not paid shall be given to a collections agency.')
  drawParagraph('2. Upon termination of the tenancy for any reason, if Resident does not provide 30 day notice or leave the Unit in as good as condition as when received by Resident from Landlord, reasonable use and wear expected, i.e. normal wear, Landlord may apply such portion of the security deposit to reasonable costs of cleaning of the Unit, including, without limitation, final cleaning of floors, carpets, rugs, drapes, curtains, windows, walls, fixtures, and appliances. Cleaning is charged at $50 per hour. Maintenance work is charged at $55 per hour plus cost of materials. If needed, final cleaning of floors and carpets will be billed to tenant at fair market rate plus a $75 surcharge. A non negotiable fee of $250 will be applied to Resident(s) account if and when any evidence of smoking is found in residence. A rekey fee of $55 or more shall be charged from deposit at move out. An additional $100.00 sanitation fee will be charged from the deposit for sanitation of the unit.')

  drawSubHeader('1.5', 'Utilities')
  drawParagraph('Tenant will pay $95.00 for utilities. Any utilities that are not covered by Landlord, the tenant will pay for related deposits, and any charges, fees, or services on such utilities. We do not guarantee or warrant that there will be no interruption of utility service. You shall contact the utility service provider in the event of an interruption of service. If your electricity is ever interrupted, you must use only battery-operated lighting.')

  drawSubHeader('1.6', 'Insurance')
  drawParagraph('We do not maintain insurance to cover your personal belongings or personal injury. You assume all liability for personal injury, property damage or loss, and insurable risk. As a term of your lease agreement it is required to get your own renter\'s insurance (must include $100,000 personal liability insurance) for losses to your personal property or injuries due to theft, fire, water damage, pipe leaks and the like. The cost for this can range from $7 to $25 a month. Please provide proof of insurance prior to move in.')

  drawSubHeader('1.7', 'Keys and Locks')
  drawParagraph('You will be provided the following keys: Front door. All deadlocks, keys, window latches, doorknobs and any additional device required by local government ordinance, will be in working order when you move in. You shall be liable for the entire cost for any key and lock replacements. You shall not change the locks or add a deadbolt lock without our written consent. All keys must be returned to us when you vacate the unit. You will be charged for the cost of new locks and keys that are not returned. Minimum of $50 or more. For after-hours lockout assistance there will be a $105.00 charge.')

  drawSubHeader('1.8', 'Authorized Manager')
  drawParagraph(`The authorized property manager is ${data.agentName}, Rylexa Properties, (775) 771-8088. All official notices and requests should be directed to the management office.`)

  drawInitialLine()

  // ── SECTION 2 ──
  drawSectionHeader('2', 'Policies and Procedures')

  drawSubHeader('2.1', 'Community Policies or Rules')
  drawParagraph('You and all guests and occupants must comply with any written community rules and policies, including instructions for care of our property. Any rules are considered part of this Lease Contract. We may make reasonable changes to written rules, effective immediately, if distributed and applicable to all units in the community. See additional community rules, if any.')

  drawSubHeader('2.2', 'Resident Safety and Property Loss')
  drawParagraph('You and all occupants and guests must exercise due care for your own and others\' safety and security, especially in the use of smoke detectors, keyed deadbolt locks, keyless deadbolts, window latches, and other security or safety devices. You agree to make every effort to abide by the rules and guidelines in this Lease Contract.')
  drawParagraph('Casualty Loss: We\'re not liable to any resident, guest, or occupant for personal injury or damage or loss of personal property from any cause, including but not limited to: fire, smoke, rain, flood, water and pipe leaks, hail, ice, snow, lightning, wind, explosions, earthquake, interruption of utilities, theft, or vandalism unless otherwise required by law.')
  drawParagraph('Smoke Detectors: The Unit is equipped with smoke and carbon monoxide detectors in accordance with state or local government regulations. You must immediately report smoke-detector malfunctions to us. Neither you nor others may disable smoke detectors and will result in a $200 fine for doing so. You will be liable to others and us for any loss, damage, or fines from fire, smoke, or water if that condition arises from disabling or damaging the smoke detector or from your failure to replace a dead battery or report malfunctions to us.')
  drawParagraph('Safety and Crime Free: You or any guest or resident under your control, should not engage in any criminal activity in your unit or community. In case of emergency, fire, accident, smoke or suspected criminal activity, dial 911 or call emergency personnel. You should then contact our representative. Unless otherwise provided by law, we\'re not liable to you or any guests or occupants for injury, damage, or loss to person or property caused by criminal conduct of other persons, including theft, burglary, assault, vandalism, or other crimes.')

  drawSubHeader('2.3', 'Parking')
  drawParagraph('You will park on the property at your own risk. Parking permits are required and will be provided as negotiated with this Lease Contract. Fees may apply. We may regulate the time, manner, and place of parking cars, trucks, motorcycles, bicycles, boats, trailers, and recreational vehicles by anyone. We may have unauthorized or illegally parked vehicles towed under an appropriate statute.')
  drawParagraph('Vehicles are prohibited from parking on the premises if they are inoperable, have no current license, take up more than one parking space, are parked in a marked handicap space without proper handicap insignia, block other vehicles from existing, are parked in a space not dedicated to parking, including, but not limited to, grass, sidewalks, patio, and fire lanes.')

  drawSubHeader('2.4', 'Pets')
  drawParagraph('Pets (including mammals, reptiles, birds, fish, and insects) are allowed only if we have so authorized in writing. You must remove an illegal animal within 24 hours of notice from us, or you will be considered in default of this Lease Contract. We will authorize a service animal for a disabled person but must be approved in writing. We may require a written statement from a qualified professional, verifying the need for the service animal.')
  drawParagraph('If you or any guest or occupant violates animal restrictions (with or without your knowledge), you\'ll be subject to charges, damages, eviction, and other remedies provided in this Lease Contract. If an animal has been in the apartment at any time during your term of occupancy (with or without our consent), we\'ll charge you for de-fleaing, deodorizing, and shampooing.')

  drawInitialLine()

  // ── SECTION 3 ──
  drawSectionHeader('3', 'Responsibilities')

  drawSubHeader('3.1', 'Condition of Premises and Alterations')
  drawParagraph('You accept the apartment, fixtures, and furniture as is, except for conditions materially affecting the health or safety of ordinary persons. We disclaim all implied warranties. You shall maintain the premises in good, clean and tenantable condition throughout the tenancy. You agree not to alter, damage, or remove our property, including alarm systems, smoke detectors, furniture, telephone and cable TV wiring, screens, locks, and security devices. You may not paint or make any permanent alteration without our written consent. Any and all interior or exterior alterations must be agreed to in writing.')

  drawSubHeader('3.2', 'Requests, Repairs, Malfunctions')
  drawParagraph('You shall report any damage or problem immediately upon discovery or you may be held responsible for the cost. Our complying with or responding to any oral request regarding security or nonsecurity matters doesn\'t waive the strict requirement for written notices under this Lease Contract. You must promptly notify us in writing of: water leaks; electrical problems; pest issues; malfunctioning lights; broken or missing locks or latches; and other conditions that pose a hazard to the property, or your health, or safety. We will respond in accordance with state law and the Lease Contract to repair or remedy the situation, as necessary. We may turn off equipment and interrupt utilities as needed to avoid property damage or to perform work.')

  drawSubHeader('3.3', 'Right of Entry and Inspections')
  drawParagraph('We have the right to enter the premises at all reasonable hours, with proper notice, for the purpose of inspection, responding to your request, making repairs and/or preventative maintenance, pest control, showing to prospective residents, buyers, loan officers or insurance agents, and for any emergency situations that may arise. 24 hour notice will be posted prior to doing so unless it is an emergency regarding a wellness check or potential property damage.')

  drawSubHeader('3.4', 'Move-Out')
  drawParagraph('You will give us a written notice with your intent to vacate 30 (thirty) days prior to the date of expiration of the Lease Contract. In such notice, you will include your forwarding address.')
  drawParagraph('Surrender, abandonment, and eviction ends your right of possession for all purposes and gives us the immediate right to: clean up, make repairs in, and re-rent the apartment; determine any security deposit deductions; and remove property left in the apartment. Surrender, abandonment, and eviction affect your rights to property left in the apartment. Surrender, abandonment, and eviction do not affect our mitigation obligations.')
  drawSubHeader('', 'Cleaning')
  drawParagraph('You must thoroughly clean the unit, including doors, windows, furniture, bathrooms, kitchen appliances, patios, balconies and storage rooms. If you don\'t clean adequately, you\'ll be liable for reasonable cleaning charges. Standard charges for cleaning are $50 per hour. Standard charges for maintenance are $55 per hour.')
  drawSubHeader('', 'Charges')
  drawParagraph('You\'ll be liable for the following charges, if applicable: unpaid rent; unpaid utilities; unreimbursed service charges; repairs or other damages, excluding ordinary wear and tear; replacement cost of our property that was in or attached to the apartment and is missing; unreturned keys; missing or burned-out light bulbs; removing or rekeying unauthorized security devices or alarm systems; agreed reletting charges; packing, removing, or storing property removed or stored; removing illegally parked vehicles; animal-related charges; government fees or fines against us for violation (by you, your occupant, or guest) of local ordinances relating to smoke detectors, false alarms, recycling, or other matters; late-payment and returned-check charges, plus attorney\'s fees, court costs, and filing fees actually paid; and other sums due under this Lease Contract.')

  drawInitialLine()

  // ── SECTION 4 ──
  drawSectionHeader('4', 'General Clauses')

  drawSubHeader('4.1', 'Release from Lease Contract')
  drawParagraph('Early termination requires 60 days written notice and payment of an early termination fee equal to two months\' rent, unless otherwise agreed in writing. Management may waive or reduce the fee at its sole discretion. Military personnel are exempt under the SCRA with proper documentation.')

  drawSubHeader('4.2', 'Default by Resident')
  drawParagraph('Resident is in default if: rent is unpaid after the grace period; any lease term is violated; the premises are abandoned; or illegal activity occurs on the premises. Management may issue a notice to cure or quit, and if uncured, may proceed with eviction in accordance with Nevada law. Smoking violation fee: $250.00.')

  drawSubHeader('4.3', 'Contract Termination and Dispute')
  drawParagraph('This Lease may be terminated by mutual written agreement, by either party with proper notice, or by management for cause as provided herein. Any disputes shall first be addressed through mediation before litigation. This agreement is governed by the laws of the State of Nevada. If any provision is found unenforceable, the remaining provisions shall remain in full effect.')

  drawInitialLine()

  // ── SECTION 5: SIGNATURES ──
  drawSectionHeader('5', 'Sign and Accept')

  drawSubHeader('5.1', 'Acceptance of Lease')
  drawParagraph('By signing below, all parties acknowledge that they have read, understand, and agree to all terms and conditions set forth in this Residential Lease Agreement. This Lease constitutes the entire agreement between the parties and supersedes all prior negotiations, representations, or agreements.')

  ensureSpace(160)
  y -= 20

  const signatureColor = rgb(0.05, 0.1, 0.4) // Dark blue for signatures

  // Lessee signature block
  currentPage.drawText('LESSEE (Resident):', { x: margin, y, size: 10, font: fontBold, color: darkBlue })
  y -= 24

  if (signature) {
    // Signed: show typed signature
    currentPage.drawText(signature.tenantSignature, { x: margin, y, size: 14, font: fontItalic, color: signatureColor })
    y -= 14
    currentPage.drawLine({ start: { x: margin, y }, end: { x: margin + 240, y }, thickness: 0.5, color: gray })
    y -= 12
    currentPage.drawText('Electronic Signature', { x: margin, y, size: 8, font: fontItalic, color: gray })
    currentPage.drawText(`Date: ${signature.tenantSignedDate}`, { x: margin + 280, y, size: 9, font, color: black })
  } else {
    // Unsigned: blank lines
    currentPage.drawText(data.tenantName, { x: margin, y, size: 11, font: fontBold, color: black })
    y -= 14
    currentPage.drawLine({ start: { x: margin, y }, end: { x: margin + 240, y }, thickness: 0.5, color: gray })
    y -= 12
    currentPage.drawText('Signature', { x: margin, y, size: 8, font: fontItalic, color: gray })
    currentPage.drawText('Date: _______________', { x: margin + 280, y, size: 9, font, color: gray })
  }
  y -= 30

  // Lessor signature block
  currentPage.drawText('LESSOR (Owner/Agent):', { x: margin, y, size: 10, font: fontBold, color: darkBlue })
  y -= 24

  if (signature) {
    currentPage.drawText(signature.agentSignature, { x: margin, y, size: 14, font: fontItalic, color: signatureColor })
    y -= 14
    currentPage.drawLine({ start: { x: margin, y }, end: { x: margin + 240, y }, thickness: 0.5, color: gray })
    y -= 12
    currentPage.drawText('Electronic Signature', { x: margin, y, size: 8, font: fontItalic, color: gray })
    currentPage.drawText(`Date: ${signature.agentSignedDate}`, { x: margin + 280, y, size: 9, font, color: black })
  } else {
    currentPage.drawText(`${data.agentName}, Rylexa Properties`, { x: margin, y, size: 11, font: fontBold, color: black })
    y -= 14
    currentPage.drawLine({ start: { x: margin, y }, end: { x: margin + 240, y }, thickness: 0.5, color: gray })
    y -= 12
    currentPage.drawText('Signature', { x: margin, y, size: 8, font: fontItalic, color: gray })
    currentPage.drawText('Date: _______________', { x: margin + 280, y, size: 9, font, color: gray })
  }
  y -= 30

  // E-sign footer if signed
  if (signature) {
    ensureSpace(40)
    y -= 10
    currentPage.drawLine({ start: { x: margin, y: y + 5 }, end: { x: pageWidth - margin, y: y + 5 }, thickness: 0.5, color: gray })
    y -= 14
    currentPage.drawText(
      'This document was electronically executed via the Rylexa Properties e-signature system. An audit trail is maintained on file.',
      { x: margin, y, size: 7, font: fontItalic, color: gray }
    )
    y -= 10
    currentPage.drawText(
      'Electronic signatures are legally binding under the federal E-SIGN Act (15 U.S.C. 7001) and the Uniform Electronic Transactions Act (UETA).',
      { x: margin, y, size: 7, font: fontItalic, color: gray }
    )
  }

  // Footer on every page
  const pages = pdfDoc.getPages()
  pages.forEach((page, idx) => {
    page.drawText(`${data.propertyName} — Residential Lease Agreement`, { x: margin, y: 30, size: 7, font: fontItalic, color: gray })
    page.drawText(`Page ${idx + 1} of ${pages.length}`, { x: pageWidth - margin - 60, y: 30, size: 7, font: fontItalic, color: gray })
  })

  return pdfDoc.save()
}
