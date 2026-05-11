import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'

export type LeaseSignature = {
  id: string
  lease_id: string
  status: 'Pending' | 'Signed' | 'Voided'
  sent_by: string
  sent_at: string
  signed_at: string | null
  signed_pdf_path: string | null
  typed_signature: string | null
  voided_at: string | null
  voided_reason: string | null
  // Joined fields
  tenant_name?: string
  property_name?: string
  unit_name?: string
  rent_amount?: number
  start_date?: string
  end_date?: string
}

async function fetchSignatures(): Promise<LeaseSignature[]> {
  const { data, error } = await supabase
    .from('lease_signatures')
    .select(`
      id, lease_id, status, sent_by, sent_at,
      signed_at, signed_pdf_path, typed_signature,
      voided_at, voided_reason,
      leases (
        rent_amount, start_date, end_date,
        tenants ( first_name, last_name ),
        units ( name, properties ( name ) )
      )
    `)
    .order('sent_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((s: any) => ({
    id: s.id,
    lease_id: s.lease_id,
    status: s.status,
    sent_by: s.sent_by,
    sent_at: s.sent_at,
    signed_at: s.signed_at,
    signed_pdf_path: s.signed_pdf_path,
    typed_signature: s.typed_signature,
    voided_at: s.voided_at,
    voided_reason: s.voided_reason,
    tenant_name: s.leases?.tenants
      ? `${s.leases.tenants.first_name} ${s.leases.tenants.last_name}`
      : 'Unknown',
    property_name: s.leases?.units?.properties?.name ?? 'Unknown',
    unit_name: s.leases?.units?.name ?? 'Unknown',
    rent_amount: s.leases?.rent_amount != null ? Number(s.leases.rent_amount) : undefined,
    start_date: s.leases?.start_date,
    end_date: s.leases?.end_date,
  }))
}

export function useLeaseSignatures() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['lease-signatures'],
    queryFn: fetchSignatures,
  })

  // Send lease for signing (management → tenant)
  const sendForSigningMutation = useMutation({
    mutationFn: async (leaseId: string) => {
      const { data, error } = await supabase.rpc('send_lease_for_signing', {
        p_lease_id: leaseId,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      toast.success('Lease sent for signing. Tenant has been notified.')
      queryClient.invalidateQueries({ queryKey: ['lease-signatures'] })
    },
    onError: (error: any) => {
      toast.error('Failed to send: ' + error.message)
    },
  })

  // Sign lease (tenant) — calls the edge function which handles PDF + RPC
  const signLeaseMutation = useMutation({
    mutationFn: async (params: { signature_id: string; typed_signature: string }) => {
      const { data, error } = await supabase.functions.invoke('sign-lease', {
        body: {
          signature_id: params.signature_id,
          typed_signature: params.typed_signature,
        },
      })

      if (error) {
        let msg = error.message || 'Signing failed'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        throw new Error(msg)
      }

      // Return the signed PDF blob for immediate download
      return data instanceof Blob ? data : new Blob([JSON.stringify(data)], { type: 'application/pdf' })
    },
    onSuccess: () => {
      toast.success('Lease signed successfully!')
      queryClient.invalidateQueries({ queryKey: ['lease-signatures'] })
    },
    onError: (error: any) => {
      toast.error('Signing failed: ' + error.message)
    },
  })

  // Void a pending signature (management)
  const voidSignatureMutation = useMutation({
    mutationFn: async (params: { signature_id: string; reason?: string }) => {
      const { error } = await supabase.rpc('void_lease_signature', {
        p_signature_id: params.signature_id,
        p_reason: params.reason || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Signature request voided.')
      queryClient.invalidateQueries({ queryKey: ['lease-signatures'] })
    },
    onError: (error: any) => {
      toast.error('Failed to void: ' + error.message)
    },
  })

  // Download signed PDF from storage
  const downloadSignedPdf = async (sig: LeaseSignature) => {
    if (!sig.signed_pdf_path) {
      toast.error('No signed PDF available')
      return
    }

    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(sig.signed_pdf_path, 60)

    if (error || !data?.signedUrl) {
      toast.error('Failed to download signed lease')
      return
    }

    const a = document.createElement('a')
    a.href = data.signedUrl
    a.download = `Signed_Lease_${sig.tenant_name?.replace(/\s+/g, '_') || 'lease'}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // Helper: get signature status for a specific lease
  function signatureForLease(leaseId: string): LeaseSignature | undefined {
    return (data ?? []).find(
      (s) => s.lease_id === leaseId && s.status !== 'Voided'
    )
  }

  // Helper: get pending signature for a specific lease
  function pendingForLease(leaseId: string): LeaseSignature | undefined {
    return (data ?? []).find(
      (s) => s.lease_id === leaseId && s.status === 'Pending'
    )
  }

  return {
    signatures: data ?? [],
    loading: isLoading,
    signatureForLease,
    pendingForLease,
    sendForSigning: sendForSigningMutation.mutateAsync,
    sending: sendForSigningMutation.isPending,
    signLease: signLeaseMutation.mutateAsync,
    signing: signLeaseMutation.isPending,
    voidSignature: voidSignatureMutation.mutateAsync,
    voiding: voidSignatureMutation.isPending,
    downloadSignedPdf,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['lease-signatures'] }),
  }
}
