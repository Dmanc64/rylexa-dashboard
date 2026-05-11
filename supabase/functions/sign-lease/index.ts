/**
 * sign-lease edge function
 *
 * Called when a tenant signs their lease electronically.
 * 1. Validates the tenant owns the lease
 * 2. Calls the sign_lease() RPC to record audit trail
 * 3. Generates a signed PDF with embedded signatures
 * 4. Uploads to Supabase Storage
 * 5. Creates a documents record for the signed lease
 * 6. Updates lease_signatures with the PDF path
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders } from "../_shared/cors.ts"
import { buildLeasePdf, formatDate, type LeaseData, type SignatureData } from "../_shared/lease-pdf.ts"

serve(async (req: Request) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    // ── Auth ──
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ── Parse request ──
    const { signature_id, typed_signature } = await req.json()

    if (!signature_id || !typed_signature?.trim()) {
      return new Response(JSON.stringify({ error: 'signature_id and typed_signature are required' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // ── Fetch signature request + validate ownership ──
    const { data: sig, error: sigError } = await supabase
      .from('lease_signatures')
      .select('id, lease_id, status, sent_by')
      .eq('id', signature_id)
      .eq('status', 'Pending')
      .single()

    if (sigError || !sig) {
      return new Response(JSON.stringify({ error: 'Signature request not found or not pending' }), {
        status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // ── Fetch lease data ──
    const { data: lease, error: leaseError } = await supabase
      .from('leases')
      .select(`
        id, rent_amount, security_deposit, prorated_rent, start_date, end_date, status, user_id,
        tenants ( first_name, last_name, email, phone ),
        units ( name, properties ( name, address ) )
      `)
      .eq('id', sig.lease_id)
      .single()

    if (leaseError || !lease) {
      return new Response(JSON.stringify({ error: 'Lease not found' }), {
        status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Verify tenant owns this lease
    if ((lease as any).user_id !== user.id) {
      // Check if management
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (!profile || !['Admin', 'Property Manager'].includes(profile.role)) {
        return new Response(JSON.stringify({ error: 'Forbidden: not authorized to sign this lease' }), {
          status: 403, headers: { ...cors, 'Content-Type': 'application/json' }
        })
      }
    }

    // ── Get agent/PM name who sent the signing request ──
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', sig.sent_by)
      .single()

    const agentName = senderProfile?.full_name || 'Property Manager'

    // ── Get client IP from headers ──
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || null

    // ── Call sign_lease RPC (records audit trail, sends notifications) ──
    const { error: rpcError } = await supabase.rpc('sign_lease', {
      p_signature_id: signature_id,
      p_typed_signature: typed_signature.trim(),
      p_ip_address: clientIp,
      p_user_agent: req.headers.get('user-agent') || null,
    })

    if (rpcError) {
      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // ── Build lease data for PDF ──
    const tenant = (lease as any).tenants || {}
    const unit = (lease as any).units || {}
    const property = unit.properties || {}

    const leaseData: LeaseData = {
      tenantName: `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || 'Tenant',
      unitAddress: `${property.address || property.name || 'Property'}, Unit ${unit.name || 'N/A'}`,
      propertyName: property.name || 'Property',
      startDate: lease.start_date,
      endDate: lease.end_date,
      monthlyRent: Number(lease.rent_amount) || 0,
      securityDeposit: Number(lease.security_deposit) || 0,
      proratedRent: (lease as any).prorated_rent ? Number((lease as any).prorated_rent) : null,
      agentName,
      tenantEmail: tenant.email || '',
      tenantPhone: tenant.phone || '',
    }

    const now = new Date()
    const signedDateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

    const signatureData: SignatureData = {
      tenantSignature: typed_signature.trim(),
      tenantSignedDate: signedDateStr,
      agentSignature: `${agentName}, Rylexa Properties`,
      agentSignedDate: signedDateStr,
    }

    // ── Generate signed PDF ──
    const pdfBytes = await buildLeasePdf(leaseData, signatureData)

    // ── Upload to Supabase Storage ──
    const timestamp = now.toISOString().replace(/[:.]/g, '-')
    const storagePath = `lease/${lease.id}/signed_lease_${timestamp}.pdf`

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      // Non-fatal — the signature is already recorded, PDF upload is best-effort
    }

    // ── Update lease_signatures with PDF path ──
    if (!uploadError) {
      await supabase
        .from('lease_signatures')
        .update({ signed_pdf_path: storagePath })
        .eq('id', signature_id)

      // ── Create a documents record for the signed lease ──
      await supabase.from('documents').insert({
        title: `Signed Lease - ${leaseData.tenantName} - ${unit.name || 'Unit'}`,
        document_type: 'lease_agreement',
        entity_type: 'lease',
        entity_id: lease.id,
        file_path: storagePath,
        file_name: `Signed_Lease_${leaseData.tenantName.replace(/\s+/g, '_')}.pdf`,
        file_size: pdfBytes.length,
        mime_type: 'application/pdf',
        notes: `Electronically signed on ${signedDateStr}`,
        is_shared: true,
        shared_with: ['Tenant', 'Owner'],
        uploaded_by: sig.sent_by,
      })
    }

    // ── Return the signed PDF to the tenant ──
    const filename = `Signed_Lease_${leaseData.tenantName.replace(/\s+/g, '_')}_${unit.name || 'unit'}.pdf`
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })

  } catch (err: any) {
    console.error('sign-lease error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
