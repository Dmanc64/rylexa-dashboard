import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders } from "../_shared/cors.ts"
import { buildLeasePdf, type LeaseData } from "../_shared/lease-pdf.ts"

// ── MAIN HANDLER ──
serve(async (req: Request) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    // Auth — extract user from JWT
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Create user-scoped client to verify auth
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Admin client for data access
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify caller is Admin or Property Manager
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', user.id)
      .single()

    if (!callerProfile || !['Admin', 'Property Manager', 'Tenant'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden: Admin, Property Manager, or Tenant required' }), {
        status: 403, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Parse request
    const { lease_id } = await req.json()
    if (!lease_id) {
      return new Response(JSON.stringify({ error: 'lease_id is required' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Tenants can only generate their own lease
    if (callerProfile.role === 'Tenant') {
      const { data: tenantLease } = await supabase
        .from('leases')
        .select('id')
        .eq('id', lease_id)
        .eq('user_id', user.id)
        .single()

      if (!tenantLease) {
        return new Response(JSON.stringify({ error: 'Forbidden: You can only access your own lease' }), {
          status: 403, headers: { ...cors, 'Content-Type': 'application/json' }
        })
      }
    }

    // Fetch full lease data
    const { data: lease, error: leaseError } = await supabase
      .from('leases')
      .select(`
        id, rent_amount, security_deposit, prorated_rent, start_date, end_date, status,
        tenants ( first_name, last_name, email, phone ),
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

    const leaseData: LeaseData = {
      tenantName: `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || 'Tenant',
      unitAddress: `${property.address || property.name || 'Property'}, Unit ${unit.name || 'N/A'}`,
      propertyName: property.name || 'Property',
      startDate: lease.start_date,
      endDate: lease.end_date,
      monthlyRent: Number(lease.rent_amount) || 0,
      securityDeposit: Number(lease.security_deposit) || 0,
      proratedRent: (lease as any).prorated_rent ? Number((lease as any).prorated_rent) : null,
      agentName: callerProfile.full_name || 'Property Manager',
      tenantEmail: tenant.email || '',
      tenantPhone: tenant.phone || '',
    }

    // Generate PDF (unsigned)
    const pdfBytes = await buildLeasePdf(leaseData)

    // Return PDF
    const filename = `Lease_${leaseData.tenantName.replace(/\s+/g, '_')}_${unit.name || 'unit'}.pdf`
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })

  } catch (err: any) {
    console.error('generate-lease error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
